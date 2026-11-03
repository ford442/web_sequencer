// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Hyphon contributors.

//! The patch bay's "openrb" low-pass: ReBirth's PCF low-pass ([`crate::pcf_lp`]) as a static
//! insert filter.
//!
//! ReBirth's PCF moves its cutoff with a pattern-triggered envelope. A patch-bay low-pass has no
//! pattern, so this is the PCF with its envelope at rest: amount 0 and an instant attack, which
//! makes the envelope equal the smoothed cutoff base in every group. The rest is upstream's
//! block, unchanged:
//!
//! - once per 64-sample block, the 2-pole smoother moves the base towards `4 * frequency`, the
//!   table index is `trunc(base)` (0..511), and the row is `(resonance * 8) >> 7` (0..7);
//! - every sample, `y = (x*c2 + c0*y1) - c1*y2` in f64, output `f32(y)`;
//! - the filter state is stored as f32 at the block end.
//!
//! At 44.1 kHz and integer knob positions the output equals upstream's `Pcf` in that state, bit
//! for bit (`tests/lowpass_reference.rs`). Two host conveniences sit on top:
//!
//! - **Hz and Q.** [`param::CUTOFF_HZ`] picks the (fractional) frequency knob whose table step
//!   puts the poles at that frequency; [`param::Q`] picks the resonance row whose pole Q at the
//!   current cutoff is nearest. ReBirth has 8 rows, so Q is coarse.
//! - **Other host rates.** The table bakes in 44.1 kHz. At another rate the filter runs at the
//!   host rate with the table index shifted by `log_K(44100 / rate)` steps, so the poles stay at
//!   the same frequency in Hz (within one quarter-semitone step, as the index is truncated). Not
//!   bit-exact; the smoother's time constant also scales with the block rate.
//!
//! One deliberate divergence: the smoother starts at the first block's target instead of 0, so
//! a new node does not sweep up from 7 Hz. The reference test primes upstream the same way.

use std::sync::OnceLock;

use crate::pcf_lp::{self, Filter, PCF_K, PCF_TOP, PcfFilter};
use crate::tables::Smoother;
use crate::{BLOCK, CORE_SAMPLE_RATE};

/// The low-pass table and smoother every filter shares (48 KiB), built on first use.
fn table() -> &'static (Box<PcfFilter>, Smoother) {
    static T: OnceLock<(Box<PcfFilter>, Smoother)> = OnceLock::new();
    T.get_or_init(|| (pcf_lp::pcf_lowpass(), pcf_lp::pcf_smoother()))
}

/// Param ids (`OPENRB_LP_PARAM_IDS` in `src/audio-worklets/openrbLowpass.ts`).
pub mod param {
    /// ReBirth's PCF frequency knob, 0..127 (fractional positions allowed, up to 127.75 for the
    /// top table step). Clears a [`CUTOFF_HZ`] target.
    pub const FREQUENCY: u32 = 0;
    /// ReBirth's PCF resonance knob, 0..127 (rounded). Clears a [`Q`] target.
    pub const RESONANCE: u32 = 1;
    /// Linear output gain after the filter; 1.0 is ReBirth's level.
    pub const OUTPUT_GAIN: u32 = 2;
    /// Cutoff (pole frequency) in Hz.
    pub const CUTOFF_HZ: u32 = 3;
    /// Pole Q (the nearest of the 8 resonance rows).
    pub const Q: u32 = 4;
}

/// The top table step as a knob position (`511 / 4`).
pub const FREQUENCY_MAX: f32 = 127.75;
/// ReBirth's PCF defaults (`sub_10019C10`): frequency 70, resonance 64.
pub const DEFAULT_FREQUENCY: f32 = 70.0;
pub const DEFAULT_RESONANCE: u8 = 64;

/// f32 1/7 (`c17` of the builder), so the row's frequency scale matches the table's.
const ONE_SEVENTH: f32 = f32::from_bits(0x3E12_4925);

/// `aw` of the builder: the pole frequency scale of resonance row `row`.
fn row_scale(row: usize) -> f64 {
    (row as f64 * ONE_SEVENTH as f64) * 0.4 + 0.6
}

/// The fractional table step whose poles sit at `hz` at 44.1 kHz, in row `row`.
pub fn index_for_hz(hz: f64, row: usize) -> f64 {
    let w = hz / CORE_SAMPLE_RATE as f64;
    PCF_TOP + (w / (0.4 * row_scale(row))).ln() / PCF_K.ln()
}

