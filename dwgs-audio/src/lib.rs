//! `dwgs-*` oscillator family (#1666, parent #1663): the kernel behind Hyphon's
//! "DWGS" mode.
//!
//! What DWGS is. The only trace the mode had left was its panel art
//! (`public/osc/dwgs.jpg`, added in 0cdff156 and deleted as an orphan in
//! #1294): a Korg-badged "DWGS" panel with a WAVEFORM SOURCE selector for
//! SAW / SQR / NOISE / DIGITAL WAVEFORM and a selector knob. That is Korg's
//! *Digital Waveform Generator System* (DW-6000 / DW-8000): single-cycle
//! waveforms built by additive synthesis — a recipe of harmonic amplitudes per
//! wave — and played back as a digital oscillator in front of an analog filter.
//! It is not a digital waveguide; nothing in the history points that way.
//!
//! What this kernel does with that idea:
//!
//!   * Every tonal wave is a **harmonic recipe** (`recipe`), up to `H_MAX`
//!     harmonics, all of them original to this file (no ROM data). The kernel
//!     renders the recipe **additively, per sample**, inside an AudioWorklet —
//!     there is no stored table and nothing is looped.
//!   * Because each sample is a finite sum of sinusoids, the output is
//!     **band-limited by construction**: a harmonic is included only while it
//!     sits below 0.45 fs, and faded in over 0.40–0.45 fs so a slide never
//!     clicks a harmonic in or out. There is nothing to alias.
//!   * The harmonics come from one sine/cosine of the phase per sample and a
//!     Chebyshev recurrence in f64 (four interleaved chains, `chebyshev_sum`).
//!     Cost scales with the number of audible harmonics, so low notes are the
//!     expensive ones: ~17-20 µs per 128-frame block below ~250 Hz in V8
//!     (Node 22), ~0.7 % of a 48 kHz render quantum per voice — roughly 30x
//!     the Rust OSC's PolyBLEP, the price of a recipe instead of a formula
//!     (docs/wasm/BUILD_NOTES.md#dwgs-osc).
//!   * Waves are normalised to equal RMS (over the full recipe), so switching
//!     wave changes timbre, not loudness.
//!   * NOISE is the panel's fourth source: a 32-bit xorshift stream clocked at
//!     `NOISE_CLOCK_RATIO` x the note frequency (capped at the sample rate) and
//!     linearly interpolated between values. Its colour tracks the keyboard:
//!     a low note rumbles, a high one hisses.
//!   * Every recipe is sine-phase (and the noise starts from zero), so a note
//!     started at phase 0 starts at 0: the gate-open edge needs no correction.
//!   * It is **scalar** and **real-time safe**: `no_std`, no libm (sine/cosine
//!     are local polynomials), no allocator, no panics reachable from the
//!     exports, fixed 2-page memory. All state and I/O live in one static
//!     `Engine`. The recipes are evaluated once in `dwgs_init`.
//!
//! Filtering is deliberately absent, as for every oscillator family that plays
//! through `Voice`: the voice's own BiquadFilterNode sits after this source.
//! A resonant in-kernel filter is #1674.
//!
//! ABI (all `extern "C"`, no imports):
//!   dwgs_abi_version() -> u32           bumps when the surface changes
//!   dwgs_max_frames()  -> u32           capacity of the I/O buffers
//!   dwgs_wave_count()  -> u32           number of wave ids (tonal + noise)
//!   dwgs_freq_ptr()    -> *mut f32      frequency input (Hz)
//!   dwgs_out_ptr()     -> *const f32    rendered samples
//!   dwgs_init(sample_rate) -> i32       1 on success; evaluates the recipes
//!   dwgs_reset(phase)                    gate-open edge: phase in cycles,
//!                                        wrapped to [0, 1); restarts the noise
//!   dwgs_render(wave, frames, per_sample_freq) -> u32   frames rendered

#![cfg_attr(not(test), no_std)]

/// Capacity of the input/output buffers. Same headroom as the other worklet
/// oscillators, so every processor chunks a render quantum the same way.
pub const MAX_FRAMES: usize = 1024;

/// Bumped whenever an export's signature or meaning changes. The worklet
/// refuses a module whose version it does not know.
pub const ABI_VERSION: u32 = 1;

/// Highest harmonic of any recipe. A 65 Hz (C2) note keeps all of them up to
/// 6.2 kHz; above that the voice's filter usually has the last word anyway.
pub const H_MAX: usize = 96;

