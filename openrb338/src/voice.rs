// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Hyphon contributors.

//! The Hyphon adapter around the extracted [`Tb303`] core.
//!
//! ReBirth plays its 303 from its own step sequencer: every step calls note-on with six bytes
//! `{note, slide, accent, up, down, rest}` and, half a step later, note-off, which a sliding step
//! skips. Hyphon drives the voice with MIDI-style events instead, so this adapter translates:
//!
//! | Host event | Core call |
//! |------------|-----------|
//! | `note_on(n, v)`, no note held | `note_on([n', 0, v > 100, 0, down, 0])`: a retriggered step |
//! | `note_on(n, v)` while a note is held | `slide = true` (the previous step slid), then the same: legato, no envelope retrigger, the pitch glides |
//! | `note_off(n)` for the held note | `note_off()` |
//! | `note_off(n)` for another note while one is held | dropped (a stale note-off of a note a legato note-on replaced) |
//! | `note_off(n)` while none is held | `note_off()`: a rest step's half-step note-off; no gate to close |
//! | `rest(n, v)` | `note_on([n', 0, v > 100, 0, down, 1])`: a ReBirth rest step (optional) |
//! | `all_notes_off()` | `silence()`: slot 6, what ReBirth's stop does |
//!
//! MIDI note 36 (C2, 65.4 Hz) is ReBirth's pitch origin (pitch table index 3072), so a note
//! sounds at the same pitch as on the other Hyphon 303 voices. Notes that would leave the pitch
//! table (6144 entries, -48..+47 semitones around C2 including the tune knob) are folded by
//! octaves.
//!
//! The core renders whole 64-sample blocks and takes control changes at block starts, as
//! ReBirth does; `render` cuts them to any frame count. At 44.1 kHz the output is the core's,
//! sample for sample, times the output gain. Any other host rate goes through [`Resampler`].

use std::sync::OnceLock;

use crate::resample::Resampler;
use crate::tables::Tables;
use crate::tb303::{self, Tb303};
use crate::{BLOCK, Block, CORE_SAMPLE_RATE};

/// The tables every voice shares, built on first use (~152 KiB, a few ms).
pub fn tables() -> &'static Tables {
    static TABLES: OnceLock<Tables> = OnceLock::new();
    TABLES.get_or_init(Tables::new)
}

/// ReBirth 2.01's two sound models (`OPENRB338_MODE_IDS` in `openrb338.ts`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    /// "Vintage": the 1.x 303, control values every 4 samples.
    Vintage = 0,
    /// "ReBirth 2.0 sound": control values once per block, coefficients ramped.
    V2 = 1,
}

impl Mode {
    pub fn from_id(id: u32) -> Option<Self> {
        match id {
            0 => Some(Mode::Vintage),
            1 => Some(Mode::V2),
            _ => None,
        }
    }
}

/// Param ids: the shared `OPEN303_PARAM_IDS` (`src/audio-worklets/open303/shared.ts`), with
/// the normalized 0..1 ranges every Hyphon 303 voice takes.
pub mod param {
    pub const WAVEFORM: u32 = 0;
    pub const TUNING: u32 = 1;
    pub const CUTOFF: u32 = 2;
    pub const RESONANCE: u32 = 3;
    pub const ENV_MOD: u32 = 4;
    pub const DECAY: u32 = 5;
    pub const ACCENT: u32 = 6;
    pub const VOLUME: u32 = 7;
    pub const FILTER_MODE: u32 = 8;
    /// The output gain, linear, after the core: 1.0 is ReBirth's raw 303 bus (peaks reach about
    /// 2.6 at full resonance and accent). `VOLUME` sets it to `volume * MIX_TRIM`.
    pub const OUTPUT_GAIN: u32 = 72;
    /// `RAW_KNOB + ctrl` sets ReBirth controller `ctrl` (2 tune .. 8 waveform) to the knob
    /// position `value` (0..127) directly, for an RBS import that has the original bytes.
    pub const RAW_KNOB: u32 = 64;
}

