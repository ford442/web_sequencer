// @mode: typescript
// Simple utility functions for music theory and microtonal tuning

export const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const noteToMidi = (note: string): number => {
    if (!note) return 0;
    const match = note.match(/([A-G]#?)(\d+)/);
    if (!match) return 0;
    const noteName = match[1];
    const octave = parseInt(match[2], 10);
    const noteIndex = NOTES.indexOf(noteName);
    return (octave + 1) * 12 + noteIndex;
};

export const midiToNote = (midi: number): string => {
    const octave = Math.floor(midi / 12) - 1;
    const noteIndex = midi % 12;
    return `${NOTES[noteIndex]}${octave}`;
};

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
 */
export const tunedNoteToFrequency = (
    note: string,
    definition: ScaleDefinition | null = null
): number => {
    if (!note) return 440;

    const midi = noteToMidi(note);
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