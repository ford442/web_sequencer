// assembly/oscillators.ts
// @mode: assemblyscript
// @note-for-ai: This is the AssemblyScript implementation of the oscillator DSP.
// It is compiled to WASM via: npm run build:wasm
// Output: src/wasm/oscillators.wasm
// Bridge file: src/engines/WasmOscillator.ts
//
// Design constraints for WASM modules:
// - Only use primitive types (f32, f64, i32) — no JS objects, no managed heap
// - Direct memory access via store<type>(offset, value)
// - SIMD is the baseline `simd128` set only (the build targets the Safari
//   intersection: simd + bulk-memory, no WasmGC, no relaxed-simd, no threads — so
//   no `relaxed_madd`, no relaxed min/max). See docs/wasm/BUILD_NOTES.md.
//
// Two entry points share one renderer:
//
//   generate      a one-shot note. Exactly `sampleRate * duration` frames, the
//                 filter starts from rest (the attack transient is the sound).
//
//   generateLoop  a wavetable for a looped AudioBufferSourceNode. The length is
//                 snapped to a whole number of cycles so the wrap is
//                 phase-continuous, and the filter is run to steady state before
//                 the frames that are kept, so the wrap is also *filter*-continuous.
//                 Without both, every wrap of the loop clicks.
//
// The filter is selectable: low / band / high pass (`filterType`, the last
// argument; 0 = lowpass, which is also what a caller that predates it gets). The
// biquad itself lives in `biquad.ts`, shared with the streaming `wamFilter.ts`
// module other oscillator engines can pick as their resonant filter (#1663).
//
// Four frames per iteration (#1663). The phase is computed in `f64x2` from the frame
// index exactly as before, turned into a *signed distance from each edge* in units of
// one sample, and only then narrowed to `f32x4`: the shape, its PolyBLEP/BLAMP
// residuals and the sine run branch-free on those. The filter is the exact
// four-samples-at-once form of `biquad.ts` in `f64x2` lanes. The scalar functions
// below survive for the 0-3 frames left over at the end of a pass.
//
// Shapes are band-limited at the source (PolyBLEP for the saw and square
// edges, PolyBLAMP for the triangle's slope breaks), not by the biquad: the
// filter's cutoff is a musical control, and it was doing double duty as the
// only thing standing between the naive edges and the alias products.

import {
  FILTER_LP,
  FILTER_HP,
  setCoefficients,
  prepareBlock4,
  resetState,
  tick,
  loadState4,
  storeState4,
  block4,
} from './biquad';

@inline const TWO_PI: f64 = 6.283185307179586;

/** Hz. Below this a "cycle" is longer than any table could hold. */
@inline const MIN_FREQ: f64 = 1.0;
/** Fraction of the sample rate. Keeps dt < 0.5 so a residual never overlaps itself. */
@inline const MAX_FREQ_RATIO: f64 = 0.49;
/**
 * Loop mode replays this many seconds of the (periodic) signal through the filter
 * before keeping a frame. Ten time constants of a Q 12 lowpass at 300 Hz.
 */
@inline const PRIME_SECONDS: f64 = 0.5;

// --- Band-limited residuals ---------------------------------------------------
//
// `t` is the phase distance past the discontinuity (wrapped to [0, 1)), `dt` the
// phase increment per sample. Both residuals are non-zero only within one sample
// of the event, on either side of it.

/** PolyBLEP: the correction for a unit step. Subtract (rising: add) scaled by the step. */
@inline function polyBlep(t: f64, dt: f64): f64 {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1.0;
  }
  if (t > 1.0 - dt) {
    const x = (t - 1.0) / dt;
    return x * x + x + x + 1.0;
  }
  return 0.0;
}

/**
 * PolyBLAMP: the correction for a unit-slope-change corner, in units of
 * (slope per sample). Always >= 0, centred value dt/6 — the integral of the
 * PolyBLEP's triangle kernel twice.
 */
@inline function polyBlamp(t: f64, dt: f64): f64 {
  if (t < dt) {
    const x = t / dt - 1.0;
    return -(x * x * x) * (1.0 / 6.0);
  }
  if (t > 1.0 - dt) {
    const x = (t - 1.0) / dt + 1.0;
    return x * x * x * (1.0 / 6.0);
  }
  return 0.0;
}

