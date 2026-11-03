// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Hyphon contributors.

//! Writes upstream openrb-338's renders of the reference scenarios, with the host event stream
//! of each, for `tools/verify-wasm.mjs`:
//!
//! ```text
//! cargo run --release --example reference_render -- [out_dir]   # default target/reference
//! ```
//!
//! `out_dir/manifest.json` lists the scenarios; `<name>.f32` is upstream's output (mono, 44.1 kHz,
//! little-endian f32) and `<name>.events.json` the host events as `[frame, kind, a, b]`.
//!
//! `out_dir/lowpass/` holds the openrb low-pass cases the same way: `manifest.json` (initial
//! knobs and the moves as `[block, "f"|"r", value]`), `<name>.in.f32` the input and
//! `<name>.f32` upstream's PCF output.

#[path = "../tests/lowpass_cases/mod.rs"]
mod lowpass_cases;
#[path = "../tests/scenario/mod.rs"]
mod scenario;

use std::fmt::Write as _;
use std::path::PathBuf;

use orb_engine::frame::{BlockContext, ChannelDevice, SongDevice};
use scenario::{BLOCK, Ev, HostEv, host_events, rebirth_step, scenarios};

fn main() {
    let dir: PathBuf = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "target/reference".into())
        .into();
    std::fs::create_dir_all(&dir).expect("create the output directory");
    let tables = orb_engine::tables::Tables::new();
    let ctx = BlockContext {
        tables: &tables,
        meter_index: 0,
        tempo: 140_000,
        tick: 0,
        stack_word: None,
    };
    let mut manifest = String::from("[\n");
    let all = scenarios();
    for (k, sc) in all.iter().enumerate() {
        let mut tb = orb_engine::tb303::Tb303::new();
        tb.set_sound_model(sc.vintage);
        let mut audio = Vec::with_capacity(sc.blocks * BLOCK * 4);
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
            for x in block {
                audio.extend_from_slice(&x.to_le_bytes());
            }
        }
        std::fs::write(dir.join(format!("{}.f32", sc.name)), &audio).expect("write audio");

        let mut ev = String::from("[\n");
        let host = host_events(sc);
        for (i, (frame, e)) in host.iter().enumerate() {
            // f32 values print as the shortest decimal that parses back to the same f32.
            let row = match *e {
                HostEv::NoteOn { note, velocity } => {
                    format!("[{frame},\"on\",{note},{velocity:?}]")
                }
                HostEv::NoteOff { note } => format!("[{frame},\"off\",{note},0]"),
                HostEv::Rest { note, velocity } => {
                    format!("[{frame},\"rest\",{note},{velocity:?}]")
                }
                HostEv::Param { id, value } => format!("[{frame},\"param\",{id},{value:?}]"),
                HostEv::Mode { id } => format!("[{frame},\"mode\",{id},0]"),
                HostEv::AllNotesOff => format!("[{frame},\"alloff\",0,0]"),
            };
            let sep = if i + 1 < host.len() { "," } else { "" };
            writeln!(ev, "  {row}{sep}").unwrap();
        }
        ev.push_str("]\n");
        std::fs::write(dir.join(format!("{}.events.json", sc.name)), ev).expect("write events");

        let sep = if k + 1 < all.len() { "," } else { "" };
        writeln!(
            manifest,
            "  {{\"name\":\"{}\",\"mode\":{},\"frames\":{}}}{sep}",
            sc.name,
            if sc.vintage { 0 } else { 1 },
            sc.blocks * BLOCK
        )
        .unwrap();
    }
    manifest.push_str("]\n");
    std::fs::write(dir.join("manifest.json"), manifest).expect("write manifest");
    println!("{} scenarios -> {}", all.len(), dir.display());
    lowpass(&tables, &dir.join("lowpass"));
}

fn f32_bytes(x: &[f32]) -> Vec<u8> {
    x.iter().flat_map(|v| v.to_le_bytes()).collect()
}

/// The openrb low-pass references (`tests/lowpass_cases`).
fn lowpass(tables: &orb_engine::tables::Tables, dir: &std::path::Path) {
    use lowpass_cases::{BLOCK, Knob, cases, input, render_upstream};
    std::fs::create_dir_all(dir).expect("create the lowpass directory");
    let all = cases();
    let mut manifest = String::from("[\n");
    for (k, c) in all.iter().enumerate() {
        let x = input(c.blocks * BLOCK);
        let y = render_upstream(tables, c, &x);
        std::fs::write(dir.join(format!("{}.in.f32", c.name)), f32_bytes(&x)).expect("write");
        std::fs::write(dir.join(format!("{}.f32", c.name)), f32_bytes(&y)).expect("write");
        let moves: Vec<String> = c
            .moves
            .iter()
            .map(|&(b, m)| match m {
                Knob::Frequency(v) => format!("[{b},\"f\",{v}]"),
                Knob::Resonance(v) => format!("[{b},\"r\",{v}]"),
            })
            .collect();
        let sep = if k + 1 < all.len() { "," } else { "" };
        writeln!(
            manifest,
            "  {{\"name\":\"{}\",\"frames\":{},\"frequency\":{},\"resonance\":{},\"moves\":[{}]}}{sep}",
            c.name,
            c.blocks * BLOCK,
            c.frequency,
            c.resonance,
            moves.join(",")
        )
        .unwrap();
    }
    manifest.push_str("]\n");
    std::fs::write(dir.join("manifest.json"), manifest).expect("write manifest");
    println!("{} low-pass cases -> {}", all.len(), dir.display());
}
