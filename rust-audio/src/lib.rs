//! `rust-*` oscillator family (#1664): the kernel behind Hyphon's "Rust OSC".
//!
//! This replaces the retired bench function (`generate_rust_wave`, a naive
//! saw/square + biquad rendered into a `Float32Array` on the main thread and
//! looped). The difference is structural, not cosmetic:
//!
//!   * It runs **inside an AudioWorklet** (`src/audio-worklets/rust-osc-processor.ts`),
//!     one instance per synth voice, driven sample by sample from the node's
//!     a-rate `frequency` AudioParam. Nothing is pre-rendered and nothing is
//!     looped, so slides, vibrato and pitch automation are continuous.
//!   * It is **band-limited**: saw and square use 2-sample PolyBLEP residuals at
//!     every discontinuity, triangle uses the integrated residual (PolyBLAMP) at
//!     both slope corners, sine is a degree-11 odd polynomial on a reduced range.
//!   * The wasm build is **SIMD** (`simd128`): four consecutive samples are
//!     evaluated per iteration — phases come from an in-register prefix sum of
//!     the per-sample increments, residual windows are lane masks. The scalar
//!     path below is the reference the SIMD path is tested against
//!     (`rosc_render_scalar`, `src/engines/__tests__/rustOscKernel.test.ts`).
//!   * It is **real-time safe**: `no_std`, no allocator, no panics reachable from
//!     the exports, fixed 128 KiB memory (see `.cargo/config.toml`). All state
//!     and I/O live in one static `Engine`.
//!
//! The oscillator itself is unfiltered: the voice's filter sits after it
//! (`VoiceManager.Voice`), exactly as for every other basic-wave family. What
//! the kernel adds is the **Rust filter** (#1672): a resonant LP / BP / HP RBJ
//! biquad (`Biquad`, below) that is independent of the oscillator shape and of
//! the oscillator *engine* — a second instance of this same module runs it as a
//! streaming stage (`src/audio-worklets/rust-filter-processor.ts`), so JS, WASM
//! OSC, C++, DWGS, WebGPU, Pyodide and WAV voices can choose it as their filter
//! (`SynthParams.filterSource === 'rust'`). It computes the same response as the
//! AssemblyScript filter (`assembly/biquad.ts`) so the two sources sound alike.
//!
//! ABI (all `extern "C"`, no imports):
//!   rosc_abi_version() -> u32           bumps when the surface changes
//!   rosc_max_frames()  -> u32           capacity of the I/O buffers
//!   rosc_simd()        -> u32           1 when `rosc_render` uses the v128 path
//!   rosc_freq_ptr()    -> *mut f32      frequency input (Hz)
//!   rosc_out_ptr()     -> *const f32    rendered samples
//!   rosc_init(sample_rate) -> i32       1 on success
//!   rosc_reset(phase)                    phase in cycles, wrapped to [0, 1)
//!   rosc_render(shape, frames, per_sample_freq) -> u32   frames rendered
//!   rosc_render_scalar(...)  -> u32     same contract, scalar reference path
//!   rflt_buf_ptr()     -> *mut f32      filter I/O buffer (filtered in place)
//!   rflt_configure(sample_rate, cutoff, resonance, type) -> i32   1 on success
//!   rflt_reset()                         filter from rest
//!   rflt_process(frames) -> u32          frames filtered

#![cfg_attr(not(test), no_std)]

/// Capacity of the input/output buffers. A render quantum is 128 frames today;
/// the headroom covers a future `renderSizeHint` without an ABI change. The
/// worklet splits anything larger into chunks of this size.
pub const MAX_FRAMES: usize = 1024;

/// Bumped whenever an export's signature or meaning changes. The worklet
/// refuses a module whose version it does not know.
pub const ABI_VERSION: u32 = 2;

pub const SHAPE_SAW: u32 = 0;
pub const SHAPE_SQR: u32 = 1;
pub const SHAPE_TRI: u32 = 2;
pub const SHAPE_SIN: u32 = 3;

/// Filter response ids — the numbering of `FilterType` in src/types/synth.ts
/// and of `FILTER_*` in assembly/biquad.ts.
pub const FILTER_LP: u32 = 0;
pub const FILTER_BP: u32 = 1;
pub const FILTER_HP: u32 = 2;

/// Highest phase increment accepted, in cycles per sample (Nyquist). Above it
/// the two-sample residual windows on either side of a discontinuity overlap.
const MAX_INC: f32 = 0.5;
/// Lower bound for the residual divisor, so `1 / dt` is always finite.
const MIN_DT: f32 = 1.0e-9;

const MIN_SAMPLE_RATE: f32 = 8_000.0;
const MAX_SAMPLE_RATE: f32 = 768_000.0;

const THIRD: f32 = 1.0 / 3.0;
const PI: f32 = core::f32::consts::PI;

#[repr(C, align(16))]
pub struct Engine {
    freq: [f32; MAX_FRAMES],
    out: [f32; MAX_FRAMES],
    /// Current phase in cycles, always in [0, 1).
    phase: f32,
    inv_sample_rate: f32,
    /// The Rust filter (#1672): one resonant biquad over `filt`, in place.
    filter: Biquad,
    filt: [f32; MAX_FRAMES],
}

impl Engine {
    pub const fn new() -> Self {
        Engine {
            freq: [0.0; MAX_FRAMES],
            out: [0.0; MAX_FRAMES],
            phase: 0.0,
            inv_sample_rate: 1.0 / 48_000.0,
            filter: Biquad::new(),
            filt: [0.0; MAX_FRAMES],
        }
    }

    pub fn init(&mut self, sample_rate: f32) -> bool {
        // `contains` is false for NaN, so NaN is rejected too.
        if !(MIN_SAMPLE_RATE..=MAX_SAMPLE_RATE).contains(&sample_rate) {
            return false;
        }
        self.inv_sample_rate = 1.0 / sample_rate;
        self.phase = 0.0;
        self.out = [0.0; MAX_FRAMES];
        self.filter.reset();
        true
    }

    pub fn reset(&mut self, phase: f32) {
        // Non-finite or negative input lands on 0 rather than poisoning state.
        let p = if phase.is_finite() && phase >= 0.0 {
            phase
        } else {
            0.0
        };
        self.phase = frac_pos(p);
    }

