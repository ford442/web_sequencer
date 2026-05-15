import { describe, it, expect } from 'vitest';
import { noteToFrequency, tunedNoteToFrequency } from '../../src/constants';

describe('constants - note frequencies', () => {
    it('noteToFrequency returns expected values', () => {
        expect(noteToFrequency('A4')).toBe(440.00);
        expect(noteToFrequency('C4')).toBe(261.63);
    });

    describe('tunedNoteToFrequency', () => {
        it('returns standard frequency for 12-TET', () => {
            expect(tunedNoteToFrequency('A4', { root: 'C', scale: 'Major', tuning: '12-TET' })).toBeCloseTo(440.00, 1);
        });

        it('returns expected microtonal frequencies for 24-TET', () => {
            // A4 is 69. 69 - 60 (center) - 0 (root) = 9.
            // In 24-TET, index 9 is 4.5. 60 + 4.5 = 64.5
            // So A4 (69) actually maps down to 64.5.
            // Let's test with C4 (60). 60 maps to 60. So C4 = C4
            expect(tunedNoteToFrequency('C4', { root: 'C', scale: 'Major', tuning: '24-TET (Quarter)' })).toBeCloseTo(261.625, 1);

            // C#4 (61) maps to 60.5.
            // freq = 440 * 2^((60.5 - 69)/12)
            const expectedFreq = 440 * Math.pow(2, (60.5 - 69) / 12);
            expect(tunedNoteToFrequency('C#4', { root: 'C', scale: 'Major', tuning: '24-TET (Quarter)' })).toBeCloseTo(expectedFreq, 1);
        });
    });
});
