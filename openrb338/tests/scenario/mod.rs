// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Hyphon contributors.

//! Reference scenarios, written twice: as ReBirth's own sequencer would drive upstream's
//! `Tb303` (step bytes, half-step note-offs that a sliding step skips), and as Hyphon drives the
//! extracted voice (MIDI note-on / note-off, legato for slides, normalized params). The two
//! encodings are built independently, so a bit-exact match also checks the adapter's mapping.
//!
//! Used by `tests/reference.rs` (native) and `examples/reference_render.rs` (which writes the
//! references `tools/verify-wasm.mjs` compares `openrb338.wasm` against).

#![allow(dead_code)]

pub const BLOCK: usize = 64;

/// A sequencer event, applied before the block it is at.
#[derive(Debug, Clone, Copy)]
pub enum Ev {
    /// A step: MIDI `note`, accent, `slide` into the next step, `rest`.
    Step {
        note: i32,
        accent: bool,
        slide: bool,
        rest: bool,
    },
    /// The step's half-step note-off (skipped by a sliding step).
    Off,
    /// ReBirth controller `ctrl` (2 tune .. 8 waveform) to knob position `value`.
    Knob {
        ctrl: u8,
        value: u8,
    },
    Mode {
        vintage: bool,
    },
    /// Transport stop (slot 6).
    Stop,
}

pub struct Scenario {
    pub name: String,
    pub vintage: bool,
    pub blocks: usize,
    /// (block, event), sorted by block.
    pub events: Vec<(usize, Ev)>,
}

/// What Hyphon sends instead (`Openrb338Exports`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum HostEv {
    NoteOn { note: i32, velocity: f32 },
    NoteOff { note: i32 },
    Rest { note: i32, velocity: f32 },
    Param { id: u32, value: f32 },
    Mode { id: u32 },
    AllNotesOff,
}

/// ReBirth's step bytes for a MIDI note: a pitch class and octave switches, as its panel
/// would set them (the adapter encodes differently on purpose).
pub fn rebirth_step(note: i32, accent: bool, slide: bool, rest: bool) -> [u8; 6] {
    let s = note - 36;
    let n = s.rem_euclid(12);
    let oct = s.div_euclid(12);
    [
        n as u8,
        slide as u8,
        accent as u8,
        oct.max(0) as u8,
        (-oct).max(0) as u8,
        rest as u8,
    ]
}

/// The host event stream for a scenario, at sample frames.
pub fn host_events(sc: &Scenario) -> Vec<(usize, HostEv)> {
    host_events_with(sc, true)
}

/// `rests: false` is what Hyphon's sequencer sends today: nothing for a rest step.
pub fn host_events_with(sc: &Scenario, rests: bool) -> Vec<(usize, HostEv)> {
    // Compare against the raw bus: OUTPUT_GAIN 1.0 instead of the default mixer trim.
    let mut out = vec![(0, HostEv::Param { id: 72, value: 1.0 })];
    let mut held: Option<i32> = None;
    let mut sliding = false;
    // The note of the last step, when it was a rest: its half-step note-off is sent too.
    let mut rest_note: Option<i32> = None;
    for &(block, ev) in &sc.events {
        let at = block * BLOCK;
        match ev {
            Ev::Step {
                note,
                accent,
                slide,
                rest,
            } => {
                let velocity = if accent { 127.0 } else { 90.0 };
                rest_note = (rests && rest).then_some(note);
                if rest {
                    if rests {
                        out.push((at, HostEv::Rest { note, velocity }));
                    }
                } else {
                    // A legato note-on replaces the held note; the host's late note-off for the
                    // old one is stale and must be dropped (unless it is the same note).
                    out.push((at, HostEv::NoteOn { note, velocity }));
                    if let Some(old) = held.filter(|&o| sliding && o != note) {
                        out.push((at, HostEv::NoteOff { note: old }));
                    }
                    held = Some(note);
                }
                sliding = slide;
            }
            Ev::Off => {
                if !sliding && let Some(n) = held.take().or(rest_note) {
                    out.push((at, HostEv::NoteOff { note: n }));
                }
            }
            Ev::Knob { ctrl, value } => {
                let (id, v) = match ctrl {
                    8 => (0, if value != 0 { 1.0 } else { 0.0 }),
                    2..=7 => (
                        [0, 0, 1, 2, 3, 4, 5, 6][ctrl as usize],
                        value as f32 / 127.0,
                    ),
                    _ => unreachable!(),
                };
                out.push((at, HostEv::Param { id, value: v }));
            }
            Ev::Mode { vintage } => out.push((
                at,
                HostEv::Mode {
                    id: if vintage { 0 } else { 1 },
                },
            )),
            Ev::Stop => {
                out.push((at, HostEv::AllNotesOff));
                held = None;
                sliding = false;
            }
        }
    }
    out
}

