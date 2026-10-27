/**
 * Rubber Band's heap may grow under the live worklet, and nothing goes stale.
 *
 * public/rubberband.wasm keeps ALLOW_MEMORY_GROWTH=1 (BUILD_NOTES#rubberband-memory-growth):
 * `loadBuffer` copies the whole sample into the wasm heap (rb_fx_sample_alloc), and
 * sample length has no cap, so a fixed heap would turn a long sample into a load
 * failure. A grow replaces the wasm memory's ArrayBuffer, which detaches every
 * HEAPF32 / HEAPF64 view made before it: a write through one is dropped and a read
 * returns undefined. So every view the worklet uses must be re-derived after each
 * call that can allocate.
 *
 * This drives the real RubberBandProcessor (live vocal; the offline vocal host runs
 * the same class) and sustain-processor on the real module, each twice with the same
 * input — once untouched, once with the heap forced to grow right after each such
 * call returns, in the middle of a block — and requires the two renders to be
 * bit-identical, through the stream path, the freeze granulator and the FX chain.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { repoRoot, requireRepoArtifacts } from '@/test/helpers/requireRepoArtifacts';
import { RUBBERBAND_PARAMETER_DESCRIPTORS } from '@/audio-worklets/rubberband/parameterDescriptors';

const SR = 48000;
const QUANTUM = 128;
const BLOCKS = 240;
const FREEZE_BLOCKS = [120, 180] as const;

type HeapModule = {
  HEAPF32: Float32Array;
  HEAPF64: Float64Array;
  _malloc(n: number): number;
  _free(p: number): void;
  RubberBandStretcher: { prototype: Record<string, unknown> };
  [key: string]: unknown;
};

type Processor = {
  handleMessage(event: { data: Record<string, unknown> }): Promise<void>;
  process(inputs: unknown, outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
};

/**
 * Calls into the module that can allocate (and therefore grow the heap). The rb_fx
 * block calls (rb_fx_process, rb_fx_render_grains, rb_fx_advance_lfo) work in
 * buffers sized at rb_fx_create / *_alloc and never allocate, so a grow cannot
 * land inside them.
 */
const MODULE_ALLOCATORS = ['_malloc', '_rb_fx_sample_alloc', '_rb_fx_window_alloc'] as const;
const STRETCHER_ALLOCATORS = ['process', 'retrieve', 'setTimeRatio', 'setPitchScale'] as const;

const injection = {
  armed: false,
  /** Names whose call has had a grow injected after it this session. */
  grewAfter: new Set<string>(),
  lastModule: null as HeapModule | null,
};

/** Grows the heap by allocating until the memory's buffer changes, then frees it all again. */
function forceGrow(m: HeapModule): void {
  const before = m.HEAPF32.buffer;
  const held: number[] = [];
  for (let i = 0; i < 512 && m.HEAPF32.buffer === before; i++) {
    const p = m._malloc(1 << 20);
    if (!p) break;
    held.push(p);
  }
  for (const p of held) m._free(p);
  if (m.HEAPF32.buffer === before) throw new Error('could not force rubberband.wasm to grow');
}

/** Wraps `name` on `target` so the first armed call grows the heap before returning. */
function growAfter(target: Record<string, unknown>, name: string, m: HeapModule, label = name): void {
  const original = target[name] as (...args: unknown[]) => unknown;
  target[name] = function (this: unknown, ...args: unknown[]) {
    const result = original.apply(this, args);
    if (injection.armed && !injection.grewAfter.has(label)) {
      injection.grewAfter.add(label);
      // The wrapped forceGrow must not recurse into the _malloc wrapper's injection.
      injection.armed = false;
      forceGrow(m);
      injection.armed = true;
    }
    return result;
  };
}

vi.mock('@/audio-worklets/rubberband-lib.js', async (importOriginal) => {
  const actual = await importOriginal<{ default: (args: Record<string, unknown>) => Promise<HeapModule> }>();
  return {
    default: async (args: Record<string, unknown>) => {
      const m = await actual.default(args);
      injection.lastModule = m;
      for (const name of MODULE_ALLOCATORS) growAfter(m, name, m);
      // embind methods live on the class prototype; a fresh module has its own class.
      for (const name of STRETCHER_ALLOCATORS) {
        growAfter(m.RubberBandStretcher.prototype, name, m, `RubberBandStretcher.${name}`);
      }
      return m;
    },
  };
});

