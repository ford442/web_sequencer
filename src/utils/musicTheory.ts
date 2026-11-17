// @mode: typescript
// Simple utility functions for music theory and microtonal tuning

export const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Semitone offset of each natural letter from C. */
const LETTER_SEMITONES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/**
 * Semitones each accidental spelling adds, keyed by the whole accidental the
 * grammar allows: one or two of the same sign, or one double-sign glyph.
 * (`x` / `𝄪` double sharp, `𝄫` double flat.) A lookup, not a loop, so parsing
 * a name allocates nothing beyond the regex match.
 */
const ACCIDENTAL_SEMITONES: Record<string, number> = {
    '#': 1, '##': 2, 'x': 2,
    '♯': 1, '♯♯': 2, '𝄪': 2,
    'b': -1, 'bb': -2,
    '♭': -1, '♭♭': -2, '𝄫': -2,
};

/**
 * The one note-name grammar: an uppercase letter, at most one accidental (a
 * single or doubled sign of one kind, or a double-sign glyph), then an octave
 * from -1 to 9. No flags and no whitespace, so the same source string is the
 * AI-song validator, its JSON Schema `pattern` and the co-producer tool
 * schema — a name the file formats call valid is a name this module parses.
 * It is valid with and without the `u` flag (ajv compiles patterns with it).
 *
 * The grammar cannot say that the sounding pitch must be 0..127 (`G#9` is
 * spelled fine and sounds above the MIDI range); {@link noteToMidi} adds that.
 */
export const NOTE_NAME_SOURCE = '^([A-G])(#{1,2}|x|b{1,2}|♯{1,2}|♭{1,2}|𝄪|𝄫)?(-1|[0-9])$';
export const NOTE_NAME_REGEX = new RegExp(NOTE_NAME_SOURCE, 'u');

/** Lowest and highest key number a name can sound: C-1 and G9 (a MIDI data byte). */
export const MIN_NOTE_MIDI = 0;
export const MAX_NOTE_MIDI = 127;

/**
 * Parse a scientific-pitch note name ("C4", "Eb3", "F##3", "Fx3", "C-1") to
 * its MIDI key number (C4 = 60). Sharps, flats and doubles (in ASCII or
 * Unicode) fold to the same number, so `noteToMidi('Eb3') === noteToMidi('D#3')`.
 * Surrounding whitespace is ignored; the letter must be uppercase.
 *
 * Returns `null` for anything that is not a note name, and for a spelling
 * whose pitch is outside C-1..G9 (`Cb-1`, `G#9`, `B9`) — rejected, never
 * clamped, because clamping would transpose the note without a word. It never
 * returns 0 for garbage: 0 means the name really was C-1. Callers decide what
 * an invalid name means for them (skip the note, report it) — it must not play.
 *
 * Hot path: one regex exec and table lookups, no other allocation. Boundary
 * code that wants the parts uses {@link parseNoteName}.
 */
export const noteToMidi = (note: string | null | undefined): number | null => {
    if (typeof note !== 'string') return null;
    const match = NOTE_NAME_REGEX.exec(note.trim());
    if (match === null) return null;
    const octave = match[3] === '-1' ? -1 : match[3].charCodeAt(0) - 48;
    const accidental = match[2];
    const midi = (octave + 1) * 12 + LETTER_SEMITONES[match[1]] + (accidental === undefined ? 0 : ACCIDENTAL_SEMITONES[accidental]);
    return midi >= MIN_NOTE_MIDI && midi <= MAX_NOTE_MIDI ? midi : null;
};

/** A note name taken apart. `octave` is that of the sounding pitch: `Cb4` is B3. */
export interface ParsedNoteName {
    /** 0 (C) .. 11 (B) of the sounding pitch. */
    pitchClass: number;
    /** -1..9, 4 for middle C. */
    octave: number;
    /** 0..127. */
    midi: number;
}

/**
 * {@link noteToMidi}, with the parts. For code that colours, labels or
 * reports a name; it allocates, so the per-step playback paths use
 * `noteToMidi` and only need a number.
 */
export const parseNoteName = (note: string | null | undefined): ParsedNoteName | null => {
    const midi = noteToMidi(note);
    return midi === null ? null : { pitchClass: midi % 12, octave: Math.floor(midi / 12) - 1, midi };
};

/**
 * One export-warning line for the names an exporter had to leave out, from
 * `name → how many steps carried it`; `null` when there were none. The caller
 * counts only non-blank names: a blank name is a rest, not a bad note.
 */