/// The pole frequency (Hz at 44.1 kHz) and pole Q of a table entry, from its coefficients:
/// `c1 = r^2`, `c0 = 2 r cos(theta)`, and the builder's `d` is `-theta / ln(c1)`.
pub fn pole(c: &[f32; 3]) -> (f64, f64) {
    let (c0, c1) = (c[0] as f64, c[1] as f64);
    let theta = (c0 / (2.0 * c1.sqrt())).clamp(-1.0, 1.0).acos();
    let hz = theta / std::f64::consts::TAU * CORE_SAMPLE_RATE as f64;
    (hz, -theta / c1.ln())
}

/// The resonance row whose pole Q at table step `index` is nearest to `q` (log distance).
pub fn row_for_q(q: f64, index: usize) -> usize {
    let (tab, _) = table();
    // Below step ~196 the builder's Q does not depend on the step; the low steps' `c1` is too
    // close to 1 to read it back precisely, so they are read at 128.
    let i = index.clamp(128, 511);
    let target = q.max(1e-3).ln();
    (0..8)
        .min_by(|&a, &b| {
            let da = (pole(&tab[a][i]).1.ln() - target).abs();
            let db = (pole(&tab[b][i]).1.ln() - target).abs();
            da.total_cmp(&db)
        })
        .unwrap_or(0)
}

/// One mono openrb low-pass.
pub struct Lowpass {
    rate: f32,
    /// Table steps added to the index at this host rate (0 at 44.1 kHz).
    offset: f64,
    /// The frequency knob (0..127.75) and the resonance knob (0..127).
    frequency: f32,
    resonance: u8,
    gain: f32,
    /// Host targets in Hz / Q, re-resolved when either changes.
    hz: Option<f64>,
    q: Option<f64>,
    /// `+0x80`, `+0x84`: the smoother's last two outputs; `+0x50`, `+0x54`: the filter state.
    smooth: [f32; 2],
    state: [f32; 2],
    primed: bool,
    /// The running block: its coefficients, f64 state and position (0..64).
    coefs: [f32; 3],
    filter: Filter,
    pos: usize,
    buf: Vec<f32>,
}

impl Lowpass {
    /// A filter for a host at `sample_rate` Hz (8..384 kHz), at ReBirth's defaults.
    pub fn new(sample_rate: f32) -> Option<Self> {
        if !(8_000.0..=384_000.0).contains(&sample_rate) {
            return None;
        }
        let offset = if sample_rate == CORE_SAMPLE_RATE {
            0.0
        } else {
            (CORE_SAMPLE_RATE as f64 / sample_rate as f64).ln() / PCF_K.ln()
        };
        Some(Lowpass {
            rate: sample_rate,
            offset,
            frequency: DEFAULT_FREQUENCY,
            resonance: DEFAULT_RESONANCE,
            gain: 1.0,
            hz: None,
            q: None,
            smooth: [0.0; 2],
            state: [0.0; 2],
            primed: false,
            coefs: [0.0; 3],
            filter: Filter::default(),
            pos: 0,
            buf: Vec::new(),
        })
    }

    /// True when the output is upstream's sample for sample (host at 44.1 kHz).
    pub fn is_bit_exact(&self) -> bool {
        self.rate == CORE_SAMPLE_RATE
    }

    pub fn frequency(&self) -> f32 {
        self.frequency
    }

    pub fn resonance(&self) -> u8 {
        self.resonance
    }

    fn row(&self) -> usize {
        ((self.resonance as usize * 8) >> 7).min(7)
    }

    /// Set a param ([`param`]); non-finite values are ignored. Takes effect at the next block.
    pub fn set_param(&mut self, id: u32, value: f32) {
        if !value.is_finite() {
            return;
        }
        match id {
            param::FREQUENCY => {
                self.hz = None;
                self.frequency = value.clamp(0.0, FREQUENCY_MAX);
            }
            param::RESONANCE => {
                self.q = None;
                self.resonance = value.round().clamp(0.0, 127.0) as u8;
            }
            param::OUTPUT_GAIN => self.gain = value.max(0.0),
            param::CUTOFF_HZ => {
                self.hz = Some((value as f64).max(1.0));
                self.retarget();
            }
            param::Q => {
                self.q = Some((value as f64).max(1e-3));
                self.retarget();
            }
            _ => {}
        }
    }

    /// Resolve the Hz / Q targets to knob positions: the row from Q at the cutoff's step, then
    /// the step from Hz in that row (the row scales the pole frequency).
    fn retarget(&mut self) {
        let step = |hz: f64, row: usize| index_for_hz(hz, row).clamp(0.0, PCF_TOP);
        if let Some(q) = self.q {
            let at = match self.hz {
                Some(hz) => step(hz, self.row()),
                None => self.frequency as f64 * 4.0,
            };
            let row = row_for_q(q, at as usize);
            self.resonance = (row * 16) as u8;
        }
        if let Some(hz) = self.hz {
            self.frequency = (step(hz, self.row()) / 4.0) as f32;
        }
    }