/// Velocity above which a note is accented (`ACCENT_VELOCITY_THRESHOLD` in
/// `emscripten/open303_wrapper.cpp`).
pub const ACCENT_VELOCITY_THRESHOLD: f32 = 100.0;
/// The MIDI note at ReBirth's pitch origin: semitone 0, pitch table index 3072.
pub const ORIGIN_NOTE: i32 = 36;
/// The pitch table covers semitones -48..=47 around the origin (`3072 + 64*s` in 0..6144).
const SEMIS_MIN: i32 = -48;
const SEMIS_MAX: i32 = 47;

/// ReBirth's mixer at its defaults, channel level 100 and master 100: the bus times `T[100]`,
/// then `2 * T[100]` (`mixer_update` in upstream's `frame`), about 0.2009 (-13.9 dB). `VOLUME`
/// 1.0 plays the voice as loud as one 303 in a fresh ReBirth song, which peaks near 0.5.
pub fn mix_trim() -> f32 {
    let t = crate::tables::level_curve();
    (2.0 * t[100] as f64 * t[100] as f64) as f32
}

/// A normalized 0..1 control to a knob position 0..127 (NaN → 0).
pub fn knob(v: f32) -> u8 {
    if v >= 1.0 {
        127
    } else if v > 0.0 {
        (v * 127.0).round() as u8
    } else {
        0
    }
}

/// One TB-303 voice, as a host drives it.
pub struct Voice {
    tb: Tb303,
    tables: &'static Tables,
    /// The current block and the next sample of it to hand out (`BLOCK` = used up).
    block: Block,
    read: usize,
    /// The MIDI note whose gate is open, -1 for none.
    held: i32,
    /// The output gain, applied after the core (exactly 1.0 leaves its samples untouched).
    gain: f32,
    /// [`mix_trim`], the gain at `VOLUME` 1.0.
    trim: f32,
    /// `None` at 44.1 kHz.
    resampler: Option<Resampler>,
    /// The render buffer `buffer()` hands out.
    out: Vec<f32>,
}

impl Voice {
    /// A voice for a host at `sample_rate`, `None` for a rate outside 8..384 kHz.
    pub fn new(sample_rate: f32, mode: Mode) -> Option<Self> {
        if !(8_000.0..=384_000.0).contains(&sample_rate) {
            return None;
        }
        let mut tb = Tb303::new();
        tb.set_sound_model(mode == Mode::Vintage);
        let resampler = (sample_rate != CORE_SAMPLE_RATE)
            .then(|| Resampler::new(CORE_SAMPLE_RATE as f64 / sample_rate as f64));
        Some(Voice {
            tb,
            tables: tables(),
            block: [0.0; BLOCK],
            read: BLOCK,
            held: -1,
            gain: mix_trim(),
            trim: mix_trim(),
            resampler,
            out: Vec::new(),
        })
    }

    /// True when the host runs at 44.1 kHz, so the output is the core's sample for sample (times
    /// the output gain; with `OUTPUT_GAIN` 1.0, exactly the core's).
    pub fn is_bit_exact(&self) -> bool {
        self.resampler.is_none()
    }

    /// The sound model. As ReBirth's msg 36: the engine switches at the next block, the amp
    /// constants at the next note event.
    pub fn set_mode(&mut self, mode: Mode) {
        self.tb.set_sound_model(mode == Mode::Vintage);
    }