// Wave ids. The order is persisted only through the waveform ids in
// src/utils/waveformParser.ts (`DWGS_WAVES`), which name these indices; keep
// the two in step (src/__tests__/dwgsOscModule.test.ts checks the count).
pub const WAVE_SAW: u32 = 0;
pub const WAVE_SQR: u32 = 1;
pub const WAVE_PIANO: u32 = 2;
pub const WAVE_EPIANO: u32 = 3;
pub const WAVE_CLAV: u32 = 4;
pub const WAVE_ORGAN: u32 = 5;
pub const WAVE_BRASS: u32 = 6;
pub const WAVE_REED: u32 = 7;
pub const WAVE_STRINGS: u32 = 8;
pub const WAVE_GUITAR: u32 = 9;
pub const WAVE_DIST: u32 = 10;
pub const WAVE_BASS: u32 = 11;
pub const WAVE_DIGIBASS: u32 = 12;
pub const WAVE_BELL: u32 = 13;
pub const WAVE_VOX: u32 = 14;
pub const WAVE_SINE: u32 = 15;
pub const WAVE_NOISE: u32 = 16;

/// Tonal (additive) waves: ids `0..TONAL_WAVES`.
pub const TONAL_WAVES: usize = 16;
/// All wave ids, noise included.
pub const WAVE_COUNT: u32 = 17;

/// Every wave is scaled to this RMS. A saw at this level peaks at ~0.87.
pub const TARGET_RMS: f64 = 0.5;

/// A harmonic at or below this many cycles per sample plays at full level...
const BAND_FULL: f64 = 0.40;
/// ...and is faded out linearly up to here (21.6 kHz at 48 kHz), then dropped.
const BAND_EDGE: f64 = 0.45;

/// Noise clock, in noise values per note cycle.
pub const NOISE_CLOCK_RATIO: f64 = 16.0;
/// Fixed seed: every note's noise starts from the same stream, so a live voice
/// and its offline bounce are the same signal.
const NOISE_SEED: u32 = 0x9E37_79B9;
/// Uniform values in [-1, 1] linearly interpolated have RMS sqrt(2/9); this
/// brings the noise to `TARGET_RMS` like the tonal waves.
const NOISE_GAIN: f64 = TARGET_RMS * 2.121_320_343_559_642_4; // 0.5 / sqrt(2/9)

const MIN_SAMPLE_RATE: f32 = 8_000.0;
const MAX_SAMPLE_RATE: f32 = 768_000.0;

const TAU: f64 = core::f64::consts::TAU;

#[repr(C, align(16))]
pub struct Engine {
    freq: [f32; MAX_FRAMES],
    out: [f32; MAX_FRAMES],
    /// Normalised amplitude of harmonic `k + 1` of each tonal wave.
    amp: [[f64; H_MAX]; TONAL_WAVES],
    /// Phase in cycles, always in [0, 1).
    phase: f64,
    inv_sample_rate: f64,
    /// Noise: position between `noise_prev` and `noise_next`, in [0, 1).
    noise_pos: f64,
    noise_prev: f64,
    noise_next: f64,
    rng: u32,
    ready: bool,
}

impl Default for Engine {
    fn default() -> Self {
        Self::new()
    }
}

impl Engine {
    pub const fn new() -> Self {
        Engine {
            freq: [0.0; MAX_FRAMES],
            out: [0.0; MAX_FRAMES],
            amp: [[0.0; H_MAX]; TONAL_WAVES],
            phase: 0.0,
            inv_sample_rate: 1.0 / 48_000.0,
            noise_pos: 0.0,
            noise_prev: 0.0,
            noise_next: 0.0,
            rng: NOISE_SEED,
            ready: false,
        }
    }

    pub fn init(&mut self, sample_rate: f32) -> bool {
        // `contains` is false for NaN, so NaN is rejected too.
        if !(MIN_SAMPLE_RATE..=MAX_SAMPLE_RATE).contains(&sample_rate) {
            return false;
        }
        self.inv_sample_rate = 1.0 / sample_rate as f64;
        if !self.ready {
            self.build_recipes();
        }
        self.out = [0.0; MAX_FRAMES];
        self.reset(0.0);
        self.ready = true;
        true
    }

    /// Evaluate every recipe and scale it to `TARGET_RMS`.
    fn build_recipes(&mut self) {
        for w in 0..TONAL_WAVES {
            let mut energy = 0.0;
            for k in 1..=H_MAX {
                let a = recipe(w as u32, k);
                self.amp[w][k - 1] = a;
                energy += a * a;
            }
            // RMS of sum a_k sin(k theta) is sqrt(sum a_k^2 / 2).
            let rms = sqrt_pos(energy * 0.5);
            let g = if rms > 0.0 { TARGET_RMS / rms } else { 0.0 };
            for k in 0..H_MAX {
                self.amp[w][k] *= g;
            }
        }
    }

