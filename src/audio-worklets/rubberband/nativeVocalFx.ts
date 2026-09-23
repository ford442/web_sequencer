import type { VocalFxBlock, VocalFxChain } from "./vocalFx";

/** Must equal RB_FX_ABI_VERSION in emscripten/rubberband_fx.h. */
export const RB_FX_ABI_VERSION = 2;

/**
 * Index of each control in the double block returned by rb_fx_params(), in
 * RbFxParam order (emscripten/rubberband_fx.h). A unit test parses the header
 * and fails on drift.
 */
export const RB_FX_PARAM = {
  HAS_PHONEME_CONTEXT: 0,
  PHONEME_VOLUME: 1,
  IS_VOWEL: 2,
  PHONEME_GRAIN_JITTER: 3,
  PHONEME_GRAIN_SIZE_MS: 4,
  PHONEME_FILTER_MOD: 5,
  VOLUME_FILTER_MOD: 6,
  SYLLABLE_VOLUME: 7,
  GATE_DEPTH: 8,
  GATE_RATE: 9,
  SPECTRAL_COMP: 10,
  GRAIN_PAN_SPREAD: 11,
  VOCAL_CHORUS: 12,
  SUB_HARMONICS: 13,
  DUCKING_SCALAR: 14,
  DRUM_IS_SNARE: 15,
  BITCRUSH: 16,
  DOWNSAMPLE: 17,
  ENVELOPE_VALUE: 18,
  GRAIN_JITTER: 19,
  GRAIN_ENV_DEPTH: 20,
  WINDOW_SHAPE: 21,
  GRAIN_LFO_DEPTH: 22,
  GRAIN_POS_LFO_DEPTH: 23,
  VELOCITY: 24,
} as const;

export const RB_FX_PARAM_COUNT = 25;

const RB_FX_WINDOW_CUSTOM_SHAPE = 1;
const RB_FX_WINDOW_CUSTOM_ENVELOPE = 2;

/** Keep in step with RB_FX_EXPORTS in emscripten/build_rubberband.sh. */
export const RB_FX_REQUIRED_EXPORTS = [
  '_rb_fx_abi_version',
  '_rb_fx_param_count',
  '_rb_fx_create',
  '_rb_fx_destroy',
  '_rb_fx_params',
  '_rb_fx_channel',
  '_rb_fx_seed',
  '_rb_fx_note_on',
  '_rb_fx_sample_alloc',
  '_rb_fx_window_alloc',
  '_rb_fx_advance_lfo',
  '_rb_fx_render_grains',
  '_rb_fx_exit_freeze',
  '_rb_fx_process',
] as const;

type RbFxExportName = (typeof RB_FX_REQUIRED_EXPORTS)[number];

/** The slice of the createRubberBandModule() instance the FX chain uses. */
export type RubberBandFxModule = { HEAPF32: Float32Array; HEAPF64: Float64Array } & {
  [K in RbFxExportName]: (...args: number[]) => number;
};

export type NativeVocalFxProbe =
  | { ok: true; module: RubberBandFxModule }
  | { ok: false; reason: string };

/**
 * Decides whether the loaded rubberband.wasm can run the native chain. Every
 * `ok: false` carries a reason the worklet reports to telemetry — the TS
 * fallback is never silent.
 */
