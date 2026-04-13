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