    pub fn reset(&mut self, phase: f32) {
        // Non-finite or negative input lands on 0 rather than poisoning state.
        let p = if phase.is_finite() && phase >= 0.0 {
            phase as f64
        } else {
            0.0
        };
        self.phase = frac(p);
        self.rng = NOISE_SEED;
        self.noise_pos = 0.0;
        self.noise_prev = 0.0;
        self.noise_next = self.next_noise();
    }

    pub fn freq_mut(&mut self) -> &mut [f32; MAX_FRAMES] {
        &mut self.freq
    }

    pub fn out(&self) -> &[f32; MAX_FRAMES] {
        &self.out
    }

    pub fn phase(&self) -> f64 {
        self.phase
    }

    /// Normalised amplitude of harmonic `k` (1-based) of tonal wave `wave`.
    pub fn amplitude(&self, wave: u32, k: usize) -> f64 {
        if (wave as usize) < TONAL_WAVES && (1..=H_MAX).contains(&k) {
            self.amp[wave as usize][k - 1]
        } else {
            0.0
        }
    }

    /// Phase increment for `hz`, in cycles per sample, clamped to [0, 0.5].
    #[inline(always)]
    fn inc_for(&self, hz: f32) -> f64 {
        let v = hz as f64 * self.inv_sample_rate;
        // `v > 0` is false for NaN, so NaN Hz becomes 0.
        if v.partial_cmp(&0.0) != Some(core::cmp::Ordering::Greater) {
            0.0
        } else if v < 0.5 {
            v
        } else {
            0.5
        }
    }

    #[inline(always)]
    fn next_noise(&mut self) -> f64 {
        // xorshift32: full period, never 0 from a non-zero seed.
        let mut x = self.rng;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.rng = x;
        // Top 24 bits → [-1, 1).
        ((x >> 8) as f64) * (2.0 / 16_777_216.0) - 1.0
    }

    /// Render `frames` samples of `wave` into `out`; returns frames rendered.
    pub fn render(&mut self, wave: u32, frames: usize, per_sample_freq: bool) -> usize {
        if !self.ready {
            return 0;
        }
        let n = frames.min(MAX_FRAMES);
        let wave = if wave < WAVE_COUNT { wave } else { WAVE_SAW };
        if wave == WAVE_NOISE {
            self.render_noise(n, per_sample_freq);
        } else {
            self.render_tonal(wave as usize, n, per_sample_freq);
        }
        n
    }

    fn render_tonal(&mut self, wave: usize, n: usize, per_sample_freq: bool) {
        let const_inc = self.inc_for(self.freq[0]);
        let mut p = self.phase;
        for i in 0..n {
            let inc = if per_sample_freq {
                self.inc_for(self.freq[i])
            } else {
                const_inc
            };
            self.out[i] = additive(&self.amp[wave], p, inc) as f32;
            p = frac(p + inc);
        }
        self.phase = p;
    }

    fn render_noise(&mut self, n: usize, per_sample_freq: bool) {
        let clock = |inc: f64| {
            let c = inc * NOISE_CLOCK_RATIO;
            if c < 1.0 {
                c
            } else {
                1.0
            }
        };
        let const_step = clock(self.inc_for(self.freq[0]));
        let mut pos = self.noise_pos;
        for i in 0..n {
            let step = if per_sample_freq {
                clock(self.inc_for(self.freq[i]))
            } else {
                const_step
            };
            let v = self.noise_prev + (self.noise_next - self.noise_prev) * pos;
            self.out[i] = (v * NOISE_GAIN) as f32;
            pos += step;
            if pos >= 1.0 {
                pos -= 1.0;
                self.noise_prev = self.noise_next;
                self.noise_next = self.next_noise();
            }
        }
        self.noise_pos = pos;
        // The tonal phase keeps time too, so a later switch is not a reset.
        let const_inc = self.inc_for(self.freq[0]);
        let mut p = self.phase;
        for i in 0..n {
            p = frac(
                p + if per_sample_freq {
                    self.inc_for(self.freq[i])
                } else {
                    const_inc
                },
            );
        }
        self.phase = p;
    }
}

/// One sample of `sum_k amp[k-1] sin(2 pi k p)` over the harmonics below the
/// band edge for increment `inc`.
#[inline(always)]
pub fn additive(amp: &[f64; H_MAX], p: f64, inc: f64) -> f64 {
    if inc <= 0.0 {
        // A stopped oscillator holds its value (0 Hz is a DC level, not silence).
        let (s1, c) = sincos_turns(p);
        return chebyshev_sum(amp, s1, c, H_MAX, H_MAX, 0.0);
    }
    let inv = 1.0 / inc;
    let full = count(BAND_FULL * inv);
    let top = count(BAND_EDGE * inv);
    if top == 0 {
        return 0.0;
    }
    let (s1, c) = sincos_turns(p);
    chebyshev_sum(amp, s1, c, full, top, inc)
}