    pub fn freq_mut(&mut self) -> &mut [f32; MAX_FRAMES] {
        &mut self.freq
    }

    pub fn out(&self) -> &[f32; MAX_FRAMES] {
        &self.out
    }

    pub fn phase(&self) -> f32 {
        self.phase
    }

    pub fn filter_buf_mut(&mut self) -> &mut [f32; MAX_FRAMES] {
        &mut self.filt
    }

    /// See `Biquad::configure`. Leaves the filter state alone so sweeps do not click.
    pub fn filter_configure(
        &mut self,
        sample_rate: f32,
        cutoff: f32,
        resonance: f32,
        kind: u32,
    ) -> bool {
        self.filter
            .configure(sample_rate as f64, cutoff as f64, resonance as f64, kind)
    }

    pub fn filter_reset(&mut self) {
        self.filter.reset();
    }

    /// Filter the first `frames` samples of the filter buffer in place; returns
    /// the frames done. Frames beyond capacity are clamped, a filter that was
    /// never configured passes the signal through unchanged (see `Biquad::new`).
    pub fn filter_process(&mut self, frames: usize) -> usize {
        let n = frames.min(MAX_FRAMES);
        for x in self.filt[..n].iter_mut() {
            *x = self.filter.tick(*x as f64) as f32;
        }
        self.filter.flush_denormals();
        n
    }

    /// Phase increment for `hz`, clamped to [0, MAX_INC]. NaN → 0.
    #[inline(always)]
    // Not `clamp`: that returns NaN for NaN input, which would poison the phase.
    #[allow(clippy::manual_clamp)]
    fn inc_for(&self, hz: f32) -> f32 {
        // f32::max returns the non-NaN operand, so NaN Hz becomes 0.
        (hz * self.inv_sample_rate).max(0.0).min(MAX_INC)
    }

    /// Scalar reference path. Renders `frames` samples of `shape` into `out`.
    pub fn render_scalar(&mut self, shape: u32, frames: usize, per_sample_freq: bool) -> usize {
        let n = frames.min(MAX_FRAMES);
        self.render_scalar_range(shape, 0, n, per_sample_freq);
        n
    }

    /// Groups of four first, then a sequential tail — with the *same*
    /// floating-point association as `simd::render_blocks`, so the two paths
    /// agree bit for bit (a different phase-sum order drifts by ~1e-6 cycles
    /// over a few thousand samples, which the BLEP's 1/dt slope turns into
    /// audible-in-a-diff differences at low pitch).
    fn render_scalar_range(&mut self, shape: u32, from: usize, to: usize, per_sample_freq: bool) {
        let const_inc = self.inc_for(self.freq[0]);
        let mut phase = self.phase;
        let mut i = from;
        while i + 4 <= to {
            let dt = if per_sample_freq {
                [
                    self.inc_for(self.freq[i]),
                    self.inc_for(self.freq[i + 1]),
                    self.inc_for(self.freq[i + 2]),
                    self.inc_for(self.freq[i + 3]),
                ]
            } else {
                [const_inc; 4]
            };
            // Inclusive prefix sum by two lane shifts, as in the v128 path.
            let s1 = [dt[0] + 0.0, dt[1] + dt[0], dt[2] + dt[1], dt[3] + dt[2]];
            let incl = [s1[0] + 0.0, s1[1] + 0.0, s1[2] + s1[0], s1[3] + s1[1]];
            for k in 0..4 {
                let t = frac_pos(phase + (incl[k] - dt[k]));
                self.out[i + k] = shape_sample(shape, t, dt[k]);
            }
            phase = frac_pos(phase + incl[3]);
            i += 4;
        }
        while i < to {
            let dt = if per_sample_freq {
                self.inc_for(self.freq[i])
            } else {
                const_inc
            };
            self.out[i] = shape_sample(shape, phase, dt);
            phase = frac_pos(phase + dt);
            i += 1;
        }
        self.phase = phase;
    }

    /// The shipped path: v128 when compiled for wasm32 with `simd128`.
    pub fn render(&mut self, shape: u32, frames: usize, per_sample_freq: bool) -> usize {
        let n = frames.min(MAX_FRAMES);
        #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
        {
            let blocks = n & !3;
            // SAFETY: `blocks <= n <= MAX_FRAMES`, and both buffers hold
            // MAX_FRAMES f32s, so every 4-lane load/store is in bounds.
            unsafe { simd::render_blocks(self, shape, blocks, per_sample_freq) };
            self.render_scalar_range(shape, blocks, n, per_sample_freq);
        }
        #[cfg(not(all(target_arch = "wasm32", target_feature = "simd128")))]
        {
            self.render_scalar_range(shape, 0, n, per_sample_freq);
        }
        n
    }
}

impl Default for Engine {
    fn default() -> Self {
        Self::new()
    }
}

// ── Scalar DSP (the reference) ──────────────────────────────────────────────

/// Fractional part of a non-negative value. Phase sums stay well inside i32.
#[inline(always)]
fn frac_pos(x: f32) -> f32 {
    x - (x as i32) as f32
}

/// PolyBLEP residual for a unit-normalised step of height 2 at phase 0.
/// `t` in [0, 1), `dt` the phase increment.
#[inline(always)]
pub fn poly_blep(t: f32, dt: f32) -> f32 {
    let inv_dt = 1.0 / dt.max(MIN_DT);
    if t < dt {
        let x = t * inv_dt;
        x + x - x * x - 1.0
    } else if t > 1.0 - dt {
        let x = (t - 1.0) * inv_dt;
        x * x + (x + x) + 1.0
    } else {
        0.0
    }
}

/// PolyBLAMP residual: the PolyBLEP residual integrated over one sample
/// period, for a slope change at phase 0. Scaled by the slope change per sample
/// at the call site.
#[inline(always)]
pub fn poly_blamp(t: f32, dt: f32) -> f32 {
    let inv_dt = 1.0 / dt.max(MIN_DT);
    if t < dt {
        let y = t * inv_dt - 1.0;
        -(y * y * y) * THIRD
    } else if t > 1.0 - dt {
        let y = (t - 1.0) * inv_dt + 1.0;
        y * y * y * THIRD
    } else {
        0.0
    }
}

