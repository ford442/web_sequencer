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
// Two ways through the same filter, over the same coefficients and f64 state:
//
//   tick        one sample, scalar. What the streaming `wamFilter.ts` runs, and the
//               remainder (< 4 frames) of a render in `oscillators.ts`.
//   block4      four consecutive samples at once, `f64x2` lanes (SIMD, #1663). A biquad
//               is a recurrence, so four samples cannot share one set of splatted
//               coefficients; instead the recurrence is advanced four steps in closed
//               form (see "Block form" below). Same filter, same f64 state, so the
//               low-cutoff precision that ruled out f32 is kept.
//
// SIMD here is the baseline `simd128` set only: the build targets the Safari
// intersection (simd + bulk-memory, no WasmGC, no relaxed-simd, no threads). In
// particular nothing below is a fused multiply-add: `relaxed_madd` is relaxed SIMD.
// See docs/wasm/BUILD_NOTES.md.

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

// --- Block form: four samples per step ------------------------------------------
//
// Transposed direct form II is the state-space system
//
//   z' = A z + B x        y = C z + D x
//   A = [[-a1, 1], [-a2, 0]]   B = [b1 - a1 b0, b2 - a2 b0]   C = [1, 0]   D = b0
//
// so advancing four samples is a matrix identity, not an approximation:
//
//   y[k] = (A^k)[0,:] . z  +  sum_{j<=k} h[k-j] x[j]       h[0] = D, h[m] = C A^(m-1) B
//   z'   = A^4 z           +  sum_{j<4}  A^(3-j) B x[j]
//
// Every coefficient below is computed once per `prepareBlock4` in f64. A step is
// then a handful of `f64x2` multiply-adds, and the only loop-carried dependency is
// z -> z' (one multiply and one add deep), where `tick` carries three dependent
// operations *per sample*.

// Outputs y0..y3 as two lane pairs (y0,y1) and (y2,y3).
let kYz1a: v128 = f64x2.splat(0.0); // per old z1
let kYz2a: v128 = f64x2.splat(0.0); // per old z2
let kYz1b: v128 = f64x2.splat(0.0);
let kYz2b: v128 = f64x2.splat(0.0);
let kT0a: v128 = f64x2.splat(0.0); // per x0: (h0, h1)
let kT0b: v128 = f64x2.splat(0.0); //         (h2, h3)
let kT1a: v128 = f64x2.splat(0.0); // per x1: (0, h0)
let kT1b: v128 = f64x2.splat(0.0); //         (h1, h2)
let kT2b: v128 = f64x2.splat(0.0); // per x2: (h0, h1) into y2, y3 (nothing into y0, y1)
let kT3b: v128 = f64x2.splat(0.0); // per x3: (0, h0)  into y2, y3
// New state (z1', z2') as lane pair.
let kSz1: v128 = f64x2.splat(0.0); // per old z1: A^4 column 0
let kSz2: v128 = f64x2.splat(0.0); // per old z2: A^4 column 1
let kG0: v128 = f64x2.splat(0.0); // per x0: A^3 B
let kG1: v128 = f64x2.splat(0.0); //         A^2 B
let kG2: v128 = f64x2.splat(0.0); //         A B
let kG3: v128 = f64x2.splat(0.0); //         B

/**
 * Derive the block-of-four coefficients from the current `setCoefficients`. Call it
 * after every `setCoefficients` and before `block4`; the streaming filter never
 * does, so it pays nothing for any of this.
 */
