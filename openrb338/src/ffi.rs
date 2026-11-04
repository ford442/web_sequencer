// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Hyphon contributors.

//! The C ABI of `openrb338.wasm`, revision [`ABI_VERSION`]: `Openrb338Exports` in
//! `src/audio-worklets/openrb338.ts`.
//!
//! Handles are small integers (1-based slot numbers; 0 is "none"), so a bad handle is a no-op,
//! never a wild pointer. Every call is cheap and allocation-free except `create` and `buffer`,
//! which the host makes at setup. wasm32-unknown-unknown is single-threaded, so the slots live in
//! a thread-local.
//!
//! Required (ABI 1): `abi_version`, `create`, `destroy`, `set_mode`, `set_param`, `note_on`,
//! `note_off`, `all_notes_off`, `buffer`, `render`. Optional extras, which a host probes before
//! use: `openrb303_rest`, `openrb303_is_bit_exact`.
//!
//! The low-pass set (`openrb_lp_*`, revision [`LP_VERSION`]) is a separate, optional group with
//! its own handle table: the patch bay's openrb low-pass node ([`crate::lowpass`]). A host
//! probes `openrb_lp_version` before using it.

use std::cell::RefCell;

use crate::lowpass::Lowpass;
use crate::voice::{Mode, Voice};

/// The ABI revision (`OPENRB338_ABI_VERSION`).
pub const ABI_VERSION: u32 = 1;
/// Voices one module instance holds (a worklet needs one per 303 part).
pub const MAX_VOICES: usize = 16;

/// The low-pass group's revision (`OPENRB_LP_VERSION`).
pub const LP_VERSION: u32 = 1;
/// Low-pass filters one module instance holds (one per channel of each node).
pub const MAX_FILTERS: usize = 64;

thread_local! {
    static VOICES: RefCell<Vec<Option<Box<Voice>>>> = const { RefCell::new(Vec::new()) };
    static FILTERS: RefCell<Vec<Option<Box<Lowpass>>>> = const { RefCell::new(Vec::new()) };
}

fn with_lp<R>(handle: u32, f: impl FnOnce(&mut Lowpass) -> R) -> Option<R> {
    let i = (handle as usize).checked_sub(1)?;
    FILTERS.with_borrow_mut(|v| v.get_mut(i)?.as_deref_mut().map(f))
}

fn with<R>(handle: u32, f: impl FnOnce(&mut Voice) -> R) -> Option<R> {
    let i = (handle as usize).checked_sub(1)?;
    VOICES.with_borrow_mut(|v| v.get_mut(i)?.as_deref_mut().map(f))
}

#[unsafe(no_mangle)]
pub extern "C" fn openrb303_abi_version() -> u32 {
    ABI_VERSION
}