/// sin(π·y) for y in [-1, 1].
#[inline(always)]
fn sin_pi(y: f32) -> f32 {
    // sin(π(1−y)) = sin(πy): fold onto [-1/2, 1/2] so the series converges fast.
    let y = if y > 0.5 {
        1.0 - y
    } else if y < -0.5 {
        -1.0 - y
    } else {
        y
    };
    let z = PI * y;
    let z2 = z * z;
    z * (1.0
        + z2 * (-1.0 / 6.0
            + z2 * (1.0 / 120.0
                + z2 * (-1.0 / 5_040.0 + z2 * (1.0 / 362_880.0 + z2 * (-1.0 / 39_916_800.0))))))
}

#[inline(always)]
pub fn shape_sample(shape: u32, t: f32, dt: f32) -> f32 {
    match shape {
        SHAPE_SQR => {
            // The naive ±1 comes from the *rounded* t2, not from `t < 0.5`:
            // for t just below 0.5, t + 0.5 rounds to 1.0, t2 wraps to 0, and the
            // residual below treats the edge as already passed. Deciding the
            // step from t would then disagree with it and emit a 2.0 spike once
            // per period (a DC offset of a few percent over a long note).
            let t2 = frac_pos(t + 0.5);
            2.0 * (t2 - t) + poly_blep(t, dt) - poly_blep(t2, dt)
        }
        SHAPE_TRI => {
            // 1 at t=0, -1 at t=0.5. Slope (per cycle) is -4 then +4, so the
            // corners change slope by -8 at t=0 and +8 at t=0.5; per sample that
            // is ∓8·dt, which is the residual scale.
            let d = t - 0.5;
            let naive = 4.0 * (if d < 0.0 { -d } else { d }) - 1.0;
            naive + 4.0 * dt * (poly_blamp(frac_pos(t + 0.5), dt) - poly_blamp(t, dt))
        }
        SHAPE_SIN => -sin_pi(2.0 * t - 1.0),
        // SHAPE_SAW, and any unknown id (the worklet clamps, this is belt and braces).
        _ => 2.0 * t - 1.0 - poly_blep(t, dt),
    }
}

// ── Rust filter (#1672) ─────────────────────────────────────────────────────

/// Hz.
const MIN_CUTOFF: f64 = 20.0;
const MIN_RESONANCE: f64 = 0.1;
/// State below this magnitude is flushed to zero (denormals cost real time on some CPUs).
const DENORMAL_FLOOR: f64 = 1.0e-30;

/// sin(π·y) for |y| ≤ 1/2, f64. Taylor to z²¹: error < 1e-19 on |z| ≤ π/2.
#[inline(always)]
fn sin_pi_f64(y: f64) -> f64 {
    let z = core::f64::consts::PI * y;
    let z2 = z * z;
    z * (1.0
        + z2 * (-1.0 / 6.0
            + z2 * (1.0 / 120.0
                + z2 * (-1.0 / 5_040.0
                    + z2 * (1.0 / 362_880.0
                        + z2 * (-1.0 / 39_916_800.0
                            + z2 * (1.0 / 6_227_020_800.0
                                + z2 * (-1.0 / 1_307_674_368_000.0
                                    + z2 * (1.0 / 355_687_428_096_000.0
                                        + z2 * (-1.0 / 121_645_100_408_832_000.0))))))))))
}

/// (sin w0, cos w0) for w0 in [0, π): `core` has no libm, so fold onto
/// [-π/2, π/2] and evaluate the series. cos w0 = sin(π(½ − w0/π)).
#[inline(always)]
fn sin_cos(w0: f64) -> (f64, f64) {
    let x = w0 * (1.0 / core::f64::consts::PI); // in [0, 1)
    let s = sin_pi_f64(if x > 0.5 { 1.0 - x } else { x });
    let c = sin_pi_f64(0.5 - x);
    (s, c)
}

/// One RBJ (Audio EQ Cookbook) biquad, transposed direct form II, f64
/// coefficients and state — the same filter as `assembly/biquad.ts`, so a
/// voice sounds the same on either source.
///
/// f32 cannot represent a 20 Hz lowpass at 48 kHz (a1 ≈ −2 + 1e-5 is inside f32
/// rounding): low cutoffs would drift and ring at the wrong pitch.
///
///   LP  −12 dB/oct above `cutoff`
///   BP  constant 0 dB peak gain (the bandpass a `BiquadFilterNode` builds)
///   HP  −12 dB/oct below `cutoff`
#[derive(Clone, Copy)]
pub struct Biquad {
    b0: f64,
    b1: f64,
    b2: f64,
    a1: f64,
    a2: f64,
    z1: f64,
    z2: f64,
}

impl Biquad {
    /// Unconfigured = identity (a never-configured filter passes audio through;
    /// the worklet refuses to run before the first successful `configure`).
    pub const fn new() -> Self {
        Biquad {
            b0: 1.0,
            b1: 0.0,
            b2: 0.0,
            a1: 0.0,
            a2: 0.0,
            z1: 0.0,
            z2: 0.0,
        }
    }

    /// Set the coefficients for `kind` at `cutoff` Hz / `resonance` (Q) at
    /// `sample_rate`, leaving the state alone. `cutoff` is clamped to
    /// [20 Hz, sample_rate / 2.1] and `resonance` to ≥ 0.1.
    ///
    /// Returns false — keeping the previous coefficients — for an unusable
    /// argument: a non-finite value, a rate outside the module's range, or an
    /// unknown `kind`. (The kernel never traps; the caller reports.)
    pub fn configure(&mut self, sample_rate: f64, cutoff: f64, resonance: f64, kind: u32) -> bool {
        let rate_ok = (MIN_SAMPLE_RATE as f64..=MAX_SAMPLE_RATE as f64).contains(&sample_rate);
        if !rate_ok || !cutoff.is_finite() || !resonance.is_finite() || kind > FILTER_HP {
            return false;
        }
        let fc = cutoff.min(sample_rate / 2.1).max(MIN_CUTOFF);
        let q = resonance.max(MIN_RESONANCE);
        let w0 = 2.0 * core::f64::consts::PI * fc / sample_rate;
        let (sin_w0, cos_w0) = sin_cos(w0);
        let alpha = sin_w0 / (2.0 * q);
        let inv_a0 = 1.0 / (1.0 + alpha);
        match kind {
            FILTER_BP => {
                self.b0 = alpha * inv_a0;
                self.b1 = 0.0;
                self.b2 = -self.b0;
            }
            FILTER_HP => {
                self.b0 = (1.0 + cos_w0) * 0.5 * inv_a0;
                self.b1 = -(1.0 + cos_w0) * inv_a0;
                self.b2 = self.b0;
            }
            _ => {
                self.b0 = (1.0 - cos_w0) * 0.5 * inv_a0;
                self.b1 = (1.0 - cos_w0) * inv_a0;
                self.b2 = self.b0;
            }
        }
        self.a1 = -2.0 * cos_w0 * inv_a0;
        self.a2 = (1.0 - alpha) * inv_a0;
        true
    }