export function probeNativeVocalFx(module: unknown): NativeVocalFxProbe {
  const m = module as Record<string, unknown> | null;
  if (!m) return { ok: false, reason: 'Rubber Band module not loaded' };

  const missing = RB_FX_REQUIRED_EXPORTS.filter((name) => typeof m[name] !== 'function');
  if (missing.length === RB_FX_REQUIRED_EXPORTS.length) {
    return {
      ok: false,
      reason: 'rubberband.wasm has no rb_fx_* exports (stale build; run pnpm run build:wasm:rubberband)',
    };
  }
  if (missing.length > 0) {
    return { ok: false, reason: `rubberband.wasm is missing FX exports: ${missing.join(', ')}` };
  }
  if (!(m.HEAPF32 instanceof Float32Array) || !(m.HEAPF64 instanceof Float64Array)) {
    return { ok: false, reason: 'Rubber Band glue does not expose HEAPF32 / HEAPF64' };
  }

  const fxModule = m as unknown as RubberBandFxModule;
  const abi = fxModule._rb_fx_abi_version();
  if (abi !== RB_FX_ABI_VERSION) {
    return { ok: false, reason: `rb_fx ABI ${abi} does not match worklet ABI ${RB_FX_ABI_VERSION}` };
  }
  const count = fxModule._rb_fx_param_count();
  if (count !== RB_FX_PARAM_COUNT) {
    return { ok: false, reason: `rb_fx param count ${count} does not match worklet ${RB_FX_PARAM_COUNT}` };
  }
  return { ok: true, module: fxModule };
}

/**
 * rb_fx_* in public/rubberband.wasm behind the VocalFxChain interface. The
 * only per-sample work left in JS is two 128-frame copies per block.
 */
export class NativeVocalFx implements VocalFxChain {
  readonly backend = 'native' as const;

  private readonly m: RubberBandFxModule;
  private handle: number;
  private readonly paramsPtr: number;
  private readonly leftPtr: number;
  private readonly rightPtr: number;
  private readonly maxFrames: number;
  // Views over the planar scratch, rebuilt only when memory growth detaches them.
  private leftView: Float32Array;
  private rightView: Float32Array;

  constructor(m: RubberBandFxModule, sampleRate: number, maxFrames = 128, seed = 0) {
    this.m = m;
    this.handle = m._rb_fx_create(sampleRate, maxFrames);
    if (!this.handle) {
      throw new Error(`rb_fx_create(${sampleRate}, ${maxFrames}) returned null`);
    }
    this.maxFrames = maxFrames;
    this.paramsPtr = m._rb_fx_params(this.handle);
    this.leftPtr = m._rb_fx_channel(this.handle, 0);
    this.rightPtr = m._rb_fx_channel(this.handle, 1);
    this.leftView = new Float32Array(m.HEAPF32.buffer, this.leftPtr, maxFrames);
    this.rightView = new Float32Array(m.HEAPF32.buffer, this.rightPtr, maxFrames);
    if (seed) m._rb_fx_seed(this.handle, seed >>> 0);
  }

  setSampleBuffer(buffer: Float32Array): void {
    const ptr = this.m._rb_fx_sample_alloc(this.handle, buffer.length);
    if (buffer.length > 0) {
      if (!ptr) throw new Error(`rb_fx_sample_alloc(${buffer.length}) failed`);
      this.m.HEAPF32.set(buffer, ptr >> 2);
    }
  }

  setCustomWindowShape(shape: Float32Array | null): void {
    this.setWindow(RB_FX_WINDOW_CUSTOM_SHAPE, shape);
  }

  setCustomGrainEnvelope(shape: ArrayLike<number> | null): void {
    this.setWindow(RB_FX_WINDOW_CUSTOM_ENVELOPE, shape);
  }

  noteOn(): void {
    this.m._rb_fx_note_on(this.handle);
  }

  advanceLfo(freezeLfoRate: number, grainLfoRate: number, frames: number): number {
    return this.m._rb_fx_advance_lfo(this.handle, freezeLfoRate, grainLfoRate, frames);
  }

  renderGrains(
    block: VocalFxBlock,
    heap: Float32Array,
    offset: number,
    frames: number,
    currentSample: number,
    startSample: number,
    endSample: number,
  ): number {
    if (heap.buffer !== this.m.HEAPF32.buffer) {
      throw new Error('NativeVocalFx.renderGrains needs a view of the Rubber Band heap');
    }
    this.writeParams(block);
    return this.m._rb_fx_render_grains(
      this.handle, heap.byteOffset + offset * 4, frames, currentSample, startSample, endSample,
    );
  }

