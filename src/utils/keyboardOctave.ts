/**
 * Live keyboard octave shifting.
 *
 * The on-screen keyboard spans one octave plus the closing C (C..C of the
 * next octave). Keys are stored as semitone offsets from the base octave's
 * C so that a note name can be derived for whichever octave is current.
 *
 * The octave is runtime/UI state only — it is never written into the song
 * schema, so a shifted keyboard changes what you play, not what is saved.
 */

import { NOTES } from './musicTheory';

/** Semitone span of the on-screen keyboard: C..C inclusive. */
export const KEYBOARD_SPAN_SEMITONES = 12;

/** Base octave the keyboard rests on (C5..C6) — the center of the shift range. */
export const DEFAULT_KEYBOARD_OCTAVE = 5;

/** How far the octave control may shift from the center, in octaves. */
export const OCTAVE_SHIFT_RANGE = 3;

const MIDI_MIN = 0;
const MIDI_MAX = 127;

/**
 * MIDI note number for a semitone offset above the C of `octave`.
 * Unclamped — this is the raw arithmetic the bounds below are derived from.
 */
export function midiForOffset(semitoneOffset: number, octave: number): number {
    return (octave + 1) * 12 + semitoneOffset;
}

// The playable bounds are the intersection of two constraints: the +/-3
// shift range, and the octaves whose entire key span lands inside MIDI
// 0-127. Solving `midiForOffset` for `octave` at each end of the span gives
// the MIDI-safe window; taking the tighter of the two means a shift can
// never produce an out-of-range note, so clamping never has to wrap.
const MIDI_SAFE_MIN_OCTAVE = Math.ceil(MIDI_MIN / 12) - 1;
const MIDI_SAFE_MAX_OCTAVE = Math.floor((MIDI_MAX - KEYBOARD_SPAN_SEMITONES) / 12) - 1;

/** Lowest selectable base octave — the keyboard then starts at C2. */
export const MIN_KEYBOARD_OCTAVE = Math.max(
    DEFAULT_KEYBOARD_OCTAVE - OCTAVE_SHIFT_RANGE,
    MIDI_SAFE_MIN_OCTAVE,
);

/** Highest selectable base octave — the keyboard then ends at C9 (MIDI 120). */
export const MAX_KEYBOARD_OCTAVE = Math.min(
    DEFAULT_KEYBOARD_OCTAVE + OCTAVE_SHIFT_RANGE,
    MIDI_SAFE_MAX_OCTAVE,
);

export const KEYBOARD_OCTAVE_STORAGE_KEY = 'webSequencer.liveKeyboard.octave';

/** Clamp a base octave into the playable range. Saturates; never wraps. */
export function clampOctave(octave: number): number {
    if (!Number.isFinite(octave)) return DEFAULT_KEYBOARD_OCTAVE;
    return Math.max(MIN_KEYBOARD_OCTAVE, Math.min(MAX_KEYBOARD_OCTAVE, Math.round(octave)));
}

/** True when the octave cannot shift any further in `direction`. */
export function isOctaveAtEdge(octave: number, direction: -1 | 1): boolean {
    return direction < 0
        ? clampOctave(octave) <= MIN_KEYBOARD_OCTAVE
        : clampOctave(octave) >= MAX_KEYBOARD_OCTAVE;
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
