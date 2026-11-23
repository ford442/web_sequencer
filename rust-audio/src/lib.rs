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
//! Filtering is deliberately absent: the voice's own `BiquadFilterNode` sits
//! after this source (`VoiceManager.Voice`), exactly as it does for every other
//! basic-wave family. A selectable in-kernel filter is #1672.
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

#![cfg_attr(not(test), no_std)]

/// Capacity of the input/output buffers. A render quantum is 128 frames today;
/// the headroom covers a future `renderSizeHint` without an ABI change. The
/// worklet splits anything larger into chunks of this size.
pub const MAX_FRAMES: usize = 1024;

/// Bumped whenever an export's signature or meaning changes. The worklet
/// refuses a module whose version it does not know.
pub const ABI_VERSION: u32 = 1;

pub const SHAPE_SAW: u32 = 0;
pub const SHAPE_SQR: u32 = 1;
pub const SHAPE_TRI: u32 = 2;
pub const SHAPE_SIN: u32 = 3;

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
}

impl Engine {
    pub const fn new() -> Self {
        Engine {
            freq: [0.0; MAX_FRAMES],
            out: [0.0; MAX_FRAMES],
            phase: 0.0,
            inv_sample_rate: 1.0 / 48_000.0,
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
}