@inline function shapeSample(type: i32, p: f64, dt: f64): f64 {
  if (type == 0) {
    // Saw, -1..1, one downward step of 2 at the wrap.
    return 2.0 * p - 1.0 - polyBlep(p, dt);
  }
  // The half-cycle point, wrapped.
  let q: f64 = p + 0.5;
  if (q >= 1.0) q -= 1.0;
  if (type == 1) {
    // Square, 50% duty: +2 step at p = 0, -2 step at p = 0.5.
    return (p < 0.5 ? 1.0 : -1.0) + polyBlep(p, dt) - polyBlep(q, dt);
  }
  if (type == 2) {
    // Triangle, valley at p = 0 (slope -4 -> +4), peak at p = 0.5 (+4 -> -4).
    // The slope change is 8 per cycle = 8 * dt per sample at each corner.
    return 1.0 - 4.0 * Math.abs(p - 0.5) + 8.0 * dt * (polyBlamp(p, dt) - polyBlamp(q, dt));
  }
  return Math.sin(TWO_PI * p);
}

// --- Four frames at a time ------------------------------------------------------
//
// Every shape is built from the phase `s1 = p - 0.5` (exact in f64, then narrowed) and
// the signed distance, in samples, to each of its two edges:
//
//   x0 = (p wrapped to [-0.5, 0.5)) / dt      the edge at p = 0, the wrap
//   x1 = s1 / dt                              the edge at p = 0.5
//
// A residual is non-zero only for |x| < 1. Both are formed so that they are precise
// exactly where they matter: near its own edge a distance is tiny, and f32 keeps a tiny
// number to full relative precision, which a phase near 1.0 does not. So x0 is
// subtracted and scaled in f64 *before* it is narrowed; x1 can be scaled after, because
// s1 is itself small wherever x1 is non-zero. The naive shapes come from s1 alone:
// saw 2 s1, triangle 1 - 4|s1|, square sign(-s1), sine -sin(2 pi s1).

// Sign-bit masks. Selecting a sign with integer ops instead of compare + `bitselect` is
// not style: V8's lowering of that pair measured ~2x slower for the same result.
const SIGN32: v128 = v128.splat<i32>(i32.MIN_VALUE);
const SIGN64: v128 = v128.splat<i64>(i64.MIN_VALUE);

/** PolyBLEP of an edge `x` samples away: -(1 - x)^2 past it, (1 + x)^2 before it, 0 beyond one sample. */
@inline function blepV(x: v128): v128 {
  const m = f32x4.pmax(f32x4.sub(f32x4.splat(1.0), f32x4.abs(x)), f32x4.splat(0.0));
  const r = f32x4.mul(m, m);
  // Negate where x >= 0 (sign bit clear): flip r's sign bit by the *inverse* of x's.
  return v128.xor(r, v128.andnot(SIGN32, x));
}

/** PolyBLAMP of a corner `x` samples away: (1 - |x|)^3 / 6 inside one sample, 0 beyond. */
@inline function blampV(x: v128): v128 {
  const m = f32x4.pmax(f32x4.sub(f32x4.splat(1.0), f32x4.abs(x)), f32x4.splat(0.0));
  return f32x4.mul(f32x4.mul(f32x4.mul(m, m), m), f32x4.splat(1.0 / 6.0));
}

// sin(2 pi a) on a in [0, 0.25] as a * (K1 + K3 a^2 + K5 a^4 + K7 a^6 + K9 a^8):
// near-minimax fit, 3.3e-9 in f64, about 2e-7 absolute once every step is rounded to f32.
@inline const SIN_K1: f32 = 6.28318516;
@inline const SIN_K3: f32 = -41.341655;
@inline const SIN_K5: f32 = 81.601004;
@inline const SIN_K7: f32 = -76.549771;
@inline const SIN_K9: f32 = 39.536612;

/** sin(2 pi u) for u in [-0.5, 0.5]: fold to [0, 0.25] by the sine's symmetries, then the polynomial. */
@inline function sinTurnsV(u: v128): v128 {
  const a = f32x4.abs(u);
  const f = f32x4.pmin(a, f32x4.sub(f32x4.splat(0.5), a));
  const f2 = f32x4.mul(f, f);
  let p = f32x4.add(f32x4.mul(f32x4.splat(SIN_K9), f2), f32x4.splat(SIN_K7));
  p = f32x4.add(f32x4.mul(p, f2), f32x4.splat(SIN_K5));
  p = f32x4.add(f32x4.mul(p, f2), f32x4.splat(SIN_K3));
  p = f32x4.add(f32x4.mul(p, f2), f32x4.splat(SIN_K1));
  // p * f >= 0: give it u's sign.
  return v128.or(f32x4.mul(p, f), v128.and(u, SIGN32));
}

