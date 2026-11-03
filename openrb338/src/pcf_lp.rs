// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 the OpenRB-338 authors.
// Modified for Hyphon (2026-11-03): extracted from openrb-338 at rev
// 88a1770c645a8d29688f4941ed5672e81d1f8cf7.
// - From crates/orb-engine/src/tables/mod.rs: the PCF low-pass table builder (`PCF_K`,
//   `PCF_TOP`, `PcfConsts`, `PCF_LP`, `C_101523CC`, `pcf_filter`, `pcf_lowpass`). The band-pass
//   constants and branch are removed; the low-pass arithmetic is unchanged. `Q_BASE` and
//   `Smoother` come from this crate's `tables.rs`.
// - From crates/orb-engine/src/pcf.rs: the constants and functions the low-pass path reads
//   (`ZERO`, `FREQ_SCALE`, `FREQ_SCALE2`, `TOP`, `smooth_cutoff`, `env_index`, `Filter`),
//   unchanged except that `smooth_cutoff` takes the frequency knob as an f32 (for an integer
//   knob the f64 product is the same) and `Filter` is `Default`.
// The PCF object itself (pattern, envelope, meter, faults) is not extracted; see `lowpass.rs`.

//! ReBirth 2.01's PCF low-pass: the coefficient table and the 2-pole filter (`CPCFInsert`,
//! 0x100166D0; upstream's `docs/initial_investigation.md` section 8.2).
//!
//! The table holds 8 resonance rows of 512 cutoff steps, each `[c0, c1, c2]` for
//! `y = (x*c2 + c0*y1) - c1*y2`. The cutoff steps are exponential: step `i` puts the poles at
//! `w = 0.4 * aw * K^(i - 511)` cycles per sample (at 44.1 kHz, about 7 Hz .. 17.6 kHz), with
//! `K` = 1.01454 (a quarter of a semitone) and `aw` = 0.6 + 0.4 * row / 7.

use libm::{cos, exp, pow};

use crate::tables::{Q_BASE, Smoother};

/// A PCF filter `[res >> 4][env] = [c0, c1, c2]`.
pub type PcfFilter = [[[f32; 3]; 512]; 8];

fn st(x: f64) -> f32 {
    x as f32
}

fn boxed<T: Copy, const N: usize>(v: T) -> Box<[T; N]> {
    vec![v; N].into_boxed_slice().try_into().ok().unwrap()
}

// ------------------------------------------------------------------ table (tables/mod.rs)

/// The PCF base `K` = 1.0145453214645386: 0x100172CE (low) / 0x100172D3 (high), and in the loop
/// 0x100173A1 / 0x100173AA; BP 0x1001757E / 0x10017583 and 0x10017651 / 0x1001765A.
pub const PCF_K: f64 = f64::from_bits(0x3FF0_3B93_E000_0000);
/// 511.0, high dword at 0x100172DD (BP 0x1001758D).
pub const PCF_TOP: f64 = 511.0;

/// The constants of one PCF builder, in the order the builder reads them.
struct PcfConsts {
    c04: f64,
    c052: f64,
    c17: f32,
    c16: f64,
    c05: f64,
    c06: f64,
    c128: f64,
    c512: f64,
    cq: f64,
    c03: f64,
    one_f: f32,
    zero_f: f32,
    one: f64,
    two_pi: f64,
    one_d: f64,
    neg_pi: f64,
    two: f64,
    neg_two_pi: f64,
    four_f: f32,
    three_f: f32,
    c08: f64,
}

/// `sub_100172C4` (LP) data: 0x10152340, 0x10152350, 0x101523C0, 0x10152358, 0x10152360,
/// 0x10152368, 0x10152370, 0x10152378, 0x10152380, 0x10152388, 0x101523C4, 0x101523C8,
/// 0x10152390, 0x10152398, 0x10152328, 0x101523A0, 0x101523A8, 0x101523B0, 0x101523D0,
/// 0x101523D4, 0x101523B8.
const PCF_LP: PcfConsts = PcfConsts {
    c04: 0.4,
    c052: 0.52,
    c17: f32::from_bits(0x3E12_4925),
    c16: f64::from_bits(0x3FC5_5555_5555_5555),
    c05: 0.5,
    c06: 0.6,
    c128: 128.0,
    c512: 1.0 / 512.0,
    cq: 0.000125,
    c03: 0.3,
    one_f: 1.0,
    zero_f: 0.0,
    one: 1.0,
    two_pi: f64::from_bits(0x4019_21FB_5452_4550),
    one_d: 1.0,
    neg_pi: f64::from_bits(0xC009_21FB_5452_4550),
    two: 2.0,
    neg_two_pi: f64::from_bits(0xC019_21FB_5452_4550),
    four_f: 4.0,
    three_f: 3.0,
    c08: 0.8,
};
/// LP: `(c1 + (1 - c0)) * 2f` (0x101523CC).
const C_101523CC: f32 = 2.0;