    /// Filter from rest.
    pub fn reset(&mut self) {
        self.z1 = 0.0;
        self.z2 = 0.0;
    }

    #[inline(always)]
    pub fn tick(&mut self, x: f64) -> f64 {
        let y = self.b0 * x + self.z1;
        self.z1 = self.b1 * x - self.a1 * y + self.z2;
        self.z2 = self.b2 * x - self.a2 * y;
        y
    }

    /// Once per block: a silent input must not leave the state decaying into denormals.
    pub fn flush_denormals(&mut self) {
        if self.z1.abs() < DENORMAL_FLOOR {
            self.z1 = 0.0;
        }
        if self.z2.abs() < DENORMAL_FLOOR {
            self.z2 = 0.0;
        }
    }
}

impl Default for Biquad {
    fn default() -> Self {
        Self::new()
    }
}

// ── SIMD DSP (the shipped path) ─────────────────────────────────────────────

#[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
mod simd {
    use super::*;
    use core::arch::wasm32::*;

    #[inline(always)]
    fn splat(x: f32) -> v128 {
        f32x4_splat(x)
    }

    #[inline(always)]
    fn frac(x: v128) -> v128 {
        f32x4_sub(x, f32x4_floor(x))
    }

    /// `if after { ra } else if before { rb } else { 0 }`, lane-wise.
    #[inline(always)]
    fn select3(after: v128, ra: v128, before: v128, rb: v128) -> v128 {
        v128_bitselect(ra, v128_and(before, rb), after)
    }

    #[inline(always)]
    fn blep(t: v128, dt: v128, inv_dt: v128) -> v128 {
        let one = splat(1.0);
        let after = f32x4_lt(t, dt);
        let before = f32x4_gt(t, f32x4_sub(one, dt));
        let xa = f32x4_mul(t, inv_dt);
        let ra = f32x4_sub(f32x4_sub(f32x4_add(xa, xa), f32x4_mul(xa, xa)), one);
        let xb = f32x4_mul(f32x4_sub(t, one), inv_dt);
        let rb = f32x4_add(f32x4_add(f32x4_mul(xb, xb), f32x4_add(xb, xb)), one);
        select3(after, ra, before, rb)
    }

    #[inline(always)]
    fn blamp(t: v128, dt: v128, inv_dt: v128) -> v128 {
        let one = splat(1.0);
        let third = splat(THIRD);
        let after = f32x4_lt(t, dt);
        let before = f32x4_gt(t, f32x4_sub(one, dt));
        let ya = f32x4_sub(f32x4_mul(t, inv_dt), one);
        let ra = f32x4_neg(f32x4_mul(f32x4_mul(f32x4_mul(ya, ya), ya), third));
        let yb = f32x4_add(f32x4_mul(f32x4_sub(t, one), inv_dt), one);
        let rb = f32x4_mul(f32x4_mul(f32x4_mul(yb, yb), yb), third);
        select3(after, ra, before, rb)
    }

    #[inline(always)]
    fn sin_pi(y: v128) -> v128 {
        let half = splat(0.5);
        let one = splat(1.0);
        let hi = f32x4_gt(y, half);
        let lo = f32x4_lt(y, f32x4_neg(half));
        let y = v128_bitselect(
            f32x4_sub(one, y),
            v128_bitselect(f32x4_sub(f32x4_neg(one), y), y, lo),
            hi,
        );
        let z = f32x4_mul(splat(PI), y);
        let z2 = f32x4_mul(z, z);
        let mut p = splat(-1.0 / 39_916_800.0);
        p = f32x4_add(splat(1.0 / 362_880.0), f32x4_mul(z2, p));
        p = f32x4_add(splat(-1.0 / 5_040.0), f32x4_mul(z2, p));
        p = f32x4_add(splat(1.0 / 120.0), f32x4_mul(z2, p));
        p = f32x4_add(splat(-1.0 / 6.0), f32x4_mul(z2, p));
        p = f32x4_add(one, f32x4_mul(z2, p));
        f32x4_mul(z, p)
    }

    #[inline(always)]
    fn shape4(shape: u32, t: v128, dt: v128) -> v128 {
        let one = splat(1.0);
        let half = splat(0.5);
        let inv_dt = f32x4_div(one, f32x4_pmax(splat(MIN_DT), dt));
        match shape {
            SHAPE_SQR => {
                // ±1 from the rounded t2, as in `shape_sample` (see there).
                let t2 = frac(f32x4_add(t, half));
                let naive = f32x4_mul(splat(2.0), f32x4_sub(t2, t));
                f32x4_sub(f32x4_add(naive, blep(t, dt, inv_dt)), blep(t2, dt, inv_dt))
            }
            SHAPE_TRI => {
                let naive = f32x4_sub(f32x4_mul(splat(4.0), f32x4_abs(f32x4_sub(t, half))), one);
                let t2 = frac(f32x4_add(t, half));
                let corr = f32x4_sub(blamp(t2, dt, inv_dt), blamp(t, dt, inv_dt));
                f32x4_add(naive, f32x4_mul(f32x4_mul(splat(4.0), dt), corr))
            }
            SHAPE_SIN => f32x4_neg(sin_pi(f32x4_sub(f32x4_add(t, t), one))),
            _ => f32x4_sub(f32x4_sub(f32x4_add(t, t), one), blep(t, dt, inv_dt)),
        }
    }

