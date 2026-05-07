import { describe, it, expect } from 'vitest';
import {
    NOTES,
    noteToMidi,
    midiToNote,
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