/** Two f64x2 -> one f32x4, in lane order. */
@inline function narrow(lo: v128, hi: v128): v128 {
  return f32x4.shuffle(f32x4.demote_f64x2_zero(lo), f32x4.demote_f64x2_zero(hi), 0, 1, 4, 5);
}

/**
 * Four consecutive frames of the shape, `i`..`i + 3`, as f32x4. `dt8` is 8 * dt, the
 * triangle's corner scale; `invDt` is 1 / dt.
 */
@inline function shapeBlock(type: i32, i: i32, dt: f64, invDt: f64, dt8: f32): v128 {
  const idx = f64x2.splat(f64(i));
  const r0 = f64x2.mul(f64x2.add(idx, f64x2(0.0, 1.0)), f64x2.splat(dt));
  const r1 = f64x2.mul(f64x2.add(idx, f64x2(2.0, 3.0)), f64x2.splat(dt));
  const p0 = f64x2.sub(r0, f64x2.floor(r0));
  const p1 = f64x2.sub(r1, f64x2.floor(r1));

  const half = f64x2.splat(0.5);
  const s1a = f64x2.sub(p0, half);
  const s1b = f64x2.sub(p1, half);
  const s1 = narrow(s1a, s1b);

  if (type == 0 || type == 1 || type == 2) {
    const k = f64x2.splat(invDt);
    // The phase wrapped to [-0.5, 0.5): s1 -/+ 0.5, i.e. p - 1 once p >= 0.5, else p. Both exact in f64.
    const half64 = f64x2.splat(0.5);
    const s0a = f64x2.add(s1a, v128.xor(half64, v128.andnot(SIGN64, s1a)));
    const s0b = f64x2.add(s1b, v128.xor(half64, v128.andnot(SIGN64, s1b)));
    const x0 = narrow(f64x2.mul(s0a, k), f64x2.mul(s0b, k));

    if (type == 0) {
      // Saw: 2p - 1 = 2 s1, one downward step of 2 at the wrap.
      return f32x4.sub(f32x4.add(s1, s1), blepV(x0));
    }
    // Near its own edge s1 is tiny, and f32 keeps a tiny number to full relative precision.
    const x1 = f32x4.mul(s1, f32x4.splat(f32(invDt)));
    if (type == 1) {
      // Square, 50% duty: +1 while p < 0.5 (s1 < 0), -1 after; +2 edge at 0, -2 at 0.5.
      const level = v128.xor(f32x4.splat(1.0), v128.andnot(SIGN32, s1));
      return f32x4.sub(f32x4.add(level, blepV(x0)), blepV(x1));
    }
    // Triangle: valley at p = 0, peak at p = 0.5, slope change 8 dt per sample at each corner.
    const naive = f32x4.sub(f32x4.splat(1.0), f32x4.mul(f32x4.splat(4.0), f32x4.abs(s1)));
    return f32x4.add(naive, f32x4.mul(f32x4.splat(dt8), f32x4.sub(blampV(x0), blampV(x1))));
  }
  // sin(2 pi p) = -sin(2 pi s1)
  return f32x4.neg(sinTurnsV(s1));
}

/**
 * Run frame indices [from, to) of the shape through the filter, advancing the
 * filter state. `write` false is the loop mode's priming: same arithmetic, no
 * stores. Frame `i` is stored at `offset + 4 * (i - from)`.
 *
 * Phase is computed from the frame index rather than accumulated, so a long
 * render cannot drift, and a loop of `frames` frames returns to exactly phase 0
 * at index `frames` — which is what lets priming start anywhere in the cycle.
 *
 * Whole groups of four frames take the SIMD path; the 0-3 left over are the same
 * arithmetic one frame at a time.
 */
function renderPass(offset: i32, from: i32, to: i32, dt: f64, type: i32, write: bool): void {
  let i = from;

  if (to - from >= 4) {
    const invDt: f64 = 1.0 / dt;
    const dt8: f32 = f32(8.0 * dt);
    let z = loadState4();
    for (; to - i >= 4; i += 4) {
      const x = shapeBlock(type, i, dt, invDt, dt8);
      z = block4(x, z, write ? offset + ((i - from) << 2) : -1);
    }
    storeState4(z);
  }

  for (; i < to; i++) {
    let p: f64 = f64(i) * dt;
    p -= Math.floor(p);

    const x = shapeSample(type, p, dt);
    const y = tick(x);

    if (write) store<f32>(offset + ((i - from) << 2), f32(y));
  }
}