    /// Render `blocks` (a multiple of 4, ≤ MAX_FRAMES) samples, four at a time.
    ///
    /// Sample `i` sounds phase φᵢ where φᵢ₊₁ = φᵢ + dtᵢ. For a group of four
    /// increments [a b c d] the exclusive prefix sum [0 a a+b a+b+c] is built
    /// with two lane shifts, so all four phases are derived from the group's
    /// base phase in one pass and the scalar loop-carried dependency is one add
    /// per *group*.
    ///
    /// # Safety
    /// `blocks` must be a multiple of 4 and ≤ MAX_FRAMES.
    pub unsafe fn render_blocks(e: &mut Engine, shape: u32, blocks: usize, per_sample_freq: bool) {
        let zero = splat(0.0);
        let max_inc = splat(MAX_INC);
        let inv_sr = splat(e.inv_sample_rate);
        let freq = e.freq.as_ptr();
        let out = e.out.as_mut_ptr();
        let const_hz = splat(e.freq[0]);
        let mut phase = e.phase;

        let mut i = 0;
        while i < blocks {
            let hz = if per_sample_freq {
                v128_load(freq.add(i) as *const v128)
            } else {
                const_hz
            };
            // pmax(0, x) maps NaN → 0 (NaN < 0 is false); pmin then caps.
            let dt = f32x4_pmin(max_inc, f32x4_pmax(zero, f32x4_mul(hz, inv_sr)));
            let s1 = f32x4_add(dt, i32x4_shuffle::<4, 0, 1, 2>(dt, zero));
            let incl = f32x4_add(s1, i32x4_shuffle::<4, 5, 0, 1>(s1, zero));
            let excl = f32x4_sub(incl, dt);
            let t = frac(f32x4_add(splat(phase), excl));

            v128_store(out.add(i) as *mut v128, shape4(shape, t, dt));

            phase = frac_pos(phase + f32x4_extract_lane::<3>(incl));
            i += 4;
        }
        e.phase = phase;
    }
}

// ── C ABI ───────────────────────────────────────────────────────────────────

#[cfg(target_arch = "wasm32")]
mod abi {
    use super::*;
    use core::ptr::addr_of_mut;

    static mut ENGINE: Engine = Engine::new();

    /// The module is single-threaded (one instance per worklet voice, no shared
    /// memory), so this is the only reference alive while an export runs.
    #[inline(always)]
    fn engine() -> &'static mut Engine {
        // SAFETY: see above — no export re-enters and nothing else holds it.
        unsafe { &mut *addr_of_mut!(ENGINE) }
    }

    #[no_mangle]
    pub extern "C" fn rosc_abi_version() -> u32 {
        ABI_VERSION
    }

    #[no_mangle]
    pub extern "C" fn rosc_max_frames() -> u32 {
        MAX_FRAMES as u32
    }

    #[no_mangle]
    pub extern "C" fn rosc_simd() -> u32 {
        cfg!(target_feature = "simd128") as u32
    }

    #[no_mangle]
    pub extern "C" fn rosc_freq_ptr() -> *mut f32 {
        engine().freq_mut().as_mut_ptr()
    }

    #[no_mangle]
    pub extern "C" fn rosc_out_ptr() -> *const f32 {
        engine().out().as_ptr()
    }

    #[no_mangle]
    pub extern "C" fn rosc_init(sample_rate: f32) -> i32 {
        engine().init(sample_rate) as i32
    }

    #[no_mangle]
    pub extern "C" fn rosc_reset(phase: f32) {
        engine().reset(phase)
    }

    #[no_mangle]
    pub extern "C" fn rosc_render(shape: u32, frames: u32, per_sample_freq: u32) -> u32 {
        engine().render(shape, frames as usize, per_sample_freq != 0) as u32
    }

    #[no_mangle]
    pub extern "C" fn rosc_render_scalar(shape: u32, frames: u32, per_sample_freq: u32) -> u32 {
        engine().render_scalar(shape, frames as usize, per_sample_freq != 0) as u32
    }

    #[no_mangle]
    pub extern "C" fn rflt_buf_ptr() -> *mut f32 {
        engine().filter_buf_mut().as_mut_ptr()
    }

    #[no_mangle]
    pub extern "C" fn rflt_configure(
        sample_rate: f32,
        cutoff: f32,
        resonance: f32,
        kind: u32,
    ) -> i32 {
        engine().filter_configure(sample_rate, cutoff, resonance, kind) as i32
    }

    #[no_mangle]
    pub extern "C" fn rflt_reset() {
        engine().filter_reset()
    }

    #[no_mangle]
    pub extern "C" fn rflt_process(frames: u32) -> u32 {
        engine().filter_process(frames as usize) as u32
    }

    #[cfg(not(test))]
    #[panic_handler]
    fn panic(_: &core::panic::PanicInfo) -> ! {
        // Unreachable from the exports (no indexing past MAX_FRAMES, no
        // arithmetic that can overflow-panic in release); trap if it ever is.
        core::arch::wasm32::unreachable()
    }
}