/// A small deterministic generator (no dependency).
struct Lcg(u64);

impl Lcg {
    fn next(&mut self) -> u32 {
        self.0 = self
            .0
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        (self.0 >> 33) as u32
    }
    fn below(&mut self, n: u32) -> u32 {
        self.next() % n
    }
    fn chance(&mut self, percent: u32) -> bool {
        self.below(100) < percent
    }
}

/// A 16-step acid line at `step` blocks per step, with knob moves from `knobs`.
fn pattern(
    name: &str,
    vintage: bool,
    seed: u64,
    step: usize,
    bars: usize,
    knobs: impl Fn(&mut Lcg, usize) -> Vec<(u8, u8)>,
) -> Scenario {
    let mut rng = Lcg(seed);
    let mut events = vec![];
    // ReBirth's power-on knobs are tune 64, cutoff 20, reso 90, envmod 20, decay 100,
    // accent 64, saw; start from something brighter.
    for (ctrl, value) in [(3u8, 60u8), (4, 100), (5, 80), (6, 60), (7, 100)] {
        events.push((0, Ev::Knob { ctrl, value }));
    }
    let scale = [0, 3, 5, 7, 10, 12, 15, -12, -5];
    for i in 0..bars * 16 {
        let at = i * step;
        for (ctrl, value) in knobs(&mut rng, i) {
            events.push((at, Ev::Knob { ctrl, value }));
        }
        let note = 36 + scale[rng.below(scale.len() as u32) as usize] + 12 * rng.below(2) as i32;
        let rest = rng.chance(15);
        let accent = rng.chance(30);
        // A rest's slide flag is the one ReBirth step a host cannot express (it has no note to
        // hold), so the scenarios leave it off; see the README's divergence list.
        let slide = !rest && rng.chance(25);
        events.push((
            at,
            Ev::Step {
                note,
                accent,
                slide,
                rest,
            },
        ));
        events.push((at + step / 2, Ev::Off));
    }
    let blocks = bars * 16 * step + 200;
    events.push((bars * 16 * step + 120, Ev::Stop));
    events.sort_by_key(|e| e.0);
    Scenario {
        name: name.into(),
        vintage,
        blocks,
        events,
    }
}

pub fn scenarios() -> Vec<Scenario> {
    let mut all = vec![];
    for vintage in [true, false] {
        let mode = if vintage { "vintage" } else { "v2" };
        // 16th notes at ~140 BPM (74 blocks = 4736 samples per step).
        all.push(pattern(
            &format!("{mode}_acid"),
            vintage,
            1,
            74,
            2,
            |_, _| vec![],
        ));
        all.push(pattern(
            &format!("{mode}_square_sweep"),
            vintage,
            2,
            60,
            2,
            |_, i| {
                let mut k = vec![(3, ((i * 9) % 128) as u8), (4, ((i * 13 + 40) % 128) as u8)];
                if i == 0 {
                    k.push((8, 1));
                }
                k
            },
        ));
        all.push(pattern(
            &format!("{mode}_random_knobs"),
            vintage,
            3 + vintage as u64,
            37,
            4,
            |r, _| {
                (0..r.below(3))
                    .map(|_| (2 + r.below(7) as u8, r.below(128) as u8))
                    .collect()
            },
        ));
    }
    // A mode switch mid-song, and a stop with a note still sounding.
    let mut sw = pattern("mode_switch", false, 9, 50, 2, |_, _| vec![]);
    sw.events.push((800, Ev::Mode { vintage: true }));
    sw.events.push((1300, Ev::Mode { vintage: false }));
    sw.events.push((1001, Ev::Stop));
    sw.events.sort_by_key(|e| e.0);
    all.push(sw);
    all
}