/** Whole f32 frames that fit between `offset` and the end of linear memory. */
function capacityFrames(offset: i32): i32 {
  const bytes: i64 = (i64(memory.size()) << 16) - i64(offset);
  return bytes > 0 ? i32(bytes >> 2) : 0;
}

function render(
  offset: i32,
  sampleRate: f64,
  freq: f64,
  duration: f64,
  type: i32,
  cutoff: f64,
  resonance: f64,
  filterType: i32,
  loop: bool,
): i32 {
  // `!(x > 0)` rather than `x <= 0`: NaN must land on the failure side.
  if (offset < 0 || !(sampleRate > 0.0) || !(freq > 0.0) || !(duration > 0.0)) return 0;
  if (!isFinite(sampleRate) || !isFinite(freq) || !isFinite(duration)) return 0;
  // Out-of-range filterType would silently be a lowpass inside the kernel; refuse
  // it instead, so the JS side's validation is the only place a type is chosen.
  if (filterType < FILTER_LP || filterType > FILTER_HP) return 0;

  const capacity = capacityFrames(offset);
  if (capacity <= 0) return 0;

  const f = max(MIN_FREQ, min(freq, sampleRate * MAX_FREQ_RATIO));
  // NaN cutoff/resonance: fall back to a wide-open, flat filter instead of NaN out
  // ("open" is the top of the range for a low/band pass, the bottom for a high pass).
  const fc: f64 = cutoff == cutoff ? cutoff : filterType == FILTER_HP ? 0.0 : sampleRate;
  const q: f64 = resonance == resonance ? resonance : 0.7071;
  setCoefficients(sampleRate, fc, q, filterType);
  prepareBlock4();
  resetState();

  if (!loop) {
    const wanted: f64 = floor(sampleRate * duration);
    const frames: i32 = i32(min(wanted, f64(capacity)));
    renderPass(offset, 0, frames, f / sampleRate, type, true);
    return frames;
  }

  // Loop table: an integer number of cycles in an integer number of frames. The
  // pitch is moved by at most half a frame per table (< 0.01 cent at 2 s), which
  // is what buys a seamless wrap.
  const framesPerCycle: f64 = sampleRate / f;
  let cycles: f64 = max(1.0, Math.round(duration * f));
  if (cycles * framesPerCycle > f64(capacity)) {
    cycles = Math.floor(f64(capacity) / framesPerCycle);
    if (cycles < 1.0) return 0; // one cycle does not fit
  }
  const frames: i32 = i32(max(1.0, Math.round(cycles * framesPerCycle)));
  if (frames > capacity) return 0;
  const dt: f64 = cycles / f64(frames);

  // Prime to steady state. The signal is exactly periodic with period `frames`, so
  // the filter can be run on the *tail* of the table (ending at index `frames`, i.e.
  // phase 0) and then on whole tables, until PRIME_SECONDS have gone through it:
  // a loop costs ~1.25x a one-shot instead of 2x for a 2 s table.
  const prime: i32 = i32(Math.ceil(sampleRate * PRIME_SECONDS));
  const tail: i32 = prime % frames;
  if (tail > 0) renderPass(offset, frames - tail, frames, dt, type, false);
  for (let k = prime / frames; k > 0; k--) renderPass(offset, 0, frames, dt, type, false);
  renderPass(offset, 0, frames, dt, type, true);
  return frames;
}

/**
 * A one-shot note: `floor(sampleRate * duration)` frames of f32 at `offset`,
 * filter from rest. Returns the frame count (0 on a bad argument; never traps —
 * a render too long for linear memory is truncated to what fits).
 *
 * type: 0 saw, 1 square, 2 triangle, anything else sine.
 * filterType: 0 low pass, 1 band pass, 2 high pass (anything else returns 0).
 */
export function generate(
  offset: i32,
  sampleRate: f32,
  freq: f32,
  duration: f32,
  type: i32,
  cutoff: f32,
  resonance: f32,
  filterType: i32,
): i32 {
  return render(offset, sampleRate, freq, duration, type, cutoff, resonance, filterType, false);
}

/**
 * A seamlessly loopable table of about `duration` seconds, rounded to a whole
 * number of cycles (at least one). Same arguments and return as `generate`; the
 * pitch is `freq` to within half a frame per table.
 */
export function generateLoop(
  offset: i32,
  sampleRate: f32,
  freq: f32,
  duration: f32,
  type: i32,
  cutoff: f32,
  resonance: f32,
  filterType: i32,
): i32 {
  return render(offset, sampleRate, freq, duration, type, cutoff, resonance, filterType, true);
}