  exitFreeze(): void {
    this.m._rb_fx_exit_freeze(this.handle);
  }

  process(block: VocalFxBlock, left: Float32Array, right: Float32Array): void {
    this.writeParams(block);
    if (this.leftView.buffer !== this.m.HEAPF32.buffer) {
      this.leftView = new Float32Array(this.m.HEAPF32.buffer, this.leftPtr, this.maxFrames);
      this.rightView = new Float32Array(this.m.HEAPF32.buffer, this.rightPtr, this.maxFrames);
    }
    const n = left.length;
    if (n === this.maxFrames && right.length === n) {
      // Render-quantum fast path: no per-block view allocation.
      this.leftView.set(left);
      this.m._rb_fx_process(this.handle, this.leftPtr, this.rightPtr, n);
      left.set(this.leftView);
      right.set(this.rightView);
      return;
    }
    const frames = Math.min(n, right.length, this.maxFrames);
    this.leftView.set(left.subarray(0, frames));
    this.m._rb_fx_process(this.handle, this.leftPtr, this.rightPtr, frames);
    left.set(this.leftView.subarray(0, frames));
    right.set(this.rightView.subarray(0, frames));
  }

  dispose(): void {
    if (this.handle) {
      this.m._rb_fx_destroy(this.handle);
      this.handle = 0;
    }
  }

  private setWindow(kind: number, shape: ArrayLike<number> | null): void {
    const len = shape ? shape.length : 0;
    const ptr = this.m._rb_fx_window_alloc(this.handle, kind, len);
    if (shape && len > 0) {
      if (!ptr) throw new Error(`rb_fx_window_alloc(${kind}, ${len}) failed`);
      this.m.HEAPF32.set(shape, ptr >> 2);
    }
  }

  private writeParams(b: VocalFxBlock): void {
    const h = this.m.HEAPF64;
    const o = this.paramsPtr >> 3;
    const P = RB_FX_PARAM;
    h[o + P.HAS_PHONEME_CONTEXT] = b.hasPhonemeContext ? 1 : 0;
    h[o + P.PHONEME_VOLUME] = b.phonemeVolume;
    h[o + P.IS_VOWEL] = b.isVowel;
    h[o + P.PHONEME_GRAIN_JITTER] = b.phonemeGrainJitter;
    h[o + P.PHONEME_GRAIN_SIZE_MS] = b.phonemeGrainSizeMs;
    h[o + P.PHONEME_FILTER_MOD] = b.phonemeFilterMod;
    h[o + P.VOLUME_FILTER_MOD] = b.volumeFilterMod;
    h[o + P.SYLLABLE_VOLUME] = b.syllableVolume;
    h[o + P.GATE_DEPTH] = b.gateDepth;
    h[o + P.GATE_RATE] = b.gateRate;
    h[o + P.SPECTRAL_COMP] = b.spectralComp;
    h[o + P.GRAIN_PAN_SPREAD] = b.grainPanSpread;
    h[o + P.VOCAL_CHORUS] = b.vocalChorus;
    h[o + P.SUB_HARMONICS] = b.subHarmonics;
    h[o + P.DUCKING_SCALAR] = b.duckingScalar;
    h[o + P.DRUM_IS_SNARE] = b.drumIsSnare;
    h[o + P.BITCRUSH] = b.bitcrush;
    h[o + P.DOWNSAMPLE] = b.downsample;
    h[o + P.ENVELOPE_VALUE] = b.envelopeValue;
    h[o + P.GRAIN_JITTER] = b.grainJitter;
    h[o + P.GRAIN_ENV_DEPTH] = b.grainEnvDepth;
    h[o + P.WINDOW_SHAPE] = b.windowShape;
    h[o + P.GRAIN_LFO_DEPTH] = b.grainLfoDepth;
    h[o + P.GRAIN_POS_LFO_DEPTH] = b.grainPosLfoDepth;
    h[o + P.VELOCITY] = b.velocity;
  }
}