const processors = new Map<string, new () => Processor>();
const posted: unknown[] = [];
const clock = { currentTime: 0 };
const realRandom = Math.random;

beforeAll(async () => {
  requireRepoArtifacts(['public/rubberband.wasm', 'src/audio-worklets/rubberband-lib.js']);
  vi.stubGlobal('AudioWorkletProcessor', class {
    port = { postMessage: (m: unknown) => posted.push(m), onmessage: null };
  });
  vi.stubGlobal('registerProcessor', (name: string, ctor: new () => Processor) => {
    processors.set(name, ctor);
  });
  vi.stubGlobal('sampleRate', SR);
  Object.defineProperty(globalThis, 'currentTime', { get: () => clock.currentTime, configurable: true });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  await import('@/audio-worklets/rubberband-processor');
  await import('@/audio-worklets/sustain-processor');
});

afterAll(() => {
  Math.random = realRandom;
});

function params(overrides: Record<string, number>): Record<string, Float32Array> {
  return Object.fromEntries(RUBBERBAND_PARAMETER_DESCRIPTORS.map((d) => [
    d.name,
    new Float32Array([overrides[d.name] ?? d.defaultValue]),
  ]));
}

/** A 2 s sung-ish phrase: a gliding harmonic tone with a little noise. */
function phrase(): Float32Array {
  const out = new Float32Array(2 * SR);
  let x = 0x9e3779b9;
  for (let i = 0; i < out.length; i++) {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    const t = i / SR;
    const f0 = 200 + 30 * Math.sin(2 * Math.PI * 1.3 * t);
    out[i] = 0.3 * (Math.sin(2 * Math.PI * f0 * t) + 0.4 * Math.sin(4 * Math.PI * f0 * t))
      + 0.01 * (x / 4294967296 - 0.5);
  }
  return out;
}

type Session = { out: Float32Array; module: HeapModule; grewAfter: string[]; messages: unknown[] };

const INIT_WASM = () => ({
  type: 'INIT_WASM',
  inputBuffer: new SharedArrayBuffer(4096 * 4),
  outputBuffer: new SharedArrayBuffer(4096 * 4),
  wasmBinary: readFileSync(join(repoRoot(), 'public/rubberband.wasm')),
});

function resetSession(): void {
  let seed = 12345;
  Math.random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  injection.armed = false;
  injection.grewAfter = new Set();
  clock.currentTime = 0;
  posted.length = 0;
}

function endSession(out: Float32Array, module: HeapModule): Session {
  injection.armed = false;
  return { out, module, grewAfter: [...injection.grewAfter].sort(), messages: [...posted] };
}

/** RubberBandProcessor: boot, load, noteOn, stream / freeze / stream with the FX chain on. */
async function vocalSession(injectGrowth: boolean): Promise<Session> {
  resetSession();
  const processor = new (processors.get('RubberBandProcessor')!)();
  await processor.handleMessage({ data: INIT_WASM() });
  const module = injection.lastModule!;
  // Armed from here on: the sample copy, the I/O scratch and every stretcher call.
  injection.armed = injectGrowth;
  await processor.handleMessage({ data: { type: 'loadBuffer', data: { buffer: phrase().buffer } } });
  await processor.handleMessage({
    data: { type: 'setCustomWindowShape', data: { shape: Array.from({ length: 512 }, (_, i) => Math.sin((Math.PI * i) / 511)) } },
  });
  await processor.handleMessage({ data: { type: 'noteOn', data: { pitch: 1.2, velocity: 0.9 } } });

  const fxOn = { timeRatio: 1.3, vocalChorus: 0.5, spectralComp: 0.4, subHarmonics: 0.3, grainJitter: 0.3, vibratoDepth: 0.2 };
  const streaming = params(fxOn);
  const frozen = params({ ...fxOn, freeze: 1 });
  const out = new Float32Array(BLOCKS * QUANTUM);
  for (let b = 0; b < BLOCKS; b++) {
    const l = new Float32Array(QUANTUM);
    const r = new Float32Array(QUANTUM);
    processor.process([], [[l, r]], b >= FREEZE_BLOCKS[0] && b < FREEZE_BLOCKS[1] ? frozen : streaming);
    out.set(l, b * QUANTUM);
    clock.currentTime += QUANTUM / SR;
  }
  return endSession(out, module);
}

