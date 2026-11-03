// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Hyphon contributors.

//! The openrb low-pass ([`hyphon_openrb338::lowpass`]) against upstream openrb-338's PCF at the
//! same revision, bit for bit: the table, and the filter as upstream's `Pcf` runs it in low-pass
//! mode with its envelope at rest (amount 0, instant attack, no new pattern step).

mod lowpass_cases;

use hyphon_openrb338::lowpass::{Lowpass, param};
use hyphon_openrb338::pcf_lp;
use lowpass_cases::{BLOCK, Case, Knob, cases, input, render_upstream};

fn upstream_tables() -> &'static orb_engine::tables::Tables {
    static T: std::sync::OnceLock<orb_engine::tables::Tables> = std::sync::OnceLock::new();
    T.get_or_init(orb_engine::tables::Tables::new)
}

#[test]
fn table_and_smoother_are_upstreams() {
    let ours = pcf_lp::pcf_lowpass();
    let theirs = &upstream_tables().pcf_lowpass;
    for r in 0..8 {
        for i in 0..512 {
            for k in 0..3 {
                assert_eq!(
                    ours[r][i][k].to_bits(),
                    theirs[r][i][k].to_bits(),
                    "row {r} step {i} c{k}"
                );
            }
        }
    }
    let (a, b) = (pcf_lp::pcf_smoother(), upstream_tables().pcf_smoother);
    assert_eq!(
        (a.a.to_bits(), a.b2.to_bits(), a.g.to_bits()),
        (b.a.to_bits(), b.b2.to_bits(), b.g.to_bits())
    );
}

fn render_ours(c: &Case, x: &[f32], chunks: &[usize]) -> Vec<f32> {
    let mut f = Lowpass::new(44_100.0).unwrap();
    f.set_param(param::FREQUENCY, c.frequency as f32);
    f.set_param(param::RESONANCE, c.resonance as f32);
    let mut out = x.to_vec();
    let mut moves = c.moves.iter().peekable();
    let mut pos = 0;
    let mut k = 0;
    while pos < out.len() {
        // Moves land before their block; a chunk never straddles a block that has one.
        while let Some(&&(at, m)) = moves.peek() {
            if at * BLOCK > pos {
                break;
            }
            match m {
                Knob::Frequency(v) => f.set_param(param::FREQUENCY, v as f32),
                Knob::Resonance(v) => f.set_param(param::RESONANCE, v as f32),
            }
            moves.next();
        }
        let mut n = chunks[k % chunks.len()].min(out.len() - pos);
        k += 1;
        if let Some(&&(at, _)) = moves.peek() {
            n = n.min(at * BLOCK - pos);
        }
        f.process(&mut out[pos..pos + n]);
        pos += n;
    }
    out
}

#[test]
fn filter_is_upstreams_bit_for_bit() {
    for c in cases() {
        let x = input(c.blocks * BLOCK);
        let want = render_upstream(upstream_tables(), &c, &x);
        assert!(want.iter().all(|v| v.is_finite()), "{}", c.name);
        let rms =
            (want.iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / want.len() as f64).sqrt();
        assert!(rms > 0.01, "{} is silent ({rms})", c.name);
        for chunks in [&[128usize][..], &[64], &[4096], &[37, 91, 200, 1, 128]] {
            let got = render_ours(&c, &x, chunks);
            let first = want
                .iter()
                .zip(&got)
                .position(|(a, b)| a.to_bits() != b.to_bits());
            assert_eq!(first, None, "{} chunks {chunks:?}", c.name);
        }
    }
}
