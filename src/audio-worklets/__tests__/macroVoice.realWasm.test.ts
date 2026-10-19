import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resetHyphonNativeSessionForTests } from '../hyphonNativeSession';
import { instantiateOfflineMacroFromBytes, renderMacroOffline } from '../../audio/offline/OfflineMacroEngine';
import { macroEngineForWaveform, macroNativeParams, MacroParam, resolveMacroParams } from '../../engines/MacroParams';
import { DEFAULT_SYNTH_PARAMS_A } from '../../constants';
import type { SynthParams } from '../../types';

/**
 * The macro engine end to end on the real hyphon_native.st.wasm: the
 * macro-processor worklet bundle plays a chord in stereo, a note starts on the
 * 48 kHz control block that follows its frame, and the offline renderer (the
 * same wasm on a plain thread, 4096-frame blocks) is bit-identical to the
 * live worklet (128-frame blocks) for the same events — so a freeze or stem
 * matches what was heard.
 *
 * Integration tier (vitest.integration.files.ts): CI builds the native module
 * first and sets HYPHON_REQUIRE_NATIVE=1; elsewhere the suite skips without it.
 */

const WASM = resolve(__dirname, '../../../public/hyphon_native.st.wasm');
const MAP = resolve(__dirname, '../../../public/hyphon_wasm_export_map.st.json');
const SAMPLE_RATE = 48000;
const BLOCK = 128;

class FakePort {
  onmessage: ((e: MessageEvent) => unknown) | null = null;
  readonly posted: Array<{ type: string; error?: string; engineCount?: number }> = [];
  postMessage(msg: { type: string }) {
    this.posted.push({ ...msg });
  }
  addEventListener() {}
  removeEventListener() {}
  deliver(data: unknown) {
    return this.onmessage?.({ data } as MessageEvent);
  }
}

type Voice = {
  port: FakePort;
  process: (inputs: Float32Array[][], outputs: Float32Array[][], params: Record<string, Float32Array>) => boolean;
};
type VoiceCtor = new () => Voice;
const registered = new Map<string, VoiceCtor>();
const g = globalThis as {
  currentFrame?: number;
  sampleRate?: number;
  AudioWorkletProcessor?: new () => { port: FakePort };
  registerProcessor?: (name: string, ctor: VoiceCtor) => void;
};

const haveWasm = existsSync(WASM) && existsSync(MAP);
const nativeRequired = process.env.HYPHON_REQUIRE_NATIVE === '1';

beforeAll(async () => {
  g.AudioWorkletProcessor = class {
    readonly port = new FakePort();
  };
  g.registerProcessor = (name, ctor) => registered.set(name, ctor);
  g.sampleRate = SAMPLE_RATE;
  await import('../macro-processor');
});

afterAll(() => {
  delete g.currentFrame;
  delete g.sampleRate;
});

afterEach(() => {
  vi.restoreAllMocks();
  resetHyphonNativeSessionForTests();
});

const wasmBytes = () => {
  const wasm = readFileSync(WASM);
  return wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength);
};
const exportMap = () => JSON.parse(readFileSync(MAP, 'utf8')) as Record<string, string>;

const PART: SynthParams = {
  ...DEFAULT_SYNTH_PARAMS_A,
  waveform: 'macro-va',
  volume: 0.8,
  pitch: 0,
  macro: { harmonics: 0.3, timbre: 0.4, morph: 0.6, spread: 0.5 },
};

/** The patch as the flat [id, value, …] the oscillator posts. */
function patch(): number[] {
  const native = macroNativeParams(macroEngineForWaveform('macro-va')!, resolveMacroParams(PART.macro), PART.volume);
  native.push([MacroParam.TRANSPOSE, 0]);
  return native.flat();
}

async function bootWorklet(): Promise<Voice> {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const v = new (registered.get('macro-processor')!)();
  await v.port.deliver({
    type: 'init-wasm',
    data: { wasmBytes: wasmBytes(), sampleRate: SAMPLE_RATE, isThreaded: false, variant: 'st', exportMap: exportMap() },
  });
  expect(v.port.posted.map((m) => m.type), JSON.stringify(v.port.posted)).toContain('ready');
  return v;
}

function renderWorklet(v: Voice, blocks: number): [Float32Array, Float32Array] {
  const left = new Float32Array(blocks * BLOCK);
  const right = new Float32Array(blocks * BLOCK);
  for (let b = 0; b < blocks; b++) {
    g.currentFrame = b * BLOCK;
    const l = new Float32Array(BLOCK);
    const r = new Float32Array(BLOCK);
    v.process([], [[l, r]], {});
    left.set(l, b * BLOCK);
    right.set(r, b * BLOCK);
  }
  return [left, right];
}

it.skipIf(!nativeRequired)('has the native build when HYPHON_REQUIRE_NATIVE=1', () => {
  expect(haveWasm, `${WASM} missing — build native for the integration tier`).toBe(true);
});

describe.skipIf(!haveWasm)('macro voice on the real hyphon_native.st.wasm', () => {
  const CHORD = [57, 60, 64];
  const ON = 0.01; // frame 480 — inside block 3
  const OFF = 0.3;
  const BLOCKS = 200; // 0.53 s

  it('reports all 24 models, plays a stereo chord, and starts on the next control block', async () => {
    const v = await bootWorklet();
    expect(v.port.posted.find((m) => m.type === 'ready')?.engineCount).toBe(24);
    await v.port.deliver({ type: 'set-params', data: { params: patch() } });
    for (const note of CHORD) {
      await v.port.deliver({ type: 'noteOn', data: { note, velocity: 0.9, audioTime: ON } });
      await v.port.deliver({ type: 'noteOff', data: { note, audioTime: OFF } });
    }
    const [left, right] = renderWorklet(v, BLOCKS);
    const onset = left.findIndex((s) => s !== 0);
    expect(onset).toBeGreaterThanOrEqual(480);
    expect(onset).toBeLessThan(480 + 12 + 4);
    const rms = (a: Float32Array) => Math.sqrt(a.reduce((acc, s) => acc + s * s, 0) / a.length);
    expect(rms(left.subarray(2000, 12000))).toBeGreaterThan(0.01);
    expect(left.some((s, i) => s !== right[i])).toBe(true); // spread 0.5: a stereo image
    expect(left.every(Number.isFinite) && right.every(Number.isFinite)).toBe(true);
  });

  it('renders offline bit-identically to the live worklet for the same events', async () => {
    const v = await bootWorklet();
    await v.port.deliver({ type: 'set-params', data: { params: patch() } });
    for (const note of CHORD) {
      await v.port.deliver({ type: 'noteOn', data: { note, velocity: 0.9, audioTime: ON } });
      await v.port.deliver({ type: 'noteOff', data: { note, audioTime: OFF } });
    }
    const [liveL, liveR] = renderWorklet(v, BLOCKS);

    const api = await instantiateOfflineMacroFromBytes(wasmBytes(), exportMap());
    const [offL, offR] = renderMacroOffline(api, {
      params: PART,
      engine: macroEngineForWaveform('macro-va')!,
      notes: CHORD.map((midi) => ({ midi, velocity: 0.9, startSeconds: ON, durationSeconds: OFF - ON })),
      durationSeconds: (BLOCKS * BLOCK) / SAMPLE_RATE,
      sampleRate: SAMPLE_RATE,
    });
    expect(offL.length).toBe(liveL.length);
    expect(offL.findIndex((s, i) => s !== liveL[i])).toBe(-1);
    expect(offR.findIndex((s, i) => s !== liveR[i])).toBe(-1);
  });
});