    pub fn set_param(&mut self, id: u32, value: f32) {
        let ctrl = match id {
            param::WAVEFORM => {
                self.tb
                    .set_param(tb303::WAVEFORM as u8, (value >= 0.5) as u8);
                return;
            }
            param::VOLUME => {
                if value.is_finite() {
                    self.gain = value.max(0.0) * self.trim;
                }
                return;
            }
            param::OUTPUT_GAIN => {
                if value.is_finite() {
                    self.gain = value.max(0.0);
                }
                return;
            }
            param::TUNING => tb303::TUNE,
            param::CUTOFF => tb303::CUTOFF,
            param::RESONANCE => tb303::RESONANCE,
            param::ENV_MOD => tb303::ENVMOD,
            param::DECAY => tb303::DECAY,
            param::ACCENT => tb303::ACCENT,
            id if id >= param::RAW_KNOB + tb303::TUNE as u32
                && id <= param::RAW_KNOB + tb303::WAVEFORM as u32 =>
            {
                let v = if value > 0.0 {
                    value.min(127.0).round() as u8
                } else {
                    0
                };
                self.tb.set_param((id - param::RAW_KNOB) as u8, v);
                return;
            }
            // FILTER_MODE and the slide-time knobs have no ReBirth equivalent.
            _ => return,
        };
        self.tb.set_param(ctrl as u8, knob(value));
    }

    pub fn note_on(&mut self, note: i32, velocity: f32) {
        if !(0..=127).contains(&note) {
            return;
        }
        // Velocity 0 (or NaN) is a note-off, as in MIDI.
        if velocity.is_nan() || velocity <= 0.0 {
            self.note_off(note);
            return;
        }
        if self.held >= 0 {
            // The step before this one slid: the gate stays open, no retrigger, the pitch glides.
            self.tb.slide = true;
        }
        let step = self.step(note, velocity, false);
        self.tb.note_on(step);
        self.held = note;
    }

    pub fn note_off(&mut self, note: i32) {
        if note == self.held {
            self.tb.note_off();
            self.held = -1;
        } else if self.held < 0 {
            // Nothing sounds, so this cannot close a gate: it is ReBirth's half-step note-off of
            // a step that did not sound (a rest), which loads the release constants of the
            // current sound model into the amp.
            self.tb.note_off();
        }
    }

    /// A ReBirth rest step: no gate, but the pitch (unless sliding), the decay and the accent
    /// coefficients follow it, which a released note's tail can hear. Follow it with
    /// `note_off(note)` half a step later, as ReBirth does. Optional: a host that sends no rests
    /// plays every note the same; only rest-step tails differ from ReBirth.
    pub fn rest(&mut self, note: i32, velocity: f32) {
        if !(0..=127).contains(&note) {
            return;
        }
        if self.held >= 0 {
            self.tb.slide = true;
        }
        let step = self.step(note, velocity, true);
        self.tb.note_on(step);
    }

    pub fn all_notes_off(&mut self) {
        self.tb.silence();
        self.held = -1;
    }

    /// The step bytes of a MIDI note, folded into the pitch table at the current tune.
    fn step(&self, note: i32, velocity: f32, rest: bool) -> [u8; 6] {
        let tune = tb303::TUNE_TABLE[(self.tb.live[tb303::TUNE] >> 2) as usize] as i32;
        let mut s = note - ORIGIN_NOTE;
        while s + tune > SEMIS_MAX {
            s -= 12;
        }
        while s + tune < SEMIS_MIN {
            s += 12;
        }
        let down = if s < 0 { (11 - s) / 12 } else { 0 };
        let accent = velocity > ACCENT_VELOCITY_THRESHOLD;
        [
            (s + 12 * down) as u8,
            0,
            accent as u8,
            0,
            down as u8,
            rest as u8,
        ]
    }

    /// The render buffer, grown to `max_frames` (allocates: call it at setup, not per block).
    pub fn buffer(&mut self, max_frames: usize) -> &mut [f32] {
        if self.out.len() < max_frames {
            self.out.resize(max_frames, 0.0);
        }
        &mut self.out
    }

    /// Render `frames` samples into the render buffer (clamped to its size).
    pub fn render(&mut self, frames: usize) {
        let mut out = std::mem::take(&mut self.out);
        let n = frames.min(out.len());
        self.render_into(&mut out[..n]);
        self.out = out;
    }

