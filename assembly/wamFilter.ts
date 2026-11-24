// assembly/wamFilter.ts
// @mode: assemblyscript
// @note-for-ai: The "WASM OSC filter" (#1663): the same resonant biquad that is
// baked into a `wam-*` table (`oscillators.ts` -> `biquad.ts`), exposed as a
// STREAMING filter so any oscillator engine can pick it as its filter stage.
// Output: src/wasm/wamFilter.wasm. Worklet: src/audio-worklets/wam-filter-processor.ts.
// Main-thread bridge: src/engines/WamFilter.ts.
//
// Why its own module and not exports on oscillators.wasm: that module is sized
// for wavetables (24 MB initial memory, a heap, an abort import), and one filter
// instance runs per synth voice inside an AudioWorklet. This one is a single
// 64 KiB page of static buffers, no heap, no imports, no growth — the
// worklet-wasm rules in CLAUDE.md ("no worklet-loaded wasm may grow memory or throw").
//
// Scalar code only (Safari intersection: simd + bulk-memory, no WasmGC).
//
// Protocol, per audio block of n <= MAX_FRAMES frames:
//   write n f32 samples at inPtr()
//   configure(sampleRate, cutoff, resonance, type)   -- only when something changed
//   process(n)                                       -- n f32 samples appear at outPtr()
// State persists across blocks (and across `configure`, so sweeps do not click);
// `reset()` filters from rest again.

import { FILTER_LP, FILTER_HP, setCoefficients, resetState, tick, flushDenormals } from './biquad';

/** Must equal WAM_FILTER_ABI_VERSION in src/audio-worklets/wamFilter.ts. */
@inline const ABI_VERSION: i32 = 1;
/** Frames per call. The worklet quantum is 128; leave room for larger render quanta. */
@inline const MAX_FRAMES: i32 = 1024;

const IN_BUF: usize = memory.data(MAX_FRAMES << 2);
const OUT_BUF: usize = memory.data(MAX_FRAMES << 2);

export function abiVersion(): i32 {
  return ABI_VERSION;
}

export function maxFrames(): i32 {
  return MAX_FRAMES;
}

export function inPtr(): usize {
  return IN_BUF;
}

export function outPtr(): usize {
  return OUT_BUF;
}

/**
 * Set rate, cutoff (Hz), resonance (Q) and response (0 LP, 1 BP, 2 HP).
 * Returns 1, or 0 — leaving the previous coefficients in place — when an
 * argument is unusable (non-finite, non-positive rate, unknown type).
 */
export function configure(sampleRate: f32, cutoff: f32, resonance: f32, type: i32): i32 {
  if (!(sampleRate > 0.0) || !isFinite(sampleRate)) return 0;
  if (!isFinite(cutoff) || !isFinite(resonance)) return 0;
  if (type < FILTER_LP || type > FILTER_HP) return 0;
  setCoefficients(f64(sampleRate), f64(cutoff), f64(resonance), type);
  return 1;
}

/** Filter from rest. */
export function reset(): void {
  resetState();
}

/** Filter `frames` samples from inPtr() to outPtr(). Returns the frames done (0 if out of range). */
export function process(frames: i32): i32 {
  if (frames < 0 || frames > MAX_FRAMES) return 0;
  for (let i = 0; i < frames; i++) {
    store<f32>(OUT_BUF + (<usize>i << 2), <f32>tick(<f64>load<f32>(IN_BUF + (<usize>i << 2))));
  }
  flushDenormals();
  return frames;
}
