// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Hyphon contributors.

//! The openrb low-pass reference cases: an input, knob moves at block starts, and upstream
//! openrb-338's `Pcf` rendering them in low-pass mode with its envelope at rest (amount 0,
//! instant attack, no new pattern step, smoother primed as the adapter primes it).
//!
//! Used by `tests/lowpass_reference.rs` (native) and `examples/reference_render.rs` (which
//! writes the references `tools/verify-wasm.mjs` compares `openrb338.wasm` against).

#![allow(dead_code)]

use orb_engine::frame::{BlockContext, InsertEffect};
use orb_engine::pcf::{self, Pcf};

pub const BLOCK: usize = 64;

/// A knob move before block `at`.
#[derive(Clone, Copy)]
pub enum Knob {
    Frequency(u8),
    Resonance(u8),
}

pub struct Case {
    pub name: &'static str,
    pub blocks: usize,
    pub frequency: u8,
    pub resonance: u8,
    pub moves: Vec<(usize, Knob)>,
}

pub fn cases() -> Vec<Case> {
    let mut sweep = vec![];
    // A knob ride every 3 blocks over the whole range, both knobs, with jumps.
    let mut x: u32 = 0x1234_5678;
    for b in (3..600).step_by(3) {
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        let knob = if x & 1 == 0 {
            Knob::Frequency((x >> 8) as u8 & 0x7F)
        } else {
            Knob::Resonance((x >> 16) as u8 & 0x7F)
        };
        sweep.push((b, knob));
    }
    vec![
        Case {
            name: "defaults",
            blocks: 200,
            frequency: 70,
            resonance: 64,
            moves: vec![],
        },
        Case {
            name: "low_open",
            blocks: 200,
            frequency: 10,
            resonance: 0,
            moves: vec![(100, Knob::Frequency(127))],
        },
        Case {
            name: "screaming",
            blocks: 300,
            frequency: 90,
            resonance: 127,
            moves: vec![(50, Knob::Frequency(40)), (150, Knob::Frequency(110))],
        },
        Case {
            name: "knob_ride",
            blocks: 600,
            frequency: 64,
            resonance: 32,
            moves: sweep,
        },
    ]
}

/// A saw plus white noise, ReBirth-bus sized (peaks near 1).
pub fn input(n: usize) -> Vec<f32> {
    let mut s: u32 = 0x9E37_79B9;
    (0..n)
        .map(|i| {
            s = s.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            let noise = (s >> 8) as f32 / (1u32 << 24) as f32 - 0.5;
            let saw = ((i % 200) as f32 / 100.0) - 1.0;
            0.6 * saw + 0.4 * noise
        })
        .collect()
}

pub fn render_upstream(tables: &orb_engine::tables::Tables, c: &Case, x: &[f32]) -> Vec<f32> {
    let ctx = BlockContext {
        tables,
        meter_index: 0,
        tempo: 140_000,
        tick: 0,
        stack_word: None,
    };
    let mut p = Pcf::new();
    p.live[pcf::ENABLED] = 1;
    p.live[pcf::MODE] = 1; // low-pass
    p.live[pcf::AMOUNT] = 0;
    p.live[pcf::WAVE] = 0;
    p.live[pcf::FREQUENCY] = c.frequency;
    p.live[pcf::RESONANCE] = c.resonance;
    let (len, _) = pcf::pattern(0);
    assert!(len > 0);
    // The envelope at rest: the step never changes (tick 0 -> step 0), so nothing triggers and
    // the attack stays instant; the smoother is primed as the adapter primes it.
    p.step = 0;
    p.attack = 0.0;
    p.trigger = 0.0;
    let primed = (c.frequency as f64 * 4.0) as f32;
    p.smooth = [primed; 2];
    let mut out = x.to_vec();
    let mut moves = c.moves.iter().peekable();
    for (b, block) in out.as_chunks_mut::<BLOCK>().0.iter_mut().enumerate() {
        while let Some(&&(at, k)) = moves.peek() {
            if at != b {
                break;
            }
            match k {
                Knob::Frequency(v) => p.live[pcf::FREQUENCY] = v,
                Knob::Resonance(v) => p.live[pcf::RESONANCE] = v,
            }
            moves.next();
        }
        p.process(block, &ctx);
    }
    out
}