/** sustain-processor in RUBBERBAND mode: noteOn feeds the whole slice, blocks retrieve it. */
async function sustainSession(injectGrowth: boolean): Promise<Session> {
  resetSession();
  const processor = new (processors.get('sustain-processor')!)() as Processor & {
    port: { onmessage: (e: { data: Record<string, unknown> }) => Promise<void> };
  };
  const send = (data: Record<string, unknown>) => processor.port.onmessage({ data });
  await send(INIT_WASM());
  const module = injection.lastModule!;
  injection.armed = injectGrowth;
  await send({ type: 'loadBuffer', data: { buffer: phrase().buffer } });
  await send({ type: 'enableRubberBand', data: { enabled: true } });
  await send({ type: 'noteOn', data: { pitch: 1.5 } });

  const parameters = {
    mode: new Float32Array([3]),
    bpm: new Float32Array([120]),
    arp: new Float32Array([0]),
    pitch: new Float32Array([1.5]),
    frequency: new Float32Array([220]),
  };
  const out = new Float32Array(BLOCKS * QUANTUM);
  for (let b = 0; b < BLOCKS; b++) {
    const l = new Float32Array(QUANTUM);
    const r = new Float32Array(QUANTUM);
    processor.process([], [[l, r]], parameters);
    out.set(l, b * QUANTUM);
  }
  return endSession(out, module);
}

function expectBitIdentical(reference: Session, grown: Session): void {
  const budget = JSON.parse(readFileSync(join(repoRoot(), 'emscripten/wasm_memory_budget.json'), 'utf8'));
  const initialBytes = budget.rubberband.initialMemoryMb * 1024 * 1024;
  expect(reference.module.HEAPF32.buffer.byteLength, 'reference session must not grow').toBe(initialBytes);
  expect(grown.module.HEAPF32.buffer.byteLength).toBeGreaterThan(initialBytes);

  let energy = 0;
  for (const v of reference.out) energy += v * v;
  expect(energy, 'the session must actually sing').toBeGreaterThan(1);
  let firstDiff = -1;
  for (let i = 0; i < reference.out.length; i++) {
    if (!Object.is(reference.out[i], grown.out[i])) { firstDiff = i; break; }
  }
  expect(firstDiff, `first differing sample (block ${Math.floor(firstDiff / QUANTUM)})`).toBe(-1);
}

describe('rubberband.wasm heap growth under the live worklets', () => {
  it('RubberBandProcessor renders bit-identically when the heap grows after every allocating call', async () => {
    const reference = await vocalSession(false);
    const grown = await vocalSession(true);

    // Every allocating call the session makes had a grow land right after it.
    expect(grown.grewAfter).toEqual([
      'RubberBandStretcher.process',
      'RubberBandStretcher.retrieve',
      'RubberBandStretcher.setPitchScale',
      'RubberBandStretcher.setTimeRatio',
      '_malloc',
      '_rb_fx_sample_alloc',
      '_rb_fx_window_alloc',
    ]);
    // A stale view that threw would have dropped the session onto the TS chain.
    for (const s of [reference, grown]) {
      expect(s.messages.filter((m) => (m as { type?: string }).type === 'FX_BACKEND')).toEqual([]);
    }
    expectBitIdentical(reference, grown);
  });

  it('sustain-processor renders bit-identically when the heap grows after every allocating call', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const reference = await sustainSession(false);
    const grown = await sustainSession(true);

    expect(grown.grewAfter).toEqual([
      'RubberBandStretcher.process',
      'RubberBandStretcher.retrieve',
      'RubberBandStretcher.setPitchScale',
      'RubberBandStretcher.setTimeRatio',
      '_malloc',
    ]);
    // Rubber Band's own overrun warnings (the whole slice is fed at noteOn) are
    // expected; a stale view would surface as the processor's DSP error.
    expect(errors).not.toHaveBeenCalledWith('Rubber Band DSP Error:', expect.anything());
    errors.mockRestore();
    expectBitIdentical(reference, grown);
  });
});
