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

export interface ScaleDefinition {
    root: string;   // e.g., 'C', 'G#'
    scale: string;  // e.g., 'Minor', 'Dorian'
    tuning?: string; // Custom microtonal scale tuning
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


// Microtonal Tuning Systems (interval maps in semitones, can be non-integer for microtonal)
export const TUNING_SYSTEMS: Record<string, number[]> = {
    '12-TET': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    '24-TET (Quarter)': [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10, 10.5, 11, 11.5],
    'Just Intonation': [0, 1.117, 2.039, 3.156, 3.863, 4.980, 5.902, 7.020, 8.137, 8.844, 10.176, 10.883],
    'Pythagorean': [0, 0.902, 2.039, 2.941, 4.078, 4.980, 6.117, 7.020, 7.922, 9.059, 9.961, 11.098],
    'Bohlen-Pierce': [0, 1.463, 2.926, 4.389, 5.852, 7.315, 8.778, 10.241, 11.704, 13.167, 14.630, 16.093, 17.556], // 13 steps per tritave
    'Slendro (approx)': [0, 2.4, 4.8, 7.2, 9.6],
    'Pelog (approx)': [0, 1.2, 3.2, 7.2, 8.4]
};

export const TUNING_NAMES = Object.keys(TUNING_SYSTEMS);

/**
 * Apply microtonal tuning to a standard MIDI note.
 * Standard MIDI notes assume 12-TET (integers). This function maps an integer 12-TET MIDI note
 * to a fractional MIDI note based on the tuning system, preserving octaves for standard octave-repeating scales.
 */
export const applyMicrotonalTuning = (midiNote: number, definition?: ScaleDefinition | null): number => {
    if (!definition || !definition.tuning || definition.tuning === '12-TET') {
        return midiNote; // Default 12-TET
    }

    const intervals = TUNING_SYSTEMS[definition.tuning];
    if (!intervals || intervals.length === 0) {
        return midiNote;
    }

    // Root MIDI is assumed to be C (midi % 12 == 0) unless shifted.
    // For simplicity, we apply tuning relative to C as note index 0.
    const rootOffset = NOTES.indexOf(definition.root);
    const rootIndex = rootOffset === -1 ? 0 : rootOffset;

    // The scale index relative to the root (0 to 11)
    // Actually, mapping 12 standard piano keys to the tuning system:
    // If tuning has 12 notes (like Just, Pythagorean), map 1-to-1.
    // If tuning has more/fewer, we map based on chromatic steps.
    const relativeMidi = midiNote - rootIndex;
    let period = intervals.length > 0 ? intervals.length : 12;
    let tunedPeriod = 12;

    if (definition.tuning === 'Bohlen-Pierce') {
        period = 13;
        tunedPeriod = 19.01955;
    }

    // Center around MIDI 60 (C4) so middle notes stay in the same register
    const centerMidi = 60;
    const centeredRelative = midiNote - centerMidi - rootIndex;

    const cycle = Math.floor(centeredRelative / period);
    const stepInCycle = ((centeredRelative % period) + period) % period;
    const tunedStep = intervals[stepInCycle] || 0;

    return centerMidi + rootIndex + (cycle * tunedPeriod) + tunedStep;
};