    /// Clear the filter and smoother state (the next block re-primes the smoother).
    pub fn reset(&mut self) {
        self.smooth = [0.0; 2];
        self.state = [0.0; 2];
        self.primed = false;
        self.filter = Filter::default();
        self.pos = 0;
    }

    /// The block start of 0x100166D0 with the envelope at rest: the smoother, the index, the row.
    fn begin_block(&mut self) {
        let (tab, k) = table();
        if !self.primed {
            let target = (self.frequency as f64 * 4.0) as f32;
            self.smooth = [target; 2];
            self.primed = true;
        }
        let s = pcf_lp::smooth_cutoff(k, self.frequency, self.smooth[0], self.smooth[1]);
        self.smooth[1] = self.smooth[0];
        self.smooth[0] = s as f32;
        // The envelope with E = 0 and an instant attack is `(0 + base) * 1`, the stored base.
        let base = s as f32;
        let index = pcf_lp::env_index(base as f64 + self.offset);
        self.coefs = tab[self.row()][index];
        self.filter = Filter {
            y1: self.state[0] as f64,
            y2: self.state[1] as f64,
        };
    }

    /// Filter `io` in place.
    pub fn process(&mut self, io: &mut [f32]) {
        for x in io.iter_mut() {
            if self.pos == 0 {
                self.begin_block();
            }
            let y = self.filter.step(*x, &self.coefs) as f32;
            *x = if self.gain == 1.0 { y } else { y * self.gain };
            self.pos += 1;
            if self.pos == BLOCK {
                self.state = [self.filter.y1 as f32, self.filter.y2 as f32];
                self.pos = 0;
            }
        }
    }

    /// The in-place buffer, at least `max_frames` long.
    pub fn buffer(&mut self, max_frames: usize) -> &mut [f32] {
        if self.buf.len() < max_frames {
            self.buf.resize(max_frames, 0.0);
        }
        &mut self.buf
    }

    /// Filter the first `frames` samples of the buffer in place (clamped to its size).
    pub fn process_buffer(&mut self, frames: usize) {
        let mut buf = std::mem::take(&mut self.buf);
        let n = frames.min(buf.len());
        self.process(&mut buf[..n]);
        self.buf = buf;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hz_maps_to_the_table_step_with_poles_there() {
        let (tab, _) = table();
        for row in [0usize, 3, 7] {
            for hz in [60.0, 440.0, 2000.0, 9000.0] {
                let i = index_for_hz(hz, row).round() as usize;
                let (pole_hz, _) = pole(&tab[row][i]);
                let cents = 1200.0 * (pole_hz / hz).log2();
                assert!(
                    cents.abs() < 15.0,
                    "row {row} {hz} Hz -> step {i} at {pole_hz} Hz"
                );
            }
        }
    }

    #[test]
    fn q_picks_more_resonance_for_more_q() {
        let lo = row_for_q(0.5, 400);
        let hi = row_for_q(12.0, 400);
        assert!(hi > lo, "{lo} {hi}");
        assert_eq!(row_for_q(1000.0, 400), 7);
    }

    #[test]
    fn off_rate_keeps_the_pole_frequency() {
        let mut a = Lowpass::new(96_000.0).unwrap();
        a.set_param(param::CUTOFF_HZ, 1000.0);
        assert!(!a.is_bit_exact());
        let mut b = Lowpass::new(44_100.0).unwrap();
        b.set_param(param::CUTOFF_HZ, 1000.0);
        assert!(b.is_bit_exact());
        assert_eq!(a.frequency(), b.frequency(), "the knob is the 44.1 kHz one");
        let mut io = [0.0f32; 128];
        a.process(&mut io);
        let i96 = pcf_lp::env_index(a.smooth[0] as f64 + a.offset);
        let (hz44, _) = pole(&table().0[a.row()][i96]);
        let hz96 = hz44 * 96_000.0 / 44_100.0;
        assert!((1200.0 * (hz96 / 1000.0).log2()).abs() < 30.0, "{hz96}");
    }

    #[test]
    fn dc_settles_at_the_tables_gain_and_stays_finite() {
        let mut f = Lowpass::new(44_100.0).unwrap();
        f.set_param(param::CUTOFF_HZ, 2000.0);
        f.set_param(param::Q, 0.7);
        let mut io = vec![0.25f32; 44_100];
        f.process(&mut io);
        assert!(io.iter().all(|x| x.is_finite()));
        let c = table().0[f.row()][(f.frequency() * 4.0) as usize];
        let dc = c[2] as f64 / (1.0 - c[0] as f64 + c[1] as f64);
        assert!(
            (io[44_099] as f64 - 0.25 * dc).abs() < 1e-3,
            "{} vs {}",
            io[44_099],
            0.25 * dc
        );
    }
}
