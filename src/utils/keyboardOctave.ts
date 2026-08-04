/**
 * Live keyboard octave shifting.
 *
 * The on-screen keyboard spans one octave plus the closing C (C..C of the
 * next octave). Keys are stored as semitone offsets from the base octave's
 * C so that a note name can be re-derived whenever the octave shifts.
 */

import { NOTES } from './musicTheory';

/** Lowest selectable base octave — the keyboard then starts at C1. */
export const MIN_KEYBOARD_OCTAVE = 1;
/** Highest selectable base octave — the keyboard then ends at C8 (MIDI 108). */
export const MAX_KEYBOARD_OCTAVE = 7;
/** Base octave the keyboard starts on (C5..C6), matching the original layout. */
export const DEFAULT_KEYBOARD_OCTAVE = 5;

export const KEYBOARD_OCTAVE_STORAGE_KEY = 'webSequencer.liveKeyboard.octave';

/** Clamp a base octave into the playable range. */
export function clampOctave(octave: number): number {
    if (!Number.isFinite(octave)) return DEFAULT_KEYBOARD_OCTAVE;
    return Math.max(MIN_KEYBOARD_OCTAVE, Math.min(MAX_KEYBOARD_OCTAVE, Math.round(octave)));
}

/**
 * Resolve a semitone offset from the base octave's C into a note name.
 * Offset 0 is C of `octave`; offset 12 is C of the next octave up.
 */
export function noteForOffset(semitoneOffset: number, octave: number): string {
    const base = clampOctave(octave);
    const absolute = base * 12 + semitoneOffset;
    const noteOctave = Math.floor(absolute / 12);
    const index = ((absolute % 12) + 12) % 12;
    return `${NOTES[index]}${noteOctave}`;
}

/** Read the persisted base octave, falling back to the default. */
export function loadStoredOctave(): number {
    try {
        const raw = globalThis.localStorage?.getItem(KEYBOARD_OCTAVE_STORAGE_KEY);
        if (raw === null || raw === undefined) return DEFAULT_KEYBOARD_OCTAVE;
        const parsed = Number.parseInt(raw, 10);
        if (Number.isNaN(parsed)) return DEFAULT_KEYBOARD_OCTAVE;
        return clampOctave(parsed);
    } catch {
        // Storage can be unavailable (private mode, blocked cookies) — not fatal.
        return DEFAULT_KEYBOARD_OCTAVE;
    }
}

/** Persist the base octave; failures are ignored. */
export function storeOctave(octave: number): void {
    try {
        globalThis.localStorage?.setItem(KEYBOARD_OCTAVE_STORAGE_KEY, String(clampOctave(octave)));
    } catch {
        // Ignore storage failures — the octave still applies for this session.
    }
}
