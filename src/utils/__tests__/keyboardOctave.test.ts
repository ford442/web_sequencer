import { describe, it, expect, beforeEach } from 'vitest';
import {
    clampOctave,
    noteForOffset,
    loadStoredOctave,
    storeOctave,
    KEYBOARD_OCTAVE_STORAGE_KEY,
    DEFAULT_KEYBOARD_OCTAVE,
    MIN_KEYBOARD_OCTAVE,
    MAX_KEYBOARD_OCTAVE,
} from '../keyboardOctave';
import { noteToMidi } from '../musicTheory';

describe('keyboardOctave', () => {
    describe('clampOctave', () => {
        it('keeps in-range octaves', () => {
            expect(clampOctave(5)).toBe(5);
            expect(clampOctave(MIN_KEYBOARD_OCTAVE)).toBe(MIN_KEYBOARD_OCTAVE);
            expect(clampOctave(MAX_KEYBOARD_OCTAVE)).toBe(MAX_KEYBOARD_OCTAVE);
        });

        it('clamps beyond the playable range', () => {
            expect(clampOctave(-3)).toBe(MIN_KEYBOARD_OCTAVE);
            expect(clampOctave(99)).toBe(MAX_KEYBOARD_OCTAVE);
        });

        it('falls back to the default for non-finite input', () => {
            expect(clampOctave(NaN)).toBe(DEFAULT_KEYBOARD_OCTAVE);
        });
    });

    describe('noteForOffset', () => {
        it('reproduces the original C5-C6 layout at the default octave', () => {
            const white = [0, 2, 4, 5, 7, 9, 11, 12];
            expect(white.map(o => noteForOffset(o, 5)))
                .toEqual(['C5', 'D5', 'E5', 'F5', 'G5', 'A5', 'B5', 'C6']);
            const black = [1, 3, 6, 8, 10];
            expect(black.map(o => noteForOffset(o, 5)))
                .toEqual(['C#5', 'D#5', 'F#5', 'G#5', 'A#5']);
        });

        it('shifts every key with the octave', () => {
            expect(noteForOffset(0, 4)).toBe('C4');
            expect(noteForOffset(12, 4)).toBe('C5');
            expect(noteForOffset(10, 2)).toBe('A#2');
        });

        it('clamps the octave so notes stay in range', () => {
            expect(noteForOffset(0, 0)).toBe(`C${MIN_KEYBOARD_OCTAVE}`);
            expect(noteForOffset(12, 42)).toBe(`C${MAX_KEYBOARD_OCTAVE + 1}`);
        });

        it('produces notes the synth engines can resolve to valid MIDI', () => {
            for (let oct = MIN_KEYBOARD_OCTAVE; oct <= MAX_KEYBOARD_OCTAVE; oct++) {
                for (let offset = 0; offset <= 12; offset++) {
                    const midi = noteToMidi(noteForOffset(offset, oct));
                    expect(midi).toBeGreaterThanOrEqual(0);
                    expect(midi).toBeLessThanOrEqual(127);
                }
            }
        });
    });

    describe('persistence', () => {
        beforeEach(() => {
            localStorage.clear();
        });

        it('defaults when nothing is stored', () => {
            expect(loadStoredOctave()).toBe(DEFAULT_KEYBOARD_OCTAVE);
        });

        it('round-trips a stored octave', () => {
            storeOctave(3);
            expect(localStorage.getItem(KEYBOARD_OCTAVE_STORAGE_KEY)).toBe('3');
            expect(loadStoredOctave()).toBe(3);
        });

        it('clamps and ignores garbage values', () => {
            storeOctave(99);
            expect(loadStoredOctave()).toBe(MAX_KEYBOARD_OCTAVE);
            localStorage.setItem(KEYBOARD_OCTAVE_STORAGE_KEY, 'nonsense');
            expect(loadStoredOctave()).toBe(DEFAULT_KEYBOARD_OCTAVE);
        });
    });
});
