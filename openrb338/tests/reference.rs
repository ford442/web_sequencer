// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Hyphon contributors.

//! The extracted core and the Hyphon adapter against upstream openrb-338 (`orb-engine` at the
//! revision the core was extracted from), bit for bit.
//!
//! Upstream's own tests check its engine against ReBirth 2.01 (table dumps of the running DLL and
//! a reference corpus of the original's renders); this closes the chain to `openrb338.wasm`
//! together with `tools/verify-wasm.mjs`.

mod scenario;

use hyphon_openrb338::voice::{Mode, Voice};
use orb_engine::frame::{BlockContext, ChannelDevice, SongDevice};
use scenario::{
    BLOCK, Ev, HostEv, Scenario, host_events, host_events_with, rebirth_step, scenarios,
};

fn upstream_tables() -> &'static orb_engine::tables::Tables {
    static T: std::sync::OnceLock<orb_engine::tables::Tables> = std::sync::OnceLock::new();
    T.get_or_init(orb_engine::tables::Tables::new)
}

/// Upstream's `Tb303`, driven the way its step sequencer drives it.
fn render_upstream(sc: &Scenario) -> Vec<f32> {
    let tables = upstream_tables();
    let ctx = BlockContext {
        tables,
        meter_index: 0,
        tempo: 140_000,
        tick: 0,
        stack_word: None,
    };
    let mut tb = orb_engine::tb303::Tb303::new();
    tb.set_sound_model(sc.vintage);
    let mut out = Vec::with_capacity(sc.blocks * BLOCK);
    let mut events = sc.events.iter().peekable();
    for b in 0..sc.blocks {
        while let Some(&&(at, ev)) = events.peek() {
            if at != b {
                break;
            }
            match ev {
                Ev::Step {
                    note,
                    accent,
                    slide,
                    rest,
                } => tb.note_on(rebirth_step(note, accent, slide, rest)),
                Ev::Off => tb.note_off(),
                Ev::Knob { ctrl, value } => SongDevice::set_param(&mut tb, ctrl, value),
                Ev::Mode { vintage } => tb.set_sound_model(vintage),
                Ev::Stop => tb.silence(),
            }
            events.next();
        }
        let mut block = [0.0f32; BLOCK];
        tb.process(&mut block, &ctx);
        out.extend_from_slice(&block);
    }
    out
}

fn apply(v: &mut Voice, ev: HostEv) {
    match ev {
        HostEv::NoteOn { note, velocity } => v.note_on(note, velocity),
        HostEv::NoteOff { note } => v.note_off(note),
        HostEv::Rest { note, velocity } => v.rest(note, velocity),
        HostEv::Param { id, value } => v.set_param(id, value),
        HostEv::Mode { id } => v.set_mode(Mode::from_id(id).unwrap()),
        HostEv::AllNotesOff => v.all_notes_off(),
    }
}

/// The Hyphon voice at `rate`, driven by host events, rendered in `chunks`-sized calls (cycled)
/// that are split at event frames, as a worklet splitting its quantum would.
fn render_voice(sc: &Scenario, rate: f32, chunks: &[usize]) -> Vec<f32> {
    render_events(sc, host_events(sc), rate, chunks)
}

fn render_events(
    sc: &Scenario,
    host: Vec<(usize, HostEv)>,
    rate: f32,
    chunks: &[usize],
) -> Vec<f32> {
    let mode = if sc.vintage { Mode::Vintage } else { Mode::V2 };
    let mut v = Voice::new(rate, mode).unwrap();
    let total = (sc.blocks * BLOCK) as f64 * rate as f64 / 44_100.0;
    let total = total as usize;
    let scale = rate as f64 / 44_100.0;
    let evs: Vec<(usize, HostEv)> = host
        .into_iter()
        .map(|(f, e)| (((f as f64) * scale).round() as usize, e))
        .collect();
    let mut out = vec![0.0f32; total];
    let (mut pos, mut next_ev, mut c) = (0usize, 0usize, 0usize);
    while pos < total {
        while next_ev < evs.len() && evs[next_ev].0 <= pos {
            apply(&mut v, evs[next_ev].1);
            next_ev += 1;
        }
        let limit = evs.get(next_ev).map_or(total, |e| e.0).min(total);
        let n = chunks[c % chunks.len()].min(limit - pos);
        c += 1;
        v.render_into(&mut out[pos..pos + n]);
        pos += n;
    }
    out
}

fn first_difference(a: &[f32], b: &[f32]) -> Option<(usize, f32, f32)> {
    if a.len() != b.len() {
        return Some((a.len().min(b.len()), f32::NAN, f32::NAN));
    }
    a.iter()
        .zip(b)
        .position(|(x, y)| x.to_bits() != y.to_bits())
        .map(|i| (i, a[i], b[i]))
}

