import { describe, it, expect, beforeEach } from 'vitest';
import {
    clampOctave,
    isOctaveAtEdge,
    midiForOffset,
    noteForOffset,
    loadStoredOctave,
    storeOctave,
    KEYBOARD_OCTAVE_STORAGE_KEY,
    DEFAULT_KEYBOARD_OCTAVE,
    MIN_KEYBOARD_OCTAVE,
    MAX_KEYBOARD_OCTAVE,
    OCTAVE_SHIFT_RANGE,
    KEYBOARD_SPAN_SEMITONES,
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

    describe('shift range', () => {
        it('spans exactly -3..+3 octaves around the center', () => {
            expect(OCTAVE_SHIFT_RANGE).toBe(3);
            expect(MIN_KEYBOARD_OCTAVE).toBe(DEFAULT_KEYBOARD_OCTAVE - OCTAVE_SHIFT_RANGE);
            expect(MAX_KEYBOARD_OCTAVE).toBe(DEFAULT_KEYBOARD_OCTAVE + OCTAVE_SHIFT_RANGE);
        });

        it('saturates at each edge instead of wrapping', () => {
            // Repeated shifts past an edge must stay pinned to that edge, never
            // reappear at the opposite one.
            let octave = DEFAULT_KEYBOARD_OCTAVE;
            for (let i = 0; i < 20; i++) octave = clampOctave(octave - 1);
            expect(octave).toBe(MIN_KEYBOARD_OCTAVE);

            for (let i = 0; i < 40; i++) octave = clampOctave(octave + 1);
            expect(octave).toBe(MAX_KEYBOARD_OCTAVE);
        });

        it('reports both edges for disabling the controls', () => {
            expect(isOctaveAtEdge(MIN_KEYBOARD_OCTAVE, -1)).toBe(true);
            expect(isOctaveAtEdge(MIN_KEYBOARD_OCTAVE, 1)).toBe(false);
            expect(isOctaveAtEdge(MAX_KEYBOARD_OCTAVE, 1)).toBe(true);
            expect(isOctaveAtEdge(MAX_KEYBOARD_OCTAVE, -1)).toBe(false);
            expect(isOctaveAtEdge(DEFAULT_KEYBOARD_OCTAVE, -1)).toBe(false);
            expect(isOctaveAtEdge(DEFAULT_KEYBOARD_OCTAVE, 1)).toBe(false);
        });
    });

    describe('MIDI 0-127 boundary', () => {
        it('keeps every key of every reachable octave inside the MIDI range', () => {
            for (let oct = MIN_KEYBOARD_OCTAVE; oct <= MAX_KEYBOARD_OCTAVE; oct++) {
                for (let offset = 0; offset <= KEYBOARD_SPAN_SEMITONES; offset++) {
                    const midi = midiForOffset(offset, oct);
                    expect(midi).toBeGreaterThanOrEqual(0);
                    expect(midi).toBeLessThanOrEqual(127);
                }
            }
        });

        it('agrees with noteToMidi on the resolved note name', () => {
            for (let oct = MIN_KEYBOARD_OCTAVE; oct <= MAX_KEYBOARD_OCTAVE; oct++) {
                for (let offset = 0; offset <= KEYBOARD_SPAN_SEMITONES; offset++) {
                    expect(noteToMidi(noteForOffset(offset, oct))).toBe(midiForOffset(offset, oct));
                }
            }
        });

        it('stops one octave short of where the top key would exceed 127', () => {
            // At the current center the +/-3 window and the MIDI ceiling agree
            // on 8; one octave higher would put the closing C at 132.
            expect(midiForOffset(KEYBOARD_SPAN_SEMITONES, MAX_KEYBOARD_OCTAVE)).toBeLessThanOrEqual(127);
            expect(midiForOffset(KEYBOARD_SPAN_SEMITONES, MAX_KEYBOARD_OCTAVE + 1)).toBeGreaterThan(127);
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