export function prepareBlock4(): void {
  // B and the impulse response h[0..3].
  const bb1 = b1 - a1 * b0;
  const bb2 = b2 - a2 * b0;
  // w_m = A^m B, as (z1 part, z2 part): w_{m+1} = (-a1 w[0] + w[1], -a2 w[0]).
  const w1a = -a1 * bb1 + bb2;
  const w1b = -a2 * bb1;
  const w2a = -a1 * w1a + w1b;
  const w2b = -a2 * w1a;
  const w3a = -a1 * w2a + w2b;
  const w3b = -a2 * w2a;
  const h0 = b0;
  const h1 = bb1;
  const h2 = w1a;
  const h3 = w2a;

  // First rows of A^k: r_{k+1} = (-a1 p - a2 q, p) for r_k = (p, q).
  const r1p = -a1;
  const r1q = 1.0;
  const r2p = -a1 * r1p - a2 * r1q;
  const r2q = r1p;
  const r3p = -a1 * r2p - a2 * r2q;
  const r3q = r2p;

  // A^4 = (A^2)^2, with A^2 = [[a1^2 - a2, -a1], [a1 a2, -a2]].
  const m00 = a1 * a1 - a2;
  const m01 = -a1;
  const m10 = a1 * a2;
  const m11 = -a2;
  const s00 = m00 * m00 + m01 * m10;
  const s01 = m00 * m01 + m01 * m11;
  const s10 = m10 * m00 + m11 * m10;
  const s11 = m10 * m01 + m11 * m11;

  kYz1a = f64x2(1.0, r1p);
  kYz2a = f64x2(0.0, r1q);
  kYz1b = f64x2(r2p, r3p);
  kYz2b = f64x2(r2q, r3q);
  kT0a = f64x2(h0, h1);
  kT0b = f64x2(h2, h3);
  kT1a = f64x2(0.0, h0);
  kT1b = f64x2(h1, h2);
  kT2b = f64x2(h0, h1);
  kT3b = f64x2(0.0, h0);
  kSz1 = f64x2(s00, s10);
  kSz2 = f64x2(s01, s11);
  kG0 = f64x2(w3a, w3b);
  kG1 = f64x2(w2a, w2b);
  kG2 = f64x2(w1a, w1b);
  kG3 = f64x2(bb1, bb2);
}

/** The scalar state as a lane pair (z1, z2), for the block loop to carry in a local. */
@inline export function loadState4(): v128 {
  return f64x2(z1, z2);
}

/** Put a block loop's state back, so `tick` (and the next pass) carry on from it. */
@inline export function storeState4(z: v128): void {
  z1 = f64x2.extract_lane(z, 0);
  z2 = f64x2.extract_lane(z, 1);
}

/**
 * Four consecutive samples through the filter. `x` is four f32 input samples; the
 * state is passed in and returned (a caller's local, so it stays in a register: a
 * module global here would put a store/load round trip on the critical path). When
 * `ptr` >= 0 the four outputs are stored there as f32 — the priming pass of a loop
 * table passes -1 and skips all of the output arithmetic.
 */
@inline export function block4(x: v128, z: v128, ptr: i32): v128 {
  const x01 = f64x2.promote_low_f32x4(x);
  const x23 = f64x2.promote_low_f32x4(f32x4.shuffle(x, x, 2, 3, 2, 3));
  const x0 = f64x2.shuffle(x01, x01, 0, 0);
  const x1 = f64x2.shuffle(x01, x01, 1, 1);
  const x2 = f64x2.shuffle(x23, x23, 0, 0);
  const x3 = f64x2.shuffle(x23, x23, 1, 1);
  const zz1 = f64x2.shuffle(z, z, 0, 0);
  const zz2 = f64x2.shuffle(z, z, 1, 1);

  if (ptr >= 0) {
    const ya = f64x2.add(
      f64x2.add(f64x2.mul(zz1, kYz1a), f64x2.mul(zz2, kYz2a)),
      f64x2.add(f64x2.mul(x0, kT0a), f64x2.mul(x1, kT1a)),
    );
    const yb = f64x2.add(
      f64x2.add(
        f64x2.add(f64x2.mul(zz1, kYz1b), f64x2.mul(zz2, kYz2b)),
        f64x2.add(f64x2.mul(x0, kT0b), f64x2.mul(x1, kT1b)),
      ),
      f64x2.add(f64x2.mul(x2, kT2b), f64x2.mul(x3, kT3b)),
    );
    v128.store(
      ptr,
      f32x4.shuffle(f32x4.demote_f64x2_zero(ya), f32x4.demote_f64x2_zero(yb), 0, 1, 4, 5),
      0,
      4,
    );
  }

  // Input-driven part first (off the critical path), then the one-multiply-deep
  // recurrence on z.
  const drive = f64x2.add(
    f64x2.add(f64x2.mul(x0, kG0), f64x2.mul(x1, kG1)),
    f64x2.add(f64x2.mul(x2, kG2), f64x2.mul(x3, kG3)),
  );
  return f64x2.add(f64x2.add(f64x2.mul(zz1, kSz1), f64x2.mul(zz2, kSz2)), drive);
}