#[test]
fn tables_equal_upstream_bit_for_bit() {
    let ours = hyphon_openrb338::voice::tables();
    let up = upstream_tables();
    let bits = |s: &[f32]| s.iter().map(|x| x.to_bits()).collect::<Vec<_>>();
    assert_eq!(bits(&ours.tb303_pitch[..]), bits(&up.tb303_pitch[..]));
    assert_eq!(
        bits(ours.tb303_filter.as_flattened().as_flattened()),
        bits(up.tb303_filter.as_flattened().as_flattened())
    );
    let (a, b) = (ours.tb303_smoother, up.tb303_smoother);
    assert_eq!(
        [a.a, a.b2, a.g].map(f32::to_bits),
        [b.a, b.b2, b.g].map(f32::to_bits)
    );
}

#[test]
fn voice_at_44k1_equals_upstream_bit_for_bit() {
    for sc in scenarios() {
        let reference = render_upstream(&sc);
        let peak = reference.iter().fold(0.0f32, |m, x| m.max(x.abs()));
        assert!(
            peak > 0.05,
            "{}: the scenario is audible (peak {peak})",
            sc.name
        );
        for chunks in [&[128usize][..], &[64], &[37, 91, 200, 1, 128], &[4096]] {
            let ours = render_voice(&sc, 44_100.0, chunks);
            if let Some((i, a, b)) = first_difference(&reference, &ours) {
                panic!(
                    "{} (chunks {chunks:?}): sample {i} (block {}) upstream {a:e} voice {b:e}",
                    sc.name,
                    i / BLOCK
                );
            }
        }
    }
}

#[test]
fn level_curve_equals_upstream() {
    let ours = hyphon_openrb338::tables::level_curve();
    assert_eq!(
        ours.map(f32::to_bits),
        upstream_tables().level.map(f32::to_bits)
    );
}

#[test]
fn voice_off_44k1_follows_upstream() {
    // Not bit-exact by construction: compare level and spectrum-agnostic energy only.
    for sc in scenarios() {
        let reference = render_upstream(&sc);
        let rms = |x: &[f32]| {
            (x.iter().map(|&v| (v as f64).powi(2)).sum::<f64>() / x.len() as f64).sqrt()
        };
        let r0 = rms(&reference);
        for rate in [48_000.0f32, 96_000.0] {
            let ours = render_voice(&sc, rate, &[128]);
            assert!(ours.iter().all(|x| x.is_finite()), "{} @ {rate}", sc.name);
            let r1 = rms(&ours);
            let db = 20.0 * (r1 / r0).log10();
            assert!(
                db.abs() < 0.5,
                "{} @ {rate}: RMS {db:+.3} dB from upstream",
                sc.name
            );
        }
    }
}

#[test]
fn host_without_rests_differs_only_in_rest_step_tails() {
    // Hyphon's sequencer sends nothing for a rest step. ReBirth still runs note-on with the rest
    // flag there: a released note's tail jumps to the rest step's pitch (unless sliding), and the
    // oscillator phase differs from then on, so samples stop matching while the sound does not.
    // Measured as the energy of each step (step-aligned windows, which the phase barely moves).
    for sc in scenarios() {
        let reference = render_upstream(&sc);
        let ours = render_events(&sc, host_events_with(&sc, false), 44_100.0, &[128]);
        let mut starts: Vec<usize> = sc
            .events
            .iter()
            .filter(|(_, e)| matches!(e, Ev::Step { .. }))
            .map(|(b, _)| b * BLOCK)
            .collect();
        starts.push(reference.len());
        let energy =
            |x: &[f32]| x.iter().map(|&v| (v as f64).powi(2)).sum::<f64>() / x.len() as f64;
        let steps: Vec<(f64, f64)> = starts
            .windows(2)
            .map(|w| (energy(&reference[w[0]..w[1]]), energy(&ours[w[0]..w[1]])))
            .collect();
        let loudest = steps.iter().map(|s| s.0).fold(0.0, f64::max);
        // Steps within 30 dB of the loudest: the ones that carry a note.
        let (mut worst, mut over, mut n) = (0.0f64, 0usize, 0usize);
        for &(a, b) in &steps {
            if a < loudest * 1e-3 {
                continue;
            }
            n += 1;
            let db = (10.0 * (b / a).log10()).abs();
            worst = worst.max(db);
            over += (db > 1.0) as usize;
        }
        let first = reference
            .iter()
            .zip(&ours)
            .position(|(a, b)| a.to_bits() != b.to_bits());
        println!(
            "{:22} no rests: first difference at sample {first:?}; per-step energy worst \
             {worst:.2} dB, {over} of {n} sounding steps off by > 1 dB",
            sc.name
        );
        assert!(ours.iter().all(|x| x.is_finite()));
        // A loose bound, to catch the adapter drifting further than rests explain.
        assert!(worst < 10.0, "{}: {worst:.2} dB", sc.name);
    }
}