export const summarizeInvalidNoteNames = (counts: ReadonlyMap<string, number>): string | null => {
    let total = 0;
    for (const n of counts.values()) total += n;
    if (total === 0) return null;
    const shown: string[] = [];
    for (const [name, n] of counts) {
        if (shown.length === 5) {
            shown.push('…');
            break;
        }
        shown.push(`${JSON.stringify(name.length > 24 ? `${name.slice(0, 24)}…` : name)}${n > 1 ? ` ×${n}` : ''}`);
    }
    return `${total} ${total === 1 ? 'note was' : 'notes were'} left out because the name is not a note (${shown.join(', ')}).`;
};

/** True when `note` parses as a note name (see {@link noteToMidi}). */
export const isNoteName = (note: string | null | undefined): note is string => noteToMidi(note) !== null;

/** Respell a note name with sharps ("Eb3" → "D#3"); `null` when it does not parse. */
export const normalizeNoteName = (note: string | null | undefined): string | null => {
    const midi = noteToMidi(note);
    return midi === null ? null : midiToNote(midi);
};

export const midiToNote = (midi: number): string => {
    const octave = Math.floor(midi / 12) - 1;
    const noteIndex = midi % 12;
    return `${NOTES[noteIndex]}${octave}`;
};

// Hz <-> MIDI is defined once in ./math (a leaf module worklets can import).
export { midiToHz, hzToMidi } from './math';

// ==================== SCALES ====================

