import { describe, it, expect } from 'vitest';
import {
    NOTES,
    noteToMidi,
    midiToNote,
    isNoteName,
    normalizeNoteName,
    tunedNoteToFrequency,
    SCALE_INTERVALS,
    SCALE_NAMES,
    getScaleNotes,
    isMidiInScale,
    nextScaleNote,
    applyMicrotonalTuning,
} from '../../utils/musicTheory';

describe('musicTheory - Scale utilities', () => {
    describe('SCALE_INTERVALS', () => {
        it('has expected scale definitions', () => {
            expect(SCALE_INTERVALS['Major']).toEqual([0, 2, 4, 5, 7, 9, 11]);
            expect(SCALE_INTERVALS['Minor']).toEqual([0, 2, 3, 5, 7, 8, 10]);
            expect(SCALE_INTERVALS['Dorian']).toEqual([0, 2, 3, 5, 7, 9, 10]);
            expect(SCALE_INTERVALS['Chromatic']).toHaveLength(12);
        });

        it('SCALE_NAMES matches keys of SCALE_INTERVALS', () => {
            expect(SCALE_NAMES).toEqual(Object.keys(SCALE_INTERVALS));
        });
    });

    describe('getScaleNotes', () => {
        it('returns correct notes for C Major', () => {
            const notes = getScaleNotes({ root: 'C', scale: 'Major' });
            expect(notes).toEqual(new Set(['C', 'D', 'E', 'F', 'G', 'A', 'B']));
        });

        it('returns correct notes for C Minor', () => {
            const notes = getScaleNotes({ root: 'C', scale: 'Minor' });
            expect(notes).toEqual(new Set(['C', 'D', 'D#', 'F', 'G', 'G#', 'A#']));
        });

        it('returns correct notes for G Dorian', () => {
            const notes = getScaleNotes({ root: 'G', scale: 'Dorian' });
            // G Dorian: G A A# C D E F
            expect(notes).toEqual(new Set(['G', 'A', 'A#', 'C', 'D', 'E', 'F']));
        });

        it('returns all notes for unknown scale', () => {
            const notes = getScaleNotes({ root: 'C', scale: 'Unknown' });
            expect(notes).toEqual(new Set(NOTES));
        });

        it('returns all notes for invalid root', () => {
            const notes = getScaleNotes({ root: 'X', scale: 'Major' });
            expect(notes).toEqual(new Set(NOTES));
        });

        it('returns all 12 notes for Chromatic scale', () => {
            const notes = getScaleNotes({ root: 'C', scale: 'Chromatic' });
            expect(notes.size).toBe(12);
        });
    });

    describe('isMidiInScale', () => {
        it('returns true for in-scale notes', () => {
            // C4 (MIDI 60) in C Major
            expect(isMidiInScale(60, { root: 'C', scale: 'Major' })).toBe(true);
            // E4 (MIDI 64) in C Major
            expect(isMidiInScale(64, { root: 'C', scale: 'Major' })).toBe(true);
        });

        it('returns false for out-of-scale notes', () => {
            // C#4 (MIDI 61) not in C Major
            expect(isMidiInScale(61, { root: 'C', scale: 'Major' })).toBe(false);
            // F#4 (MIDI 66) not in C Major
            expect(isMidiInScale(66, { root: 'C', scale: 'Major' })).toBe(false);
        });
    });

    describe('nextScaleNote', () => {
        const cMajor = { root: 'C', scale: 'Major' };

        it('finds the next scale note going up from C4', () => {
            // C4 = MIDI 60, next up in C Major = D4 = 62
            expect(nextScaleNote(60, 1, cMajor)).toBe(62);
        });

        it('finds the next scale note going down from D4', () => {
            // D4 = MIDI 62, next down in C Major = C4 = 60
            expect(nextScaleNote(62, -1, cMajor)).toBe(60);
        });

        it('skips non-scale notes', () => {
            // Starting at C#4 (61), going up should land on D4 (62)
            expect(nextScaleNote(61, 1, cMajor)).toBe(62);
            // Starting at C#4 (61), going down should land on C4 (60)
            expect(nextScaleNote(61, -1, cMajor)).toBe(60);
        });

        it('works across octave boundaries', () => {
            // B4 = MIDI 71, next up in C Major = C5 = 72
            expect(nextScaleNote(71, 1, cMajor)).toBe(72);
        });
    });

    describe('applyMicrotonalTuning', () => {
        it('returns standard midi for 12-TET', () => {
            expect(applyMicrotonalTuning(60, { root: 'C', scale: 'Major', tuning: '12-TET' })).toBe(60);
        });
        it('returns correct tuning for 24-TET around center', () => {
            expect(applyMicrotonalTuning(60, { root: 'C', scale: 'Major', tuning: '24-TET (Quarter)' })).toBe(60.0);
            expect(applyMicrotonalTuning(61, { root: 'C', scale: 'Major', tuning: '24-TET (Quarter)' })).toBe(60.5);
        });
    });

    describe('noteToMidi — note names', () => {
        it.each([
            // The flats the AI fixture uses (#1466): each used to parse as MIDI 0.
            ['Eb3', 51],
            ['Bb3', 58],
            ['Ab1', 32],
            ['Eb4', 63],
            ['Bb4', 70],
            ['Cb4', 59],
            ['F##3', 55],
            ['Fx3', 55],
            ['Ebb4', 62],
            ['C-1', 0],
            ['B9', 131],
            ['C4', 60],
            ['A4', 69],
            ['C#4', 61],
            ['B#3', 60],
            ['E#4', 65],
            ['Fb4', 64],
            ['D♭4', 61],
            ['F♯3', 54],
            ['G𝄪2', 45],
            ['B𝄫3', 57],
            [' Db5 ', 73],
        ])('%s → %i', (name, midi) => {
            expect(noteToMidi(name)).toBe(midi);
        });

        it('folds every spelling of a pitch to one number', () => {
            for (const group of [['Eb3', 'D#3', 'Fbb3'], ['Cb4', 'B3', 'Ax3'], ['F##3', 'Fx3', 'G3', 'Abb3']]) {
                const midis = group.map(noteToMidi);
                expect(new Set(midis).size, group.join(' / ')).toBe(1);
            }
        });

        it.each([
            'nope', '', 'H4', 'C', '4', 'c4', 'C10', 'C-2', 'C4.5', 'C#', 'Cb-1', 'B#9', 'C 4', 'C4x', 'Eb3 kick',
        ])('rejects %j with null, never 0', (name) => {
            expect(noteToMidi(name)).toBeNull();
            expect(isNoteName(name)).toBe(false);
        });

        it('rejects non-strings', () => {
            expect(noteToMidi(undefined)).toBeNull();
            expect(noteToMidi(null)).toBeNull();
        });

        it('only returns 0 for C-1', () => {
            expect(noteToMidi('C-1')).toBe(0);
            expect(noteToMidi('B#-2')).toBeNull();
        });

        it('round-trips through midiToNote as the sharp spelling', () => {
            for (let midi = 0; midi <= 131; midi++) {
                expect(noteToMidi(midiToNote(midi))).toBe(midi);
            }
            expect(normalizeNoteName('Eb3')).toBe('D#3');
            expect(normalizeNoteName('Fx3')).toBe('G3');
            expect(normalizeNoteName('C#4')).toBe('C#4');
            expect(normalizeNoteName('nope')).toBeNull();
        });
    });

    describe('tunedNoteToFrequency — flats and invalid names', () => {
        const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

        it.each([['Eb3', 51], ['Bb3', 58], ['Ab1', 32], ['Eb4', 63], ['Bb4', 70], ['Cb4', 59]])(
            '%s plays at MIDI %i, not 8 Hz',
            (name, midi) => {
                expect(tunedNoteToFrequency(name)).toBeCloseTo(hz(midi), 6);
            },
        );

        it('matches the sharp spelling under a microtonal tuning too', () => {
            const quarter = { root: 'C', scale: 'Chromatic', tuning: '24-TET (Quarter)' };
            expect(tunedNoteToFrequency('Db4', quarter)).toBeCloseTo(tunedNoteToFrequency('C#4', quarter)!, 9);
        });

        it('returns null for a name that does not parse', () => {
            expect(tunedNoteToFrequency('nope')).toBeNull();
            expect(tunedNoteToFrequency('')).toBeNull();
        });
    });

    describe('existing functions still work', () => {
        it('noteToMidi handles standard notes', () => {
            expect(noteToMidi('C4')).toBe(60);
            expect(noteToMidi('A4')).toBe(69);
        });

        it('midiToNote handles standard MIDI values', () => {
            expect(midiToNote(60)).toBe('C4');
            expect(midiToNote(69)).toBe('A4');
        });
    });
});