/// Harmonics `1..=full` at full level, `full+1..=top` faded over the band edge.
///
/// Four interleaved Chebyshev chains, one per residue of k mod 4, each
/// stepping by 4θ: `sin((k+4)θ) = 2cos(4θ)·sin(kθ) - sin((k-4)θ)`. One chain
/// is a serial multiply-subtract dependency — latency-bound at ~2.5 ns per
/// harmonic in V8 — and four independent ones run in the shadow of each
/// other, ~3x faster for the same arithmetic. `H_MAX` is a multiple of 4.
#[inline(always)]
fn chebyshev_sum(amp: &[f64; H_MAX], s1: f64, c: f64, full: usize, top: usize, inc: f64) -> f64 {
    // sin θ .. sin 4θ seed the chains; sin(kθ - 4θ) for k = 1..4 primes them.
    let two_c = 2.0 * c;
    let s2 = two_c * s1;
    let s3 = two_c * s2 - s1;
    let s4 = two_c * s3 - s2;
    let c2 = 2.0 * c * c - 1.0;
    let two_c4 = 2.0 * (2.0 * c2 * c2 - 1.0);
    let (mut p1, mut p2, mut p3, mut p4) = (-s3, -s2, -s1, 0.0);
    let (mut q1, mut q2, mut q3, mut q4) = (s1, s2, s3, s4);
    let (mut a1, mut a2, mut a3, mut a4) = (0.0, 0.0, 0.0, 0.0);
    let full = if full < top { full } else { top };
    // `k` is the harmonic in chain 1; the group is k..k+3.
    let mut k = 1;
    while k + 3 <= full {
        a1 += amp[k - 1] * q1;
        a2 += amp[k] * q2;
        a3 += amp[k + 1] * q3;
        a4 += amp[k + 2] * q4;
        let n1 = two_c4 * q1 - p1;
        let n2 = two_c4 * q2 - p2;
        let n3 = two_c4 * q3 - p3;
        let n4 = two_c4 * q4 - p4;
        p1 = q1;
        p2 = q2;
        p3 = q3;
        p4 = q4;
        q1 = n1;
        q2 = n2;
        q3 = n3;
        q4 = n4;
        k += 4;
    }
    // The group straddling `full` and the faded ones up to `top`. Harmonics
    // past `top` sit above the band edge, where `fade` is exactly 0.
    while k <= top {
        let w = |h: usize| if h <= full { 1.0 } else { fade(h as f64 * inc) };
        a1 += amp[k - 1] * q1 * w(k);
        if k < top {
            a2 += amp[k] * q2 * w(k + 1);
        }
        if k + 1 < top {
            a3 += amp[k + 1] * q3 * w(k + 2);
        }
        if k + 2 < top {
            a4 += amp[k + 2] * q4 * w(k + 3);
        }
        let n1 = two_c4 * q1 - p1;
        let n2 = two_c4 * q2 - p2;
        let n3 = two_c4 * q3 - p3;
        let n4 = two_c4 * q4 - p4;
        p1 = q1;
        p2 = q2;
        p3 = q3;
        p4 = q4;
        q1 = n1;
        q2 = n2;
        q3 = n3;
        q4 = n4;
        k += 4;
    }
    (a1 + a2) + (a3 + a4)
}

/// Gain of a harmonic at `x` cycles per sample.
#[inline(always)]
fn fade(x: f64) -> f64 {
    if x <= BAND_FULL {
        1.0
    } else if x >= BAND_EDGE {
        0.0
    } else {
        (BAND_EDGE - x) * (1.0 / (BAND_EDGE - BAND_FULL))
    }
}

/// `floor(x)` clamped to [0, H_MAX], for a non-negative `x` (inf included).
#[inline(always)]
fn count(x: f64) -> usize {
    if x >= H_MAX as f64 {
        H_MAX
    } else if x > 0.0 {
        x as usize
    } else {
        0
    }
}

/// Fractional part for x >= 0 (finite).
#[inline(always)]
fn frac(x: f64) -> f64 {
    let f = x - (x as u64) as f64;
    if f >= 1.0 {
        0.0
    } else {
        f
    }
}

