// assembly/biquad.ts
// @mode: assemblyscript
// @note-for-ai: The ONE resonant filter of the AssemblyScript world, shared by
// `oscillators.ts` (the filter baked into a `wam-*` table) and `wamFilter.ts`
// (the streaming "WASM OSC filter" other oscillator engines can choose, #1663).
// Both compile this file into their own module, so each has its own state.
//
// RBJ biquad (Audio EQ Cookbook), transposed direct form II, f64 state.
//
// f32 direct form I cannot represent a 20 Hz lowpass at 48 kHz (a1 ~ -2 + 1e-5,
// well inside f32 rounding), so low cutoffs drifted and rang at the wrong pitch.
//
// Scalar code only: the build targets the Safari intersection (simd +
// bulk-memory, no WasmGC, no relaxed-simd). See docs/wasm/BUILD_NOTES.md.

@inline const TWO_PI: f64 = 6.283185307179586;

/** Filter response ids. The numbering is part of the ABI (`FilterType` in src/types/synth.ts). */
export const FILTER_LP: i32 = 0;
export const FILTER_BP: i32 = 1;
export const FILTER_HP: i32 = 2;

/** Hz. */
@inline const MIN_CUTOFF: f64 = 20.0;
@inline const MIN_RESONANCE: f64 = 0.1;
/** State below this magnitude is flushed to zero (denormals cost real time on some CPUs). */
@inline const DENORMAL_FLOOR: f64 = 1.0e-30;

let b0: f64 = 1.0;
let b1: f64 = 0.0;
let b2: f64 = 0.0;
let a1: f64 = 0.0;
let a2: f64 = 0.0;
let z1: f64 = 0.0;
let z2: f64 = 0.0;

/**
 * Set the coefficients for `type` at `cutoff` Hz / `resonance` (Q), leaving the
 * filter state alone — so a cutoff sweep does not click. An unknown `type` is a
 * lowpass (the JS side validates and reports; the kernel never traps).
 *
 *   LP  constant skirt-free lowpass, -12 dB/oct above `cutoff`
 *   BP  constant 0 dB peak gain (the same bandpass a BiquadFilterNode builds)
 *   HP  highpass, -12 dB/oct below `cutoff`
 *
 * `cutoff` is clamped to [20 Hz, sampleRate / 2.1] and `resonance` to >= 0.1.
 */
export function setCoefficients(sampleRate: f64, cutoff: f64, resonance: f64, type: i32): void {
  const fc = max(MIN_CUTOFF, min(cutoff, sampleRate / 2.1));
  const q = max(MIN_RESONANCE, resonance);
  const w0 = (TWO_PI * fc) / sampleRate;
  const cosW0 = Math.cos(w0);
  const alpha = Math.sin(w0) / (2.0 * q);
  const invA0 = 1.0 / (1.0 + alpha);

  if (type == FILTER_BP) {
    b0 = alpha * invA0;
    b1 = 0.0;
    b2 = -b0;
  } else if (type == FILTER_HP) {
    b0 = ((1.0 + cosW0) * 0.5) * invA0;
    b1 = -(1.0 + cosW0) * invA0;
    b2 = b0;
  } else {
    b0 = ((1.0 - cosW0) * 0.5) * invA0;
    b1 = (1.0 - cosW0) * invA0;
    b2 = b0;
  }
  a1 = -2.0 * cosW0 * invA0;
  a2 = (1.0 - alpha) * invA0;
}

/** Filter from rest. */
export function resetState(): void {
  z1 = 0.0;
  z2 = 0.0;
}

/** One sample through the filter. */
@inline export function tick(x: f64): f64 {
  const y = b0 * x + z1;
  z1 = b1 * x - a1 * y + z2;
  z2 = b2 * x - a2 * y;
  return y;
}

/** Call once per block: a silent input must not leave the state decaying into denormals. */
export function flushDenormals(): void {
  if (Math.abs(z1) < DENORMAL_FLOOR) z1 = 0.0;
  if (Math.abs(z2) < DENORMAL_FLOOR) z2 = 0.0;
}