/// One PCF table (the low-pass branch of upstream's `pcf_filter`).
fn pcf_filter(c: &PcfConsts) -> Box<PcfFilter> {
    let base = c.c04 / pow(PCF_K, PCF_TOP);
    let mut tab: Box<PcfFilter> = boxed([[0.0; 3]; 512]);
    for (r, row) in tab.iter_mut().enumerate() {
        let rf = r as f64;
        let pm = pow(Q_BASE, rf) * c.c052;
        let t = rf * c.c17 as f64;
        let m94 = rf * c.c16 + c.c05;
        let aw = t * c.c04 + c.c06;
        for (i, e) in row.iter_mut().enumerate() {
            let fi = i as f64;
            let w = (pow(PCF_K, fi) * base) * aw;
            let u = (fi * c.c128) * c.c512;
            let mut q = ((((u * fi) * c.c128) * c.c512) * c.cq) - c.c03;
            if q > c.one_f as f64 {
                q = c.one_f as f64;
            }
            if q < c.zero_f as f64 {
                q = c.zero_f as f64;
            }
            let d = q * pm + (c.one - q) * m94;
            let inv_d = c.one_d / d;
            let cs = cos(w * c.two_pi);
            let e1 = exp((w * c.neg_pi) * inv_d);
            let c0 = e1 * (cs * c.two);
            let c1 = exp((w * c.neg_two_pi) * inv_d);
            let num = (c1 + (c.one - c0)) * C_101523CC as f64;
            let dq = if d > c.four_f as f64 {
                c.three_f as f64
            } else {
                d
            };
            let c2 = num / ((dq + c.one_f as f64) * c.c08);
            *e = [st(c0), st(c1), st(c2)];
        }
    }
    tab
}

/// The PCF low-pass table, `sub_100172C4` (PCF ctor `sub_10016490`, guard `byte_1010026C`; at
/// 0x1010C270).
pub fn pcf_lowpass() -> Box<PcfFilter> {
    pcf_filter(&PCF_LP)
}

/// The PCF cutoff smoother (`sub_10017840`, at 0x10100260): the same constants as the 303's
/// (`sub_10026BB0`).
pub fn pcf_smoother() -> Smoother {
    crate::tables::tb303_smoother()
}

// ------------------------------------------------------------------ processing (pcf.rs)

/// `flt_10152294`: 0.0, the envelope's lower clamp.
const ZERO: f32 = 0.0;
/// `flt_10152298`, `flt_1015229C`: the cutoff target `freq * 512 * (1/128)`.
const FREQ_SCALE: f32 = 512.0;
const FREQ_SCALE2: f32 = f32::from_bits(0x3C00_0000); // 1/128
/// `flt_101522A0`: the envelope's upper bound, 511.
const TOP: f32 = f32::from_bits(0x43FF_8000);

/// One step of the cutoff smoother (0x100167B2..0x10016825): with `f = ((freq*512)*(1/128))*g`,
/// `s = (A*y1 + f) - b2*y2`.
pub fn smooth_cutoff(k: &Smoother, freq: f32, y1: f32, y2: f32) -> f64 {
    let f = (freq as f64 * FREQ_SCALE as f64) * FREQ_SCALE2 as f64 * k.g as f64;
    (k.a as f64 * y1 as f64 + f) - k.b2 as f64 * y2 as f64
}

/// The filter table index of an envelope value (0x10016968..0x100169C4): 0 below 0 (or a NaN),
/// 511 above 511, else truncated.
pub fn env_index(env: f64) -> usize {
    let v = if env < ZERO as f64 || env.is_nan() {
        ZERO as f64
    } else if env > TOP as f64 {
        TOP as f64
    } else {
        env
    };
    v as i64 as usize
}

/// The filter's two last outputs (`y1` the latest).
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Filter {
    pub y1: f64,
    pub y2: f64,
}

impl Filter {
    /// One sample: `y = (x*c2 + c0*y1) - c1*y2` (0x100169E3..0x10016A10).
    pub fn step(&mut self, x: f32, c: &[f32; 3]) -> f64 {
        let [c0, c1, c2] = c.map(|v| v as f64);
        let y = (x as f64 * c2 + c0 * self.y1) - c1 * self.y2;
        self.y2 = self.y1;
        self.y1 = y;
        y
    }
}