/// A new voice for a host at `sample_rate` Hz in `mode` (0 Vintage, 1 2.0); 0 on failure (bad
/// rate or mode, or all [`MAX_VOICES`] in use).
#[unsafe(no_mangle)]
pub extern "C" fn openrb303_create(sample_rate: f32, mode: u32) -> u32 {
    let Some(voice) = Mode::from_id(mode).and_then(|m| Voice::new(sample_rate, m)) else {
        return 0;
    };
    VOICES.with_borrow_mut(|v| {
        let i = match v.iter().position(Option::is_none) {
            Some(i) => i,
            None if v.len() < MAX_VOICES => {
                v.push(None);
                v.len() - 1
            }
            None => return 0,
        };
        v[i] = Some(Box::new(voice));
        i as u32 + 1
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn openrb303_destroy(handle: u32) {
    if let Some(i) = (handle as usize).checked_sub(1) {
        VOICES.with_borrow_mut(|v| {
            if let Some(slot) = v.get_mut(i) {
                *slot = None;
            }
        });
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn openrb303_set_mode(handle: u32, mode: u32) {
    if let Some(m) = Mode::from_id(mode) {
        with(handle, |v| v.set_mode(m));
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn openrb303_set_param(handle: u32, param_id: u32, value: f32) {
    with(handle, |v| v.set_param(param_id, value));
}

#[unsafe(no_mangle)]
pub extern "C" fn openrb303_note_on(handle: u32, note: i32, velocity: f32) {
    with(handle, |v| v.note_on(note, velocity));
}

#[unsafe(no_mangle)]
pub extern "C" fn openrb303_note_off(handle: u32, note: i32) {
    with(handle, |v| v.note_off(note));
}

#[unsafe(no_mangle)]
pub extern "C" fn openrb303_all_notes_off(handle: u32) {
    with(handle, |v| v.all_notes_off());
}

/// Optional: a ReBirth rest step ([`Voice::rest`]).
#[unsafe(no_mangle)]
pub extern "C" fn openrb303_rest(handle: u32, note: i32, velocity: f32) {
    with(handle, |v| v.rest(note, velocity));
}

/// Optional: 1 when the voice's output is the core's sample for sample (host at 44.1 kHz).
#[unsafe(no_mangle)]
pub extern "C" fn openrb303_is_bit_exact(handle: u32) -> u32 {
    with(handle, |v| v.is_bit_exact() as u32).unwrap_or(0)
}

/// The voice's mono f32 render buffer, at least `max_frames` long; null for a bad handle. It
/// moves only when a later call asks for more frames, so the host keeps one view per voice.
#[unsafe(no_mangle)]
pub extern "C" fn openrb303_buffer(handle: u32, max_frames: u32) -> *mut f32 {
    with(handle, |v| v.buffer(max_frames as usize).as_mut_ptr()).unwrap_or(std::ptr::null_mut())
}

/// Render `frames` mono samples into the render buffer (clamped to its size).
#[unsafe(no_mangle)]
pub extern "C" fn openrb303_render(handle: u32, frames: u32) {
    with(handle, |v| v.render(frames as usize));
}

// ------------------------------------------------------------------ low-pass (optional)

#[unsafe(no_mangle)]
pub extern "C" fn openrb_lp_version() -> u32 {
    LP_VERSION
}

/// A new openrb low-pass for a host at `sample_rate` Hz; 0 on failure (bad rate, or all
/// [`MAX_FILTERS`] in use).
#[unsafe(no_mangle)]
pub extern "C" fn openrb_lp_create(sample_rate: f32) -> u32 {
    let Some(filter) = Lowpass::new(sample_rate) else {
        return 0;
    };
    FILTERS.with_borrow_mut(|v| {
        let i = match v.iter().position(Option::is_none) {
            Some(i) => i,
            None if v.len() < MAX_FILTERS => {
                v.push(None);
                v.len() - 1
            }
            None => return 0,
        };
        v[i] = Some(Box::new(filter));
        i as u32 + 1
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn openrb_lp_destroy(handle: u32) {
    if let Some(i) = (handle as usize).checked_sub(1) {
        FILTERS.with_borrow_mut(|v| {
            if let Some(slot) = v.get_mut(i) {
                *slot = None;
            }
        });
    }
}

/// [`crate::lowpass::param`]; takes effect at the next 64-sample block.
#[unsafe(no_mangle)]
pub extern "C" fn openrb_lp_set_param(handle: u32, param_id: u32, value: f32) {
    with_lp(handle, |f| f.set_param(param_id, value));
}

#[unsafe(no_mangle)]
pub extern "C" fn openrb_lp_reset(handle: u32) {
    with_lp(handle, |f| f.reset());
}

/// 1 when the output is upstream's sample for sample (host at 44.1 kHz).
#[unsafe(no_mangle)]
pub extern "C" fn openrb_lp_is_bit_exact(handle: u32) -> u32 {
    with_lp(handle, |f| f.is_bit_exact() as u32).unwrap_or(0)
}

/// The filter's in-place mono f32 buffer, at least `max_frames` long; null for a bad handle. It
/// moves only when a later call asks for more frames.
#[unsafe(no_mangle)]
pub extern "C" fn openrb_lp_buffer(handle: u32, max_frames: u32) -> *mut f32 {
    with_lp(handle, |f| f.buffer(max_frames as usize).as_mut_ptr()).unwrap_or(std::ptr::null_mut())
}

/// Filter the first `frames` samples of the buffer in place (clamped to its size).
#[unsafe(no_mangle)]
pub extern "C" fn openrb_lp_process(handle: u32, frames: u32) {
    with_lp(handle, |f| f.process_buffer(frames as usize));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lowpass_handles_are_checked_and_recycled() {
        assert_eq!(openrb_lp_version(), LP_VERSION);
        assert_eq!(openrb_lp_create(1.0), 0);
        let a = openrb_lp_create(44_100.0);
        let b = openrb_lp_create(48_000.0);
        assert!(a != 0 && b != 0 && a != b);
        assert_eq!(openrb_lp_is_bit_exact(a), 1);
        assert_eq!(openrb_lp_is_bit_exact(b), 0);
        assert!(openrb_lp_buffer(0, 128).is_null());
        let p = openrb_lp_buffer(a, 128);
        assert!(!p.is_null());
        openrb_lp_set_param(a, 3, 800.0);
        openrb_lp_process(a, 128);
        openrb_lp_process(999, 128);
        openrb_lp_destroy(a);
        assert_eq!(openrb_lp_create(44_100.0), a, "the slot is reused");
        openrb_lp_destroy(a);
        openrb_lp_destroy(b);
    }

    #[test]
    fn handles_are_checked_and_recycled() {
        assert_eq!(openrb303_create(44_100.0, 7), 0);
        assert_eq!(openrb303_create(-1.0, 1), 0);
        let a = openrb303_create(44_100.0, 1);
        let b = openrb303_create(48_000.0, 0);
        assert!(a != 0 && b != 0 && a != b);
        assert_eq!(openrb303_is_bit_exact(a), 1);
        assert_eq!(openrb303_is_bit_exact(b), 0);
        assert!(openrb303_buffer(0, 128).is_null());
        assert!(openrb303_buffer(999, 128).is_null());
        let p = openrb303_buffer(a, 128);
        assert!(!p.is_null());
        assert_eq!(
            openrb303_buffer(a, 64),
            p,
            "a smaller request keeps the buffer"
        );
        openrb303_note_on(a, 36, 127.0);
        openrb303_render(a, 128);
        openrb303_render(999, 128);
        openrb303_destroy(a);
        openrb303_note_on(a, 36, 127.0);
        assert_eq!(openrb303_create(44_100.0, 1), a, "the slot is reused");
        let mut all = vec![];
        loop {
            let h = openrb303_create(44_100.0, 1);
            if h == 0 {
                break;
            }
            all.push(h);
        }
        assert_eq!(all.len(), MAX_VOICES - 2);
        for h in all.into_iter().chain([a, b]) {
            openrb303_destroy(h);
        }
    }
}
