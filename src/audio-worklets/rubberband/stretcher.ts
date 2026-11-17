/**
 * The Rubber Band stretcher over the plain C ABI in emscripten/rubberband_wrapper.cpp
 * (rb_* exports of public/rubberband.wasm). It replaced the embind
 * `module.RubberBandStretcher` class (#1596 follow-up P2): no embind, no C++
 * exceptions, no RTTI, and no per-call allocation in process() / retrieve().
 *
 * Buffers are planar heap offsets (LLLL… RRRR…), `frames` samples per channel,
 * exactly as before. The module's memory is fixed (ALLOW_MEMORY_GROWTH=0), so the
 * HEAPF32 view a caller reads stays valid for the life of the instance.
 */

/** Must equal kRbAbiVersion in emscripten/rubberband_wrapper.cpp. */
export const RB_ABI_VERSION = 1;

/** Keep in step with RB_EXPORTS in emscripten/build_rubberband.sh. */
export const RB_REQUIRED_EXPORTS = [
  '_rb_abi_version',
  '_rb_create',
  '_rb_destroy',
  '_rb_reset',
  '_rb_set_time_ratio',
  '_rb_set_pitch_scale',
  '_rb_get_time_ratio',
  '_rb_get_pitch_scale',
  '_rb_set_formant_option',
  '_rb_get_samples_required',
  '_rb_get_latency',
  '_rb_get_channel_count',
  '_rb_available',
  '_rb_process',
  '_rb_retrieve',
] as const;

type RbExportName = (typeof RB_REQUIRED_EXPORTS)[number];

/** The slice of a createRubberBandModule() instance the stretcher uses. */
export type RubberBandStretcherModule = {
  readonly HEAPF32: Float32Array;
  _malloc(bytes: number): number;
  _free(ptr: number): void;
} & { [K in RbExportName]: (...args: number[]) => number };

/** Throws, naming what is wrong, when `module` cannot run the stretcher. */
export function assertRubberBandStretcherModule(module: unknown): asserts module is RubberBandStretcherModule {
  const m = module as Record<string, unknown> | null;
  if (!m) throw new Error('Rubber Band module not loaded');
  const missing = RB_REQUIRED_EXPORTS.filter((name) => typeof m[name] !== 'function');
  if (missing.length) {
    throw new Error(
      `rubberband.wasm is missing stretcher exports (${missing.join(', ')}) — ` +
      'stale build; run pnpm run build:wasm:rubberband',
    );
  }
  const abi = (m._rb_abi_version as () => number)();
  if (abi !== RB_ABI_VERSION) {
    throw new Error(`rb ABI ${abi} does not match worklet ABI ${RB_ABI_VERSION}`);
  }
}

/**
 * One RubberBandStretcher instance. Same method names as the old embind class,
 * so the worklets' render loops read the same; `delete()` must be called to free
 * it (as with embind).
 */
export class RubberBandStretcher {
  readonly module: RubberBandStretcherModule;
  private handle: number;

  constructor(
    module: RubberBandStretcherModule,
    sampleRate: number,
    channels: number,
    options: number,
    timeRatio = 1.0,
    pitchScale = 1.0,
  ) {
    this.module = module;
    this.handle = module._rb_create(sampleRate, channels, options, timeRatio, pitchScale);
    if (!this.handle) {
      throw new Error(`rb_create(${sampleRate}, ${channels}, ${options}) failed`);
    }
  }

  reset(): void { this.module._rb_reset(this.handle); }
  setTimeRatio(ratio: number): void { this.module._rb_set_time_ratio(this.handle, ratio); }
  setPitchScale(scale: number): void { this.module._rb_set_pitch_scale(this.handle, scale); }
  getTimeRatio(): number { return this.module._rb_get_time_ratio(this.handle); }
  getPitchScale(): number { return this.module._rb_get_pitch_scale(this.handle); }
  setFormantOption(option: number): void { this.module._rb_set_formant_option(this.handle, option); }
  getSamplesRequired(): number { return this.module._rb_get_samples_required(this.handle); }
  getLatency(): number { return this.module._rb_get_latency(this.handle); }
  getChannelCount(): number { return this.module._rb_get_channel_count(this.handle); }
  available(): number { return this.module._rb_available(this.handle); }

  /** `inputPtr`: byte offset of `frames` planar samples per channel. */
  process(inputPtr: number, frames: number, final: boolean): void {
    this.module._rb_process(this.handle, inputPtr, frames, final ? 1 : 0);
  }

  /** `outputPtr`: byte offset with room for `frames` per channel. Returns frames written. */
  retrieve(outputPtr: number, frames: number): number {
    return this.module._rb_retrieve(this.handle, outputPtr, frames);
  }

  /** Frees the native stretcher. Idempotent; the object is unusable afterwards. */
  delete(): void {
    if (!this.handle) return;
    this.module._rb_destroy(this.handle);
    this.handle = 0;
  }
}