/// sin and cos of `2 pi p` for p in [0, 1), to ~1e-16: quadrant reduction to
/// |z| <= pi/4, then Taylor series (no libm in a no_std worklet module).
#[inline(always)]
pub fn sincos_turns(p: f64) -> (f64, f64) {
    // r in [-0.5, 0.5), q the nearest quarter turn.
    let r = if p >= 0.5 { p - 1.0 } else { p };
    let x = r * 4.0 + 0.5;
    let mut q = x as i64; // truncates toward zero
    if (q as f64) > x {
        q -= 1; // floor for negatives
    }
    let z = (r - q as f64 * 0.25) * TAU;
    let z2 = z * z;
    // sin z, cos z for |z| <= pi/4: the next terms are below 5e-17.
    let s = z
        * (1.0
            + z2 * (-1.0 / 6.0
                + z2 * (1.0 / 120.0
                    + z2 * (-1.0 / 5_040.0
                        + z2 * (1.0 / 362_880.0
                            + z2 * (-1.0 / 39_916_800.0
                                + z2 * (1.0 / 6_227_020_800.0
                                    + z2 * (-1.0 / 1_307_674_368_000.0))))))));
    let c = 1.0
        + z2 * (-0.5
            + z2 * (1.0 / 24.0
                + z2 * (-1.0 / 720.0
                    + z2 * (1.0 / 40_320.0
                        + z2 * (-1.0 / 3_628_800.0
                            + z2 * (1.0 / 479_001_600.0
                                + z2 * (-1.0 / 87_178_291_200.0
                                    + z2 * (1.0 / 20_922_789_888_000.0))))))));
    match q & 3 {
        0 => (s, c),
        1 => (c, -s),
        2 => (-s, -c),
        _ => (-c, s),
    }
}

/// sin(pi x) for any finite x (recipes only, not the audio path).
fn sin_pi(x: f64) -> f64 {
    // sin(pi x) = sin(2 pi (x / 2)).
    let h = x * 0.5;
    let t = h - floor(h);
    sincos_turns(t).0
}

fn floor(x: f64) -> f64 {
    let t = (x as i64) as f64;
    if t > x {
        t - 1.0
    } else {
        t
    }
}

/// Square root by Newton iteration (init-time only).
fn sqrt_pos(x: f64) -> f64 {
    // Zero, negative and NaN all land on 0.
    if x.partial_cmp(&0.0) != Some(core::cmp::Ordering::Greater) {
        return 0.0;
    }
    let mut y = if x > 1.0 { x } else { 1.0 };
    for _ in 0..64 {
        let next = 0.5 * (y + x / y);
        if next >= y {
            break;
        }
        y = next;
    }
    y
}

/// A resonance in the harmonic domain: 1 at harmonic `centre`, 1/2 at
/// `centre +- width`. DWGS formants are fixed in harmonic number (they move
/// with the pitch), which is part of the character.
fn peak(k: f64, centre: f64, width: f64) -> f64 {
    let d = (k - centre) / width;
    1.0 / (1.0 + d * d)
}

/// Gentle high-harmonic roll-off, 1/2 at harmonic `corner`.
fn rolloff(k: f64, corner: f64) -> f64 {
    let d = k / corner;
    1.0 / (1.0 + d * d)
}