export const SCALE_INTERVALS: Record<string, number[]> = {
    'Major': [0, 2, 4, 5, 7, 9, 11],
    'Minor': [0, 2, 3, 5, 7, 8, 10],
    'Dorian': [0, 2, 3, 5, 7, 9, 10],
    'Phrygian': [0, 1, 3, 5, 7, 8, 10],
    'Lydian': [0, 2, 4, 6, 7, 9, 11],
    'Mixolydian': [0, 2, 4, 5, 7, 9, 10],
    'Locrian': [0, 1, 3, 5, 6, 8, 10],
    'Harmonic Minor': [0, 2, 3, 5, 7, 8, 11],
    'Melodic Minor': [0, 2, 3, 5, 7, 9, 11],
    'Pentatonic Major': [0, 2, 4, 7, 9],
    'Pentatonic Minor': [0, 3, 5, 7, 10],
    'Blues': [0, 3, 5, 6, 7, 10],
    'Chromatic': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

export const SCALE_NAMES = Object.keys(SCALE_INTERVALS);

export interface ScaleDefinition {
    root: string;           // e.g. "C", "G#"
    scale: string;          // e.g. "Minor", "Dorian"
    tuning?: string;        // e.g. "12-TET", "Just Intonation", "24-TET (Quarter)"
}

// ==================== TUNING SYSTEMS ====================

export const TUNING_SYSTEMS: Record<string, number[]> = {
    '12-TET': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    '24-TET (Quarter)': [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10, 10.5, 11, 11.5],
    'Just Intonation': [0, 1.117, 2.039, 3.156, 3.863, 4.980, 5.902, 7.020, 8.137, 8.844, 10.176, 10.883],
    'Pythagorean': [0, 0.902, 2.039, 2.941, 4.078, 4.980, 6.117, 7.020, 7.922, 9.059, 9.961, 11.098],
    'Bohlen-Pierce': [0, 1.463, 2.926, 4.389, 5.852, 7.315, 8.778, 10.241, 11.704, 13.167, 14.630, 16.093, 17.556],
    'Slendro (approx)': [0, 2.4, 4.8, 7.2, 9.6],
    'Pelog (approx)': [0, 1.2, 3.2, 7.2, 8.4],
};

export const TUNING_NAMES = Object.keys(TUNING_SYSTEMS);

/**
 * Convert a note + scale definition into a frequency (Hz) with microtonal support.
 * `null` when `note` is not a note name (see {@link noteToMidi}).
 */
export const tunedNoteToFrequency = (
    note: string,
    definition: ScaleDefinition | null = null
): number | null => {
    const midi = noteToMidi(note);
    if (midi === null) return null;
    if (!definition?.tuning || definition.tuning === '12-TET') {
        return 440 * Math.pow(2, (midi - 69) / 12);
    }

    const intervals = TUNING_SYSTEMS[definition.tuning];
    if (!intervals) {
        return 440 * Math.pow(2, (midi - 69) / 12); // fallback
    }

    const rootIndex = NOTES.indexOf(definition.root);
    const rootMidi = rootIndex !== -1 ? 60 + rootIndex : 60; // C4 base

    const relative = midi - rootMidi;
    const period = intervals.length;
    const cycle = Math.floor(relative / period);
    const step = ((relative % period) + period) % period;

    const tunedOffset = intervals[step] ?? 0;

    // For Bohlen-Pierce we use tritave (×3) instead of octave (×2)
    const ratio = definition.tuning === 'Bohlen-Pierce'
        ? Math.pow(3, tunedOffset / 13)
        : Math.pow(2, tunedOffset / 12);

    const rootFreq = 440 * Math.pow(2, (rootMidi - 69) / 12);

    return rootFreq * ratio * Math.pow(2, cycle);
};

/**
 * Apply microtonal tuning to a MIDI note number (returns fractional MIDI).
 * Useful for engines that expect a MIDI value (e.g. Web Audio, samplers).
 */
export const applyMicrotonalTuning = (
    midiNote: number,
    definition?: ScaleDefinition | null
): number => {
    if (!definition?.tuning || definition.tuning === '12-TET') {
        return midiNote;
    }

    const intervals = TUNING_SYSTEMS[definition.tuning];
    if (!intervals) return midiNote;

    const rootIndex = NOTES.indexOf(definition.root) ?? 0;
    const relative = midiNote - 60 - rootIndex; // center around C4

    const period = intervals.length;
    const cycle = Math.floor(relative / period);
    const step = ((relative % period) + period) % period;

    const tunedStep = intervals[step] ?? 0;

    return 60 + rootIndex + cycle * 12 + tunedStep;
};

// ==================== SCALE UTILITIES ====================

export const getScaleNotes = (definition: ScaleDefinition): Set<string> => {
    const rootIndex = NOTES.indexOf(definition.root);
    if (rootIndex === -1) return new Set(NOTES);

    const intervals = SCALE_INTERVALS[definition.scale];
    if (!intervals) return new Set(NOTES);

    const scaleNotes = new Set<string>();
    for (const interval of intervals) {
        scaleNotes.add(NOTES[(rootIndex + interval) % 12]);
    }
    return scaleNotes;
};

export const isMidiInScale = (midi: number, definition: ScaleDefinition): boolean => {
    const noteName = NOTES[midi % 12];
    return getScaleNotes(definition).has(noteName);
};

export const nextScaleNote = (
    midi: number,
    direction: 1 | -1,
    definition: ScaleDefinition
): number => {
    const scaleNotes = getScaleNotes(definition);
    let next = midi + direction;

    for (let i = 0; i < 12; i++) {
        const noteName = NOTES[((next % 12) + 12) % 12];
        if (scaleNotes.has(noteName)) return next;
        next += direction;
    }
    return midi + direction; // fallback
};

export type TuningSystem = keyof typeof TUNING_SYSTEMS;

export const getTunedFrequency = (note: string, tuningSystem: string, root: string): number | null => {
    const definition: ScaleDefinition = { root, scale: 'Chromatic', tuning: tuningSystem };
    return tunedNoteToFrequency(note, definition);
};
// ==================== METER ====================
//
// A Hyphon step is always a 16th note. The time-signature denominator decides
// how many 16ths make a bar, never how long a step is — so tick math
// (`ticksPerStep`) does not take the denominator.

export type TimeSignature = [number, number];

export const DEFAULT_TIME_SIGNATURE: TimeSignature = [4, 4];

const REPRESENTABLE_DENOMINATORS = new Set([2, 4, 8, 16]);

/** 16th-note steps in one bar, or `null` when the meter cannot sit on a 16th grid. */
export const stepsPerBar = (ts: TimeSignature): number | null => {
    const [num, den] = ts;
    if (!Number.isInteger(num) || num < 1 || num > 32) return null;
    if (!REPRESENTABLE_DENOMINATORS.has(den)) return null;
    return (num * 16) / den;
};

/** 16th-note steps per felt beat: 16/den, or a dotted quarter (6) for compound x/8. */
export const stepsPerBeat = (ts: TimeSignature): number => {
    const [num, den] = ts;
    if (den === 8 && num > 3 && num % 3 === 0) return 6;
    return REPRESENTABLE_DENOMINATORS.has(den) ? 16 / den : 4;
};

/** MIDI/SMF ticks per 16th-note step for a given pulses-per-quarter resolution. */
export const ticksPerStep = (ppq: number): number => ppq / 4;

/**
 * Song swing (MPC-style percent of the step pair given to the on-beat:
 * 50 = straight, 66.7 = triplet, 75 = hardest) → clock-processor swing (0–1,
 * where 1 is a 75/25 split). Values below 50 clamp to straight.
 */
export const swingPercentToClock = (percent: number): number => {
    if (!Number.isFinite(percent)) return 0;
    return Math.max(0, Math.min(1, (percent - 50) / 25));
};
