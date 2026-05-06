// @mode: typescript
// @note-for-ai: Simple utility functions - not a migration candidate.
// Low complexity, minimal performance impact. Keep in TypeScript.

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

// Scale interval definitions (semitone offsets from root)
export const SCALE_INTERVALS: Record<string, number[]> = {
    'Major':            [0, 2, 4, 5, 7, 9, 11],
    'Minor':            [0, 2, 3, 5, 7, 8, 10],
    'Dorian':           [0, 2, 3, 5, 7, 9, 10],
    'Phrygian':         [0, 1, 3, 5, 7, 8, 10],
    'Lydian':           [0, 2, 4, 6, 7, 9, 11],
    'Mixolydian':       [0, 2, 4, 5, 7, 9, 10],
    'Locrian':          [0, 1, 3, 5, 6, 8, 10],
    'Harmonic Minor':   [0, 2, 3, 5, 7, 8, 11],
    'Melodic Minor':    [0, 2, 3, 5, 7, 9, 11],
    'Pentatonic Major': [0, 2, 4, 7, 9],
    'Pentatonic Minor': [0, 3, 5, 7, 10],
    'Blues':             [0, 3, 5, 6, 7, 10],
    'Chromatic':        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

export const SCALE_NAMES = Object.keys(SCALE_INTERVALS);

export type TuningSystem = '12-TET' | '24-TET' | 'Just Intonation' | 'Pythagorean' | 'Bohlen-Pierce';
export const TUNING_SYSTEMS: TuningSystem[] = ['12-TET', '24-TET', 'Just Intonation', 'Pythagorean', 'Bohlen-Pierce'];

export interface ScaleDefinition {
    root: string;   // e.g., 'C', 'G#'
    scale: string;  // e.g., 'Minor', 'Dorian'
    tuningSystem?: TuningSystem;
}

/**
 * Returns the set of note names (e.g., ['C', 'D', 'Eb'...]) that belong to a given scale.
 * Returns a Set of chromatic note names (using sharps) that are in-scale.
 */
export const getScaleNotes = (definition: ScaleDefinition): Set<string> => {
    const rootIndex = NOTES.indexOf(definition.root);
    if (rootIndex === -1) return new Set(NOTES); // fallback: all notes
    const intervals = SCALE_INTERVALS[definition.scale];
    if (!intervals) return new Set(NOTES); // fallback: all notes (chromatic)

    const scaleNotes = new Set<string>();
    for (const interval of intervals) {
        scaleNotes.add(NOTES[(rootIndex + interval) % 12]);
    }
    return scaleNotes;
};

/**
 * Check if a MIDI note number is in the given scale.
 */
export const isMidiInScale = (midi: number, definition: ScaleDefinition): boolean => {
    const noteName = NOTES[midi % 12];
    return getScaleNotes(definition).has(noteName);
};

/**
 * Get the next MIDI note in the given scale, moving in the specified direction.
 * direction: 1 = up, -1 = down
 */
export const nextScaleNote = (midi: number, direction: 1 | -1, definition: ScaleDefinition): number => {
    const scaleNotes = getScaleNotes(definition);
    let next = midi + direction;
    // Search up to 12 semitones in the given direction for the next in-scale note
    for (let i = 0; i < 12; i++) {
        const noteName = NOTES[((next % 12) + 12) % 12];
        if (scaleNotes.has(noteName)) return next;
        next += direction;
    }
    return midi + direction; // fallback
};

export const getTunedFrequency = (note: string, tuning: TuningSystem = '12-TET', rootNote: string = 'C'): number => {
    if (!note) return 0;
    const midi = noteToMidi(note);

    if (tuning === '12-TET') {
        return 440 * Math.pow(2, (midi - 69) / 12);
    }

    if (tuning === '24-TET') {
        return 440 * Math.pow(2, (midi - 69) / 24);
    }

    // Common root calculation for other tuning systems
    const baseRootNote = rootNote.replace(/\d+$/, '');
    const rootMidi = noteToMidi(baseRootNote + '4'); // Use octave 4 for root reference
    const rootFreq = 440 * Math.pow(2, (rootMidi - 69) / 12);
    const distance = midi - rootMidi;

    if (tuning === 'Bohlen-Pierce') {
        // Bohlen-Pierce is based on a tritave (ratio 3) divided into 13 steps
        return rootFreq * Math.pow(3, distance / 13);
    }

    const octave = Math.floor(distance / 12);
    const semitone = ((distance % 12) + 12) % 12; // ensure positive

    if (tuning === 'Just Intonation') {
        const ratios = [1/1, 16/15, 9/8, 6/5, 5/4, 4/3, 45/32, 3/2, 8/5, 5/3, 9/5, 15/8];
        return rootFreq * ratios[semitone] * Math.pow(2, octave);
    }

    if (tuning === 'Pythagorean') {
        const ratios = [1/1, 256/243, 9/8, 32/27, 81/64, 4/3, 729/512, 3/2, 128/81, 27/16, 16/9, 243/128];
        return rootFreq * ratios[semitone] * Math.pow(2, octave);
    }

    return 440 * Math.pow(2, (midi - 69) / 12); // fallback
};
