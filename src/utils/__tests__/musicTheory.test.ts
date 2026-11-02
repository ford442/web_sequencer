import { describe, it, expect } from 'vitest';
import {
    NOTES,
    noteToMidi,
    midiToNote,
    isNoteName,
    normalizeNoteName,
    parseNoteName,
    NOTE_NAME_SOURCE,
    NOTE_NAME_REGEX,
    MIN_NOTE_MIDI,
    MAX_NOTE_MIDI,
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
            ['G9', 127],
            ['F#9', 126],
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
            'nope', '', 'H4', 'C', '4', 'c4', 'bb3', 'C10', 'C-2', 'C4.5', 'C#', 'Cb-1', 'C 4', 'C4x', 'Eb3 kick',
            // Above G9: spelled fine, sounds outside the MIDI range. Rejected, not clamped.
            'G#9', 'Ab9', 'A9', 'B9', 'B#9',
            // More than one accidental, or two kinds: not a note name.
            'C#b4', 'Cb#4', 'C###4', 'Cbbb4', 'E##########4', 'Cx#4', 'C𝄪𝄪4', 'C♯♭4', 'C#♯4',
            // Case: the letter is uppercase, an accidental `b` is lowercase.
            'EB3', 'eb3',
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
            for (let midi = MIN_NOTE_MIDI; midi <= MAX_NOTE_MIDI; midi++) {
                expect(noteToMidi(midiToNote(midi))).toBe(midi);
            }
            expect(normalizeNoteName('Eb3')).toBe('D#3');
            expect(normalizeNoteName('Fx3')).toBe('G3');
            expect(normalizeNoteName('C#4')).toBe('C#4');
            expect(normalizeNoteName('nope')).toBeNull();
        });
    });

    describe('parseNoteName', () => {
        it.each([
            // name, pitchClass, octave of the sounding pitch, midi
            ['C4', 0, 4, 60],
            ['Cb4', 11, 3, 59],   // spelled octave 4, sounds in octave 3
            ['B#3', 0, 4, 60],    // spelled octave 3, sounds in octave 4
            ['Eb3', 3, 3, 51],
            ['F##3', 7, 3, 55],
            ['C-1', 0, -1, 0],
            ['G9', 7, 9, 127],
        ])('%s → pitchClass %i, octave %i, midi %i', (name, pitchClass, octave, midi) => {
            expect(parseNoteName(name)).toEqual({ pitchClass, octave, midi });
        });

        it('agrees with noteToMidi on every name, and is null exactly when it is', () => {
            for (const name of ['Eb3', 'Bb4', 'nope', '', 'G#9', 'c4', ' A4 ']) {
                expect(parseNoteName(name)?.midi ?? null).toBe(noteToMidi(name));
            }
            expect(parseNoteName(undefined)).toBeNull();
            expect(parseNoteName(null)).toBeNull();
        });
    });

    describe('the grammar', () => {
        // An oracle that shares no code with the parser: every spelling the
        // grammar names, its pitch worked out by hand.
        const LETTERS: Array<[string, number]> = [['C', 0], ['D', 2], ['E', 4], ['F', 5], ['G', 7], ['A', 9], ['B', 11]];
        const ACCIDENTALS: Array<[string, number]> = [
            ['', 0],
            ['#', 1], ['##', 2], ['x', 2], ['♯', 1], ['♯♯', 2], ['𝄪', 2],
            ['b', -1], ['bb', -2], ['♭', -1], ['♭♭', -2], ['𝄫', -2],
        ];
        const OCTAVES = [-1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

        it('every spelling parses to its hand-computed pitch, or null outside 0..127', () => {
            let spelled = 0;
            let sounded = 0;
            for (const [letter, base] of LETTERS) {
                for (const [accidental, shift] of ACCIDENTALS) {
                    for (const octave of OCTAVES) {
                        const name = `${letter}${accidental}${octave}`;
                        const expected = (octave + 1) * 12 + base + shift;
                        const inRange = expected >= 0 && expected <= 127;
                        spelled++;
                        if (inRange) sounded++;
                        expect(noteToMidi(name), name).toBe(inRange ? expected : null);
                        // The pattern alone accepts every spelling; the range is the parser's.
                        expect(NOTE_NAME_REGEX.test(name), name).toBe(true);
                    }
                }
            }
            expect(spelled).toBe(7 * 12 * 11);
            expect(sounded).toBeGreaterThan(0);
        });

        it('the source is one string that means the same with and without the u flag', () => {
            const plain = new RegExp(NOTE_NAME_SOURCE);
            for (const letter of ['A', 'C', 'G', 'H', 'c']) {
                for (const accidental of ['', '#', '##', '###', 'x', 'b', 'bb', 'bbb', '♯', '♭', '𝄪', '𝄫', '𝄪𝄪', '#b', 'xx']) {
                    for (const octave of ['-2', '-1', '0', '9', '10', '']) {
                        const name = `${letter}${accidental}${octave}`;
                        expect(plain.test(name), name).toBe(NOTE_NAME_REGEX.test(name));
                    }
                }
            }
        });

        it('has no whitespace tolerance of its own: the parser trims, the pattern does not', () => {
            expect(NOTE_NAME_REGEX.test(' Eb3')).toBe(false);
            expect(noteToMidi(' Eb3 ')).toBe(51);
        });

        it('exposes the MIDI range it enforces', () => {
            expect(MIN_NOTE_MIDI).toBe(0);
            expect(MAX_NOTE_MIDI).toBe(127);
            expect(noteToMidi(midiToNote(MAX_NOTE_MIDI))).toBe(127);
            expect(noteToMidi(midiToNote(MAX_NOTE_MIDI + 1))).toBeNull(); // G#9
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
