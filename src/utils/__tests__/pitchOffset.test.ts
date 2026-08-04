import { describe, it, expect } from 'vitest';
import {
    getPitchOffsetSemitones,
    transposeMidi,
    transposeFrequency,
} from '../pitchOffset';

describe('pitchOffset', () => {
    it('reads the TUNE offset from params', () => {
        expect(getPitchOffsetSemitones({ pitch: 7 })).toBe(7);
        expect(getPitchOffsetSemitones({ pitch: -12 })).toBe(-12);
    });

    it('defaults to 0 for params without a usable pitch', () => {
        expect(getPitchOffsetSemitones({})).toBe(0);
        expect(getPitchOffsetSemitones(null)).toBe(0);
        expect(getPitchOffsetSemitones({ pitch: NaN })).toBe(0);
    });

    it('clamps to the knob range', () => {
        expect(getPitchOffsetSemitones({ pitch: 99 })).toBe(24);
        expect(getPitchOffsetSemitones({ pitch: -99 })).toBe(-24);
    });

    it('transposes MIDI by whole semitones', () => {
        expect(transposeMidi(60, 0)).toBe(60);
        expect(transposeMidi(60, 12)).toBe(72);
        expect(transposeMidi(60, -5)).toBe(55);
    });

    it('transposes frequency by equal temperament ratio', () => {
        expect(transposeFrequency(440, 0)).toBe(440);
        expect(transposeFrequency(440, 12)).toBeCloseTo(880, 6);
        expect(transposeFrequency(440, -12)).toBeCloseTo(220, 6);
        expect(transposeFrequency(440, 7)).toBeCloseTo(659.255, 2);
    });
});
