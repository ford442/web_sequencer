// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 the OpenRB-338 authors and Hyphon contributors.

//! openrb-338's bit-exact ReBirth 2.01 TB-303 as a host-driven voice.
//!
//! - [`tables`] and [`tb303`]: the core, extracted from openrb-338's `orb-engine` (see the
//!   headers of those files for the revision and the changes). It renders 64-sample blocks at
//!   44.1 kHz, the only rate ReBirth has.
//! - [`voice`]: the Hyphon adapter. MIDI notes, velocity accents and legato slides become
//!   ReBirth step bytes; Hyphon's normalized 303 params become knob positions 0..127; blocks are
//!   cut to whatever frame counts the host asks for, and resampled when the host does not run at
//!   44.1 kHz.
//! - [`ffi`]: the C ABI `openrb338.wasm` exports (`Openrb338Exports` in
//!   `src/audio-worklets/openrb338.ts`).

pub mod ffi;
mod resample;
pub mod tables;
// The step sequencer's fields and helpers stay in the vendored struct, unused, so the file
// diffs cleanly against upstream.
#[allow(dead_code)]
pub mod tb303;
pub mod voice;

/// Samples per block (ReBirth's `0x40`).
pub const BLOCK: usize = 64;
/// One block of one mono bus.
pub type Block = [f32; BLOCK];
/// The core's sample rate: ReBirth's pitch table bakes in 1/44100.
pub const CORE_SAMPLE_RATE: f32 = 44_100.0;
