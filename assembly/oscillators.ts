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
// - Scalar code only: the build targets the Safari intersection (simd +
//   bulk-memory, no WasmGC, no relaxed-simd). See docs/wasm/BUILD_NOTES.md.
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
// Shapes are band-limited at the source (PolyBLEP for the saw and square
// edges, PolyBLAMP for the triangle's slope breaks), not by the biquad: the
// filter's cutoff is a musical control, and it was doing double duty as the
// only thing standing between the naive edges and the alias products.

import { FILTER_LP, FILTER_HP, setCoefficients, resetState, tick } from './biquad';

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

/**
 * Run frame indices [from, to) of the shape through the filter, advancing the
 * filter state. `write` false is the loop mode's priming: same arithmetic, no
 * stores. Frame `i` is stored at `offset + 4 * (i - from)`.
 *
 * Phase is computed from the frame index rather than accumulated, so a long
 * render cannot drift, and a loop of `frames` frames returns to exactly phase 0
 * at index `frames` — which is what lets priming start anywhere in the cycle.
 */
function renderPass(offset: i32, from: i32, to: i32, dt: f64, type: i32, write: bool): void {
  for (let i = from; i < to; i++) {
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