    /// Render `out.len()` samples into `out`.
    pub fn render_into(&mut self, out: &mut [f32]) {
        match self.resampler.take() {
            None => {
                for o in out.iter_mut() {
                    *o = self.next_core();
                }
            }
            Some(mut r) => {
                r.process(out, || self.next_core());
                self.resampler = Some(r);
            }
        }
        if self.gain != 1.0 {
            for o in out.iter_mut() {
                *o *= self.gain;
            }
        }
    }

    #[inline]
    fn next_core(&mut self) -> f32 {
        if self.read == BLOCK {
            self.tb.process(&mut self.block, self.tables);
            self.read = 0;
        }
        let x = self.block[self.read];
        self.read += 1;
        x
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn knob_maps_the_normalized_range() {
        assert_eq!(knob(0.0), 0);
        assert_eq!(knob(1.0), 127);
        assert_eq!(knob(0.5), 64);
        assert_eq!(knob(f32::NAN), 0);
        assert_eq!(knob(-3.0), 0);
        assert_eq!(knob(9.0), 127);
        for b in 0..=127u8 {
            assert_eq!(knob(b as f32 / 127.0), b);
        }
    }

    #[test]
    fn notes_fold_into_the_pitch_table() {
        let mut v = Voice::new(44_100.0, Mode::V2).unwrap();
        for tune in [0.0, 0.5, 1.0] {
            v.set_param(param::TUNING, tune);
            for note in 0..=127 {
                let [n, _, _, up, down, _] = v.step(note, 64.0, false);
                let t = tb303::TUNE_TABLE[(v.tb.live[tb303::TUNE] >> 2) as usize] as i32;
                let s = n as i32 + 12 * up as i32 - 12 * down as i32;
                assert!(
                    (SEMIS_MIN..=SEMIS_MAX).contains(&(s + t)),
                    "note {note} tune {tune}"
                );
                assert_eq!(
                    (s - (note - ORIGIN_NOTE)).rem_euclid(12),
                    0,
                    "pitch class kept"
                );
                let idx = 3072 + 64 * (s + t);
                assert!((0..6144).contains(&idx));
            }
        }
    }

    #[test]
    fn stale_note_off_is_dropped_and_legato_keeps_the_gate() {
        let mut v = Voice::new(44_100.0, Mode::V2).unwrap();
        let mut buf = [0.0f32; BLOCK];
        v.note_on(40, 80.0);
        v.render_into(&mut buf);
        let env = v.tb.env;
        assert!(env < 1.0 && !v.tb.retrig);
        v.note_on(43, 80.0);
        assert!(!v.tb.slide, "the legato step itself does not slide on");
        assert_eq!(v.tb.env, env, "no envelope retrigger");
        assert!(!v.tb.retrig);
        v.note_off(40);
        assert_eq!(v.tb.gate, 1.0);
        v.note_off(43);
        assert_eq!(v.tb.gate, 0.0);
    }

    #[test]
    fn volume_one_is_rebirths_default_mix() {
        let t = mix_trim();
        assert!((t - 0.2009).abs() < 1e-3, "{t}");
        let mut v = Voice::new(44_100.0, Mode::V2).unwrap();
        assert_eq!(v.gain, t);
        v.set_param(param::VOLUME, 0.5);
        assert_eq!(v.gain, 0.5 * t);
        v.set_param(param::OUTPUT_GAIN, 1.0);
        assert_eq!(v.gain, 1.0);
        v.set_param(param::VOLUME, f32::NAN);
        assert_eq!(v.gain, 1.0);
    }

    #[test]
    fn rejects_bad_rates() {
        assert!(Voice::new(0.0, Mode::V2).is_none());
        assert!(Voice::new(f32::NAN, Mode::V2).is_none());
        assert!(Voice::new(1.0e6, Mode::V2).is_none());
        assert!(Voice::new(44_100.0, Mode::V2).unwrap().is_bit_exact());
        assert!(!Voice::new(48_000.0, Mode::V2).unwrap().is_bit_exact());
    }
}