/// Amplitude (before normalisation) of harmonic `k` (1-based) of `wave`.
/// Signs set the phase (0 or pi); every component is sine-phase.
pub fn recipe(wave: u32, k: usize) -> f64 {
    let kf = k as f64;
    let odd = k % 2 == 1;
    let alt = if odd { 1.0 } else { -1.0 }; // (-1)^(k+1)
    match wave {
        // Rising ramp through 0 at phase 0.
        WAVE_SAW => alt / kf,
        WAVE_SQR => {
            if odd {
                1.0 / kf
            } else {
                0.0
            }
        }
        // Struck string: hammer at ~1/7.6 of the length notches every 7-8th
        // harmonic; a 1/k^2 tail past the 6th.
        WAVE_PIANO => alt * sin_pi(kf / 7.6) * (1.0 / kf) * rolloff(kf, 6.0) * 1.6,
        // Tine: fundamental, a little 2nd/3rd and the bell cluster around 7-9.
        WAVE_EPIANO => match k {
            1 => 1.0,
            2 => 0.32,
            3 => 0.10,
            _ => 0.24 * peak(kf, 8.0, 1.1),
        },
        // Narrow-pulse spectrum (11 % duty: a notch every 9th harmonic) with a
        // soft top. In sine phase a pulse spectrum is a spike (crest ~5); a
        // sign flip every third harmonic spreads it to a buzz like the others.
        WAVE_CLAV => {
            (if (k / 3).is_multiple_of(2) { 1.0 } else { -1.0 }) * sin_pi(0.11 * kf) / kf
                * rolloff(kf, 14.0)
        }
        // Drawbars 8' 4' 2-2/3' 2' 1-3/5' 1-1/3' 1' and a little leakage.
        WAVE_ORGAN => match k {
            1 => 1.0,
            2 => 0.8,
            3 => 0.62,
            4 => 0.5,
            5 => 0.28,
            6 => 0.34,
            8 => 0.4,
            10 | 12 | 16 => 0.04,
            _ => 0.0,
        },
        // Saw with a broad formant around the 5th harmonic and a soft top.
        WAVE_BRASS => alt / kf * (1.0 + 2.5 * peak(kf, 5.0, 2.5)) * rolloff(kf, 16.0),
        // Odd-heavy reed with a formant around the 7th.
        WAVE_REED => {
            (if odd { 1.0 } else { 0.35 }) / kf
                * (1.0 + 1.8 * peak(kf, 7.0, 3.0))
                * rolloff(kf, 20.0)
        }
        // Bowed string: saw through two body resonances.
        WAVE_STRINGS => alt / kf * (1.0 + 1.5 * peak(kf, 4.0, 1.5) + 1.2 * peak(kf, 11.0, 3.0)),
        // Plucked near 1/5.3 of the length: comb notches, 1/k^2 decay.
        WAVE_GUITAR => sin_pi(kf / 5.3) / (kf * kf) * 3.0,
        // Overdrive: dense and flat to the 20s, evens a little behind the odds.
        WAVE_DIST => (if odd { 1.0 } else { 0.55 }) / (1.0 + 0.35 * (kf - 1.0)) * rolloff(kf, 40.0),
        // Round electric bass: 1/k^2 with a lifted 2nd.
        WAVE_BASS => 1.0 / (kf * kf) * (1.0 + 0.6 * peak(kf, 2.0, 0.7)),
        // Hollow synthetic bass: odd harmonics and a sharp resonance at the 6th.
        WAVE_DIGIBASS => (if odd { 1.0 } else { 0.2 }) / kf * (1.0 + 3.0 * peak(kf, 6.0, 0.8)),
        // Sparse, clangorous partials.
        WAVE_BELL => match k {
            1 => 0.6,
            3 => 1.0,
            5 => 0.35,
            7 => 0.75,
            11 => 0.5,
            13 => 0.2,
            17 => 0.4,
            23 => 0.25,
            29 => 0.15,
            _ => 0.0,
        },
        // "Ah": a 1/k source through three formants fixed at harmonics 3.5,
        // 6.5 and 12.
        WAVE_VOX => {
            1.0 / kf
                * (0.2 + peak(kf, 3.5, 1.0) + 0.7 * peak(kf, 6.5, 1.2) + 0.35 * peak(kf, 12.0, 2.5))
        }
        WAVE_SINE if k == 1 => 1.0,
        _ => 0.0,
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
    pub extern "C" fn dwgs_abi_version() -> u32 {
        ABI_VERSION
    }

    #[no_mangle]
    pub extern "C" fn dwgs_max_frames() -> u32 {
        MAX_FRAMES as u32
    }

    #[no_mangle]
    pub extern "C" fn dwgs_wave_count() -> u32 {
        WAVE_COUNT
    }

    #[no_mangle]
    pub extern "C" fn dwgs_freq_ptr() -> *mut f32 {
        engine().freq_mut().as_mut_ptr()
    }

    #[no_mangle]
    pub extern "C" fn dwgs_out_ptr() -> *const f32 {
        engine().out().as_ptr()
    }

    #[no_mangle]
    pub extern "C" fn dwgs_init(sample_rate: f32) -> i32 {
        engine().init(sample_rate) as i32
    }

    #[no_mangle]
    pub extern "C" fn dwgs_reset(phase: f32) {
        engine().reset(phase)
    }

    #[no_mangle]
    pub extern "C" fn dwgs_render(wave: u32, frames: u32, per_sample_freq: u32) -> u32 {
        engine().render(wave, frames as usize, per_sample_freq != 0) as u32
    }

    #[cfg(not(test))]
    #[panic_handler]
    fn panic(_: &core::panic::PanicInfo) -> ! {
        // Unreachable from the exports (indices are bounded by MAX_FRAMES /
        // H_MAX / TONAL_WAVES); trap if it ever is.
        core::arch::wasm32::unreachable()
    }
}

// ── Host tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 48_000.0;

    fn engine() -> Box<Engine> {
        let mut e = Box::new(Engine::new());
        assert!(e.init(SR));
        e
    }

    fn render(wave: u32, hz: f32, n: usize) -> Vec<f32> {
        let mut e = engine();
        e.freq_mut()[0] = hz;
        let mut out = Vec::with_capacity(n);
        while out.len() < n {
            let k = (n - out.len()).min(MAX_FRAMES);
            e.render(wave, k, false);
            out.extend_from_slice(&e.out()[..k]);
        }
        out
    }

    fn rms(x: &[f32]) -> f64 {
        (x.iter().map(|&v| (v as f64) * (v as f64)).sum::<f64>() / x.len() as f64).sqrt()
    }

    /// Power at an exact DFT bin (Goertzel), for an `x` of SR samples (1 Hz bins).
    fn bin_power(x: &[f32], hz: u32) -> f64 {
        let n = x.len() as f64;
        let w = 2.0 * std::f64::consts::PI * hz as f64 / n;
        let (mut s1, mut s2) = (0.0f64, 0.0f64);
        for &v in x {
            let s0 = v as f64 + 2.0 * w.cos() * s1 - s2;
            s2 = s1;
            s1 = s0;
        }
        s1 * s1 + s2 * s2 - 2.0 * w.cos() * s1 * s2
    }

    /// Energy outside DC and the true harmonics, as a fraction of total energy.
    fn alias_ratio(x: &[f32], hz: u32) -> f64 {
        let n = x.len() as f64;
        let total: f64 = x.iter().map(|&v| (v as f64) * (v as f64)).sum::<f64>() * n;
        let mut harmonic = bin_power(x, 0);
        let mut k = 1;
        while k * hz < (SR as u32) / 2 {
            harmonic += 2.0 * bin_power(x, k * hz);
            k += 1;
        }
        ((total - harmonic) / total).max(1e-30)
    }

    #[test]
    fn sincos_matches_libm() {
        let mut worst = 0.0f64;
        for i in 0..100_000 {
            let p = i as f64 / 100_000.0;
            let (s, c) = sincos_turns(p);
            let t = std::f64::consts::TAU * p;
            worst = worst.max((s - t.sin()).abs()).max((c - t.cos()).abs());
        }
        assert!(worst < 1e-14, "worst sin/cos error {worst}");
    }

    #[test]
    fn sqrt_matches_libm() {
        for &x in &[1e-9, 0.01, 0.5, 1.0, 2.0, 1234.5] {
            assert!(
                (sqrt_pos(x) - f64::sqrt(x)).abs() < 1e-12 * f64::sqrt(x).max(1.0),
                "{x}"
            );
        }
        assert_eq!(sqrt_pos(0.0), 0.0);
        assert_eq!(sqrt_pos(f64::NAN), 0.0);
    }

    #[test]
    fn every_tonal_wave_is_scaled_to_the_target_rms() {
        let e = engine();
        for w in 0..TONAL_WAVES as u32 {
            let energy: f64 = (1..=H_MAX).map(|k| e.amplitude(w, k).powi(2)).sum();
            assert!(
                ((energy / 2.0).sqrt() - TARGET_RMS).abs() < 1e-9,
                "wave {w}"
            );
        }
        // At a low note every harmonic is audible, so the rendered RMS is the target.
        for w in 0..TONAL_WAVES as u32 {
            let r = rms(&render(w, 50.0, SR as usize));
            assert!((r - TARGET_RMS).abs() < 2e-3, "wave {w}: rms {r}");
        }
    }

    #[test]
    fn waves_are_distinct_recipes() {
        let e = engine();
        for a in 0..TONAL_WAVES as u32 {
            for b in (a + 1)..TONAL_WAVES as u32 {
                let diff: f64 = (1..=H_MAX)
                    .map(|k| (e.amplitude(a, k) - e.amplitude(b, k)).abs())
                    .sum();
                assert!(diff > 0.05, "waves {a} and {b} are near-identical ({diff})");
            }
        }
    }

    #[test]
    fn peaks_stay_bounded() {
        for w in 0..WAVE_COUNT {
            let x = render(w, 55.0, 4 * SR as usize / 10);
            let peak = x.iter().fold(0.0f32, |m, &v| m.max(v.abs()));
            // Crest factors of 1.2-2.5 at RMS 0.5: nothing louder than the
            // other engines' band-limited saws (~1.17).
            assert!(peak > 0.3 && peak < 1.3, "wave {w}: peak {peak}");
        }
    }

    #[test]
    fn nothing_aliases() {
        // Bright waves high up: every component must still sit on a harmonic.
        for &w in &[WAVE_SAW, WAVE_SQR, WAVE_CLAV, WAVE_DIST, WAVE_STRINGS] {
            for &hz in &[440u32, 1_760, 3_500, 7_000] {
                let r = alias_ratio(&render(w, hz as f32, SR as usize), hz);
                assert!(r < 1e-9, "wave {w} at {hz} Hz: alias energy ratio {r:e}");
            }
        }
    }

    #[test]
    fn harmonics_above_the_band_edge_are_dropped() {
        // 7 kHz at 48 kHz: harmonics 1-2 are full, 3 (21 kHz) is in the fade band.
        let x = render(WAVE_SAW, 7_000.0, SR as usize);
        let h1 = bin_power(&x, 7_000);
        let h2 = bin_power(&x, 14_000);
        let h3 = bin_power(&x, 21_000);
        assert!(h2 / h1 > 0.2 && h2 / h1 < 0.3, "h2/h1 {}", h2 / h1); // (1/2)^2
        assert!(h3 / h1 < (1.0 / 9.0) * 0.6, "h3 is faded: {}", h3 / h1);
        // 12 kHz: only the fundamental (24 kHz is Nyquist) — a pure sine.
        let y = render(WAVE_SAW, 12_000.0, SR as usize);
        assert!(alias_ratio(&y, 12_000) < 1e-9);
    }

    #[test]
    fn sine_wave_is_a_sine() {
        let x = render(WAVE_SINE, 1_000.0, 480);
        for (i, &v) in x.iter().enumerate() {
            let want = TARGET_RMS
                * std::f64::consts::SQRT_2
                * (std::f64::consts::TAU * 1_000.0 * i as f64 / SR as f64).sin();
            assert!((v as f64 - want).abs() < 1e-6, "sample {i}: {v} vs {want}");
        }
    }

    #[test]
    fn every_note_starts_at_zero() {
        for w in 0..WAVE_COUNT {
            let x = render(w, 220.0, 4);
            assert!(x[0].abs() < 1e-6, "wave {w} starts at {}", x[0]);
        }
    }

    #[test]
    fn saw_rises_through_zero() {
        let x = render(WAVE_SAW, 100.0, 120);
        assert!(
            x[60] > x[10] && x[10] > 0.0,
            "rising ramp: {} {}",
            x[10],
            x[60]
        );
    }

    #[test]
    fn noise_colour_tracks_pitch() {
        // Clock = 16 x f: a low note's noise has little energy up high.
        fn high_fraction(x: &[f32]) -> f64 {
            let d: Vec<f32> = x.windows(2).map(|w| w[1] - w[0]).collect();
            rms(&d) / rms(x)
        }
        let low = render(WAVE_NOISE, 55.0, SR as usize / 2);
        let high = render(WAVE_NOISE, 1_000.0, SR as usize / 2);
        assert!(high_fraction(&high) > 4.0 * high_fraction(&low));
        for x in [&low, &high] {
            let r = rms(x);
            assert!((r - TARGET_RMS).abs() < 0.05, "noise rms {r}");
        }
        // Same seed every note: two renders are the same signal.
        assert_eq!(
            render(WAVE_NOISE, 300.0, 1_000),
            render(WAVE_NOISE, 300.0, 1_000)
        );
    }

    #[test]
    fn per_sample_frequency_matches_constant() {
        let mut a = engine();
        let mut b = engine();
        a.freq_mut()[0] = 330.0;
        for v in b.freq_mut().iter_mut() {
            *v = 330.0;
        }
        for _ in 0..4 {
            a.render(WAVE_BRASS, 128, false);
            b.render(WAVE_BRASS, 128, true);
            assert_eq!(a.out()[..128], b.out()[..128]);
        }
    }

    #[test]
    fn slides_are_continuous() {
        // An exponential sweep 50 Hz -> 15 kHz: no sample-to-sample jump bigger
        // than a 15 kHz wave can make on its own.
        let mut e = engine();
        let mut prev = 0.0f32;
        let mut worst = 0.0f32;
        let n = SR as usize;
        let mut i = 0;
        while i < n {
            let k = (n - i).min(128);
            for j in 0..k {
                e.freq_mut()[j] = 50.0 * (300.0f32).powf((i + j) as f32 / n as f32);
            }
            e.render(WAVE_SAW, k, true);
            for j in 0..k {
                worst = worst.max((e.out()[j] - prev).abs());
                prev = e.out()[j];
            }
            i += k;
        }
        assert!(worst < 1.6, "largest step {worst}");
    }

    #[test]
    fn rejects_bad_input() {
        let mut e = Box::new(Engine::new());
        assert_eq!(
            e.render(WAVE_SAW, 16, false),
            0,
            "renders nothing before init"
        );
        assert!(!e.init(f32::NAN));
        assert!(!e.init(1_000.0));
        assert!(e.init(SR));
        e.freq_mut()[0] = f32::NAN;
        assert_eq!(e.render(WAVE_SAW, 64, false), 64);
        assert!(e.out()[..64].iter().all(|v| v.is_finite()));
        e.reset(f32::INFINITY);
        assert_eq!(e.phase(), 0.0);
        e.reset(2.25);
        assert!((e.phase() - 0.25).abs() < 1e-12);
        assert_eq!(e.render(99, 8, false), 8, "an unknown wave plays the saw");
        assert_eq!(e.render(WAVE_SAW, 5_000, false), MAX_FRAMES);
        e.freq_mut()[0] = 1e9;
        e.render(WAVE_SAW, 64, false);
        assert!(e.out()[..64].iter().all(|v| v.is_finite()));
    }
}