// ── Host tests (scalar reference) ───────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 48_000.0;

    fn render(shape: u32, hz: f32, n: usize) -> Vec<f32> {
        let mut e = Box::new(Engine::new());
        assert!(e.init(SR));
        e.freq_mut()[0] = hz;
        let mut out = Vec::with_capacity(n);
        while out.len() < n {
            let k = (n - out.len()).min(MAX_FRAMES);
            e.render(shape, k, false);
            out.extend_from_slice(&e.out()[..k]);
        }
        out
    }

    fn naive(shape: u32, hz: f32, n: usize) -> Vec<f32> {
        let dt = hz / SR;
        let mut t = 0.0f32;
        (0..n)
            .map(|_| {
                let v = match shape {
                    SHAPE_SQR => {
                        if t < 0.5 {
                            1.0
                        } else {
                            -1.0
                        }
                    }
                    SHAPE_TRI => 4.0 * (t - 0.5).abs() - 1.0,
                    _ => 2.0 * t - 1.0,
                };
                t = frac_pos(t + dt);
                v
            })
            .collect()
    }

    /// Energy outside DC and the true harmonics, as a fraction of total energy.
    /// With N = SR samples the DFT bins are 1 Hz wide and an integer `hz` puts
    /// every harmonic and every folded alias on an exact bin, so Goertzel at the
    /// harmonics plus Parseval for the total gives the alias energy exactly.
    fn alias_ratio(x: &[f32], hz: u32) -> f64 {
        let n = x.len() as f64;
        let total: f64 = x.iter().map(|&v| (v as f64) * (v as f64)).sum::<f64>() * n;
        let mut harmonic = 0.0;
        let mut k = 0;
        while k * hz <= (SR as u32) / 2 {
            let bin = (k * hz) as f64;
            let w = 2.0 * std::f64::consts::PI * bin / n;
            let (mut s1, mut s2) = (0.0f64, 0.0f64);
            for &v in x {
                let s0 = v as f64 + 2.0 * w.cos() * s1 - s2;
                s2 = s1;
                s1 = s0;
            }
            let power = s1 * s1 + s2 * s2 - 2.0 * w.cos() * s1 * s2;
            // Real signal: a non-DC, non-Nyquist bin has a mirror twin.
            harmonic += if k == 0 { power } else { 2.0 * power };
            k += 1;
        }
        ((total - harmonic) / total).max(1e-30)
    }

    fn db(r: f64) -> f64 {
        10.0 * r.log10()
    }

    #[test]
    fn rejects_bad_sample_rates() {
        let mut e = Engine::new();
        assert!(!e.init(0.0));
        assert!(!e.init(f32::NAN));
        assert!(!e.init(1.0e7));
        assert!(e.init(44_100.0));
    }

    #[test]
    fn nan_and_out_of_range_frequency_stay_finite() {
        for hz in [f32::NAN, -440.0, 1.0e9, f32::INFINITY, 0.0] {
            for shape in 0..5 {
                let x = render(shape, hz, 512);
                assert!(
                    x.iter().all(|v| v.is_finite() && v.abs() <= 1.5),
                    "shape {shape} hz {hz}"
                );
            }
        }
    }

    #[test]
    fn frames_are_clamped_to_capacity() {
        let mut e = Box::new(Engine::new());
        e.init(SR);
        assert_eq!(e.render(SHAPE_SAW, MAX_FRAMES * 4, false), MAX_FRAMES);
    }

    #[test]
    fn polyblep_saw_and_square_alias_far_less_than_naive() {
        let hz = 3_517;
        for shape in [SHAPE_SAW, SHAPE_SQR] {
            let bl = db(alias_ratio(&render(shape, hz as f32, SR as usize), hz));
            let nv = db(alias_ratio(&naive(shape, hz as f32, SR as usize), hz));
            eprintln!("alias shape {shape}: band-limited {bl:.1} dB, naive {nv:.1} dB");
            assert!(
                bl < nv - 10.0,
                "shape {shape}: band-limited {bl:.1} dB vs naive {nv:.1} dB"
            );
        }
    }

    #[test]
    fn polyblamp_triangle_aliases_less_than_naive() {
        let hz = 3_517;
        let bl = db(alias_ratio(&render(SHAPE_TRI, hz as f32, SR as usize), hz));
        let nv = db(alias_ratio(&naive(SHAPE_TRI, hz as f32, SR as usize), hz));
        eprintln!("alias tri: band-limited {bl:.1} dB, naive {nv:.1} dB");
        assert!(
            bl < nv - 10.0,
            "tri: band-limited {bl:.1} dB vs naive {nv:.1} dB"
        );
    }

    #[test]
    fn sine_matches_libm() {
        // The polynomial alone: one sample at a known phase each time, so the
        // phase accumulator's own rounding is not part of the comparison.
        let mut e = Box::new(Engine::new());
        e.init(SR);
        e.freq_mut()[0] = 997.0;
        for k in 0..4_096 {
            let t = k as f32 / 4_096.0;
            e.reset(t);
            e.render(SHAPE_SIN, 1, false);
            let want = (2.0 * std::f64::consts::PI * t as f64).sin() as f32;
            let got = e.out()[0];
            assert!((got - want).abs() < 2.0e-6, "t {t}: {got} vs {want}");
        }
    }

    #[test]
    fn square_never_spikes_at_the_half_cycle_edge() {
        // A long note at a pitch whose phase drifts onto t ≈ 0.5 − ulp: the
        // step and its residual must agree there (they did not, once).
        for hz in [1_000.0, 440.0, 3_000.0, 12_000.0] {
            let x = render(SHAPE_SQR, hz, SR as usize * 2);
            let peak = x.iter().fold(0.0f32, |m, v| m.max(v.abs()));
            assert!(peak <= 1.0 + 1.0e-5, "{hz} Hz square peaks at {peak}");
        }
    }

    #[test]
    fn edges_where_t_plus_half_rounds_to_one() {
        let dt = 1_000.0 / SR;
        let t = 0.5f32 - f32::EPSILON / 4.0; // t + 0.5 rounds to exactly 1.0
        assert_eq!(t + 0.5, 1.0);
        let v = shape_sample(SHAPE_SQR, t, dt);
        assert!(v.abs() <= 1.0, "square at t = 0.5 − ε: {v}");
    }

    #[test]
    fn waveforms_are_bounded_and_zero_mean() {
        for shape in [SHAPE_SAW, SHAPE_SQR, SHAPE_TRI, SHAPE_SIN] {
            let x = render(shape, 1_000.0, SR as usize);
            let mean = x.iter().map(|&v| v as f64).sum::<f64>() / x.len() as f64;
            assert!(mean.abs() < 1.0e-3, "shape {shape}: mean {mean}");
            assert!(x.iter().all(|v| v.abs() <= 1.2), "shape {shape} overshoots");
        }
    }

    #[test]
    fn per_sample_frequency_follows_the_input() {
        // Glide 100 Hz → 2 kHz across one block: phase advance must equal the
        // integral of the increments.
        let mut e = Box::new(Engine::new());
        e.init(SR);
        let n = 512;
        let mut expect = 0.0f64;
        for i in 0..n {
            let hz = 100.0 + 1_900.0 * i as f32 / n as f32;
            e.freq_mut()[i] = hz;
            expect += (hz / SR) as f64;
        }
        e.render(SHAPE_SAW, n, true);
        let got = e.phase() as f64;
        let want = expect - expect.floor();
        assert!((got - want).abs() < 1.0e-4, "phase {got} vs {want}");
    }

    #[test]
    fn reset_wraps_and_sanitises() {
        let mut e = Engine::new();
        e.init(SR);
        e.reset(2.25);
        assert!((e.phase() - 0.25).abs() < 1e-6);
        e.reset(f32::NAN);
        assert_eq!(e.phase(), 0.0);
        e.reset(-0.5);
        assert_eq!(e.phase(), 0.0);
    }

    // ── Rust filter (#1672) ─────────────────────────────────────────────────

    /// The textbook coefficients with libm sin/cos — what `assembly/biquad.ts`
    /// computes with `Math.sin/cos`.
    fn reference_coeffs(sr: f64, cutoff: f64, q: f64, kind: u32) -> [f64; 5] {
        let fc = cutoff.min(sr / 2.1).max(20.0);
        let q = q.max(0.1);
        let w0 = 2.0 * std::f64::consts::PI * fc / sr;
        let (s, c) = w0.sin_cos();
        let alpha = s / (2.0 * q);
        let ia0 = 1.0 / (1.0 + alpha);
        let (b0, b1, b2) = match kind {
            FILTER_BP => (alpha * ia0, 0.0, -alpha * ia0),
            FILTER_HP => (
                (1.0 + c) * 0.5 * ia0,
                -(1.0 + c) * ia0,
                (1.0 + c) * 0.5 * ia0,
            ),
            _ => (
                (1.0 - c) * 0.5 * ia0,
                (1.0 - c) * ia0,
                (1.0 - c) * 0.5 * ia0,
            ),
        };
        [b0, b1, b2, -2.0 * c * ia0, (1.0 - alpha) * ia0]
    }

    /// |H(e^{jω})| of the biquad's own coefficients at `hz`.
    fn magnitude(b: &Biquad, sr: f64, hz: f64) -> f64 {
        let w = 2.0 * std::f64::consts::PI * hz / sr;
        let (s1, c1) = w.sin_cos();
        let (s2, c2) = (2.0 * w).sin_cos();
        let nr = b.b0 + b.b1 * c1 + b.b2 * c2;
        let ni = -(b.b1 * s1 + b.b2 * s2);
        let dr = 1.0 + b.a1 * c1 + b.a2 * c2;
        let di = -(b.a1 * s1 + b.a2 * s2);
        ((nr * nr + ni * ni) / (dr * dr + di * di)).sqrt()
    }

    fn configured(kind: u32, cutoff: f64, q: f64) -> Biquad {
        let mut b = Biquad::new();
        assert!(b.configure(SR as f64, cutoff, q, kind));
        b
    }

    #[test]
    fn sin_cos_matches_libm_over_the_whole_cutoff_range() {
        let mut worst: f64 = 0.0;
        for k in 0..=20_000 {
            // w0 from 0 to the highest cutoff the filter allows (2π / 2.1).
            let w0 = 2.0 * std::f64::consts::PI / 2.1 * (k as f64 / 20_000.0);
            let (s, c) = sin_cos(w0);
            worst = worst.max((s - w0.sin()).abs()).max((c - w0.cos()).abs());
        }
        assert!(worst < 1.0e-14, "worst sin/cos error {worst:e}");
    }

    #[test]
    fn coefficients_equal_the_reference_for_every_response() {
        for kind in [FILTER_LP, FILTER_BP, FILTER_HP] {
            for (sr, fc, q) in [
                (48_000.0, 20.0, 0.7),
                (48_000.0, 1_000.0, 4.0),
                (44_100.0, 8_000.0, 12.0),
                (48_000.0, 40_000.0, 0.5), // above the clamp
                (96_000.0, 5.0, 0.01),     // below both clamps
            ] {
                let mut b = Biquad::new();
                assert!(b.configure(sr, fc, q, kind));
                let want = reference_coeffs(sr, fc, q, kind);
                let got = [b.b0, b.b1, b.b2, b.a1, b.a2];
                for (g, w) in got.iter().zip(want) {
                    assert!(
                        (g - w).abs() < 1.0e-13,
                        "kind {kind} {sr} {fc} {q}: {got:?} vs {want:?}"
                    );
                }
            }
        }
    }

    #[test]
    fn responses_have_the_rbj_shape() {
        let sr = SR as f64;
        // Butterworth Q: −3 dB at the cutoff, flat on the pass side, 12 dB/oct on the other.
        let lp = configured(FILTER_LP, 1_000.0, std::f64::consts::FRAC_1_SQRT_2);
        assert!((magnitude(&lp, sr, 10.0) - 1.0).abs() < 1.0e-3);
        assert!((magnitude(&lp, sr, 1_000.0) - std::f64::consts::FRAC_1_SQRT_2).abs() < 1.0e-3);
        // Analog 2nd-order Butterworth, 1/√(1+r⁴), where the bilinear warping is
        // still small (it bends the slope near Nyquist, so not 4 kHz and up).
        for (hz, tol) in [(1_500.0, 0.02), (2_000.0, 0.03)] {
            let r: f64 = hz / 1_000.0;
            let analog = 1.0 / (1.0 + r.powi(4)).sqrt();
            let got = magnitude(&lp, sr, hz);
            assert!(
                (got / analog - 1.0).abs() < tol,
                "{hz} Hz: {got} vs analog {analog}"
            );
        }

        let hp = configured(FILTER_HP, 1_000.0, std::f64::consts::FRAC_1_SQRT_2);
        assert!(magnitude(&hp, sr, 10.0) < 1.0e-3);
        assert!((magnitude(&hp, sr, 1_000.0) - std::f64::consts::FRAC_1_SQRT_2).abs() < 1.0e-3);
        assert!((magnitude(&hp, sr, 20_000.0) - 1.0).abs() < 0.02);

        // Constant 0 dB peak gain at the centre, whatever the Q.
        for q in [0.5, 2.0, 10.0] {
            let bp = configured(FILTER_BP, 2_000.0, q);
            assert!((magnitude(&bp, sr, 2_000.0) - 1.0).abs() < 1.0e-9, "Q {q}");
            assert!(magnitude(&bp, sr, 100.0) < 0.5 && magnitude(&bp, sr, 20_000.0) < 0.5);
        }

        // Resonance: the lowpass peaks at ≈ Q at the cutoff.
        let res = configured(FILTER_LP, 1_000.0, 8.0);
        assert!((magnitude(&res, sr, 1_000.0) - 8.0).abs() < 0.3);
    }

    #[test]
    fn processed_sine_has_the_analytic_gain() {
        // The time-domain path (f32 buffer → f64 biquad → f32 buffer) agrees with
        // the transfer function: feed a sine, measure the steady-state amplitude.
        for (kind, cutoff, hz) in [
            (FILTER_LP, 2_000.0, 8_000.0),
            (FILTER_LP, 2_000.0, 500.0),
            (FILTER_HP, 2_000.0, 500.0),
            (FILTER_BP, 2_000.0, 2_000.0),
            (FILTER_BP, 2_000.0, 6_000.0),
        ] {
            let mut e = Box::new(Engine::new());
            assert!(e.init(SR));
            assert!(e.filter_configure(SR, cutoff as f32, 3.0, kind));
            let want = magnitude(&configured(kind, cutoff, 3.0), SR as f64, hz);
            let n = 8_192usize;
            let (mut sum_sq, mut count) = (0.0f64, 0usize);
            for block in 0..(n / 128) {
                for k in 0..128 {
                    let i = block * 128 + k;
                    e.filter_buf_mut()[k] =
                        (2.0 * std::f32::consts::PI * hz as f32 * i as f32 / SR).sin();
                }
                assert_eq!(e.filter_process(128), 128);
                if block >= n / 128 / 2 {
                    sum_sq += e.filt[..128]
                        .iter()
                        .map(|&v| (v as f64) * (v as f64))
                        .sum::<f64>();
                    count += 128;
                }
            }
            // RMS, not peak: at 8 kHz a cycle is 6 samples and a sampled peak can miss.
            let amplitude = (sum_sq / count as f64).sqrt() * std::f64::consts::SQRT_2;
            assert!(
                (amplitude - want).abs() < 0.01 * want + 1.0e-4,
                "kind {kind} fc {cutoff} {hz} Hz: got {amplitude}, want {want}"
            );
        }
    }

    #[test]
    fn a_20_hz_lowpass_is_stable_and_has_unity_dc_gain() {
        let mut e = Box::new(Engine::new());
        e.init(SR);
        assert!(e.filter_configure(SR, 20.0, 0.7, FILTER_LP));
        let mut last = 0.0;
        for _ in 0..(SR as usize * 2 / 128) {
            e.filter_buf_mut()[..128].fill(1.0);
            e.filter_process(128);
            last = e.filt[127];
        }
        assert!((last - 1.0).abs() < 1.0e-4, "step settles at {last}");
    }

    #[test]
    fn refused_arguments_keep_the_previous_response() {
        let mut b = configured(FILTER_LP, 1_000.0, 2.0);
        let before = (b.b0, b.b1, b.b2, b.a1, b.a2);
        for (sr, fc, q, kind) in [
            (f64::NAN, 1_000.0, 1.0, FILTER_LP),
            (0.0, 1_000.0, 1.0, FILTER_LP),
            (1.0e7, 1_000.0, 1.0, FILTER_LP),
            (48_000.0, f64::NAN, 1.0, FILTER_LP),
            (48_000.0, f64::INFINITY, 1.0, FILTER_LP),
            (48_000.0, 1_000.0, f64::NAN, FILTER_LP),
            (48_000.0, 1_000.0, 1.0, 3),
            (48_000.0, 1_000.0, 1.0, u32::MAX),
        ] {
            assert!(!b.configure(sr, fc, q, kind), "{sr} {fc} {q} {kind}");
            assert_eq!((b.b0, b.b1, b.b2, b.a1, b.a2), before);
        }
    }

    #[test]
    fn nan_input_never_poisons_a_good_filter_for_long() {
        // A NaN sample poisons the recursion by construction; what matters is
        // that `reset` (the worklet does this after a silent gap) recovers it.
        let mut b = configured(FILTER_LP, 1_000.0, 1.0);
        b.tick(f64::NAN);
        assert!(b.tick(0.0).is_nan());
        b.reset();
        assert!(b.tick(1.0).is_finite());
    }

    #[test]
    fn reconfiguring_keeps_state_so_a_sweep_does_not_click() {
        let mut e = Box::new(Engine::new());
        e.init(SR);
        e.filter_configure(SR, 500.0, 1.0, FILTER_LP);
        e.filter_buf_mut()[..128].fill(1.0);
        e.filter_process(128);
        let held = e.filter.z1;
        assert!(held != 0.0);
        e.filter_configure(SR, 4_000.0, 1.0, FILTER_LP);
        assert_eq!(e.filter.z1, held);
        e.filter_reset();
        assert_eq!((e.filter.z1, e.filter.z2), (0.0, 0.0));
    }

    #[test]
    fn denormal_tails_are_flushed_and_frames_clamped() {
        let mut e = Box::new(Engine::new());
        e.init(SR);
        e.filter_configure(SR, 1_000.0, 0.7, FILTER_LP);
        e.filter_buf_mut()[0] = 1.0;
        e.filter_process(MAX_FRAMES);
        for _ in 0..2_000 {
            e.filter_buf_mut().fill(0.0);
            e.filter_process(MAX_FRAMES);
        }
        assert_eq!((e.filter.z1, e.filter.z2), (0.0, 0.0));
        assert_eq!(e.filter_process(MAX_FRAMES * 4), MAX_FRAMES);
    }

    #[test]
    fn an_unconfigured_filter_is_an_identity() {
        let mut e = Box::new(Engine::new());
        e.init(SR);
        for (i, v) in e.filter_buf_mut()[..64].iter_mut().enumerate() {
            *v = i as f32 * 0.01 - 0.3;
        }
        e.filter_process(64);
        for (i, v) in e.filt[..64].iter().enumerate() {
            assert_eq!(*v, i as f32 * 0.01 - 0.3);
        }
    }

    #[test]
    fn the_filter_does_not_touch_the_oscillator_buffers() {
        // Same module, two jobs: a filter instance never renders and an
        // oscillator instance never filters, but their buffers are independent.
        let mut e = Box::new(Engine::new());
        e.init(SR);
        e.freq_mut()[0] = 440.0;
        e.render(SHAPE_SAW, 128, false);
        let osc = e.out()[..128].to_vec();
        e.filter_configure(SR, 800.0, 2.0, FILTER_HP);
        e.filter_buf_mut()[..128].fill(0.5);
        e.filter_process(128);
        assert_eq!(&e.out()[..128], &osc[..]);
    }
}
