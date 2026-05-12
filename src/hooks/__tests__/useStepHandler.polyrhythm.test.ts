import { describe, it, expect } from 'vitest';
import { getTrackStep } from '../useStepHandler';
import type { PartSequence } from '../../types';

describe('getTrackStep polyrhythm logic', () => {
    const makeSeq = (activeLength?: number): PartSequence => ({
        steps: Array(32).fill(null).map((_, i) => i === 0 ? { note: 'C4', velocity: 1, length: 1 } : null),
        activeLength,
    });

    it('defaults to NUM_STEPS (32) when activeLength is absent', () => {
        const seq = makeSeq();
        expect(getTrackStep(seq, 0)).toBe(0);
        expect(getTrackStep(seq, 15)).toBe(15);
        expect(getTrackStep(seq, 31)).toBe(31);
    });

    it('wraps correctly for activeLength = 16', () => {
        const seq = makeSeq(16);
        expect(getTrackStep(seq, 0)).toBe(0);
        expect(getTrackStep(seq, 15)).toBe(15);
        expect(getTrackStep(seq, 16)).toBe(0);
        expect(getTrackStep(seq, 31)).toBe(15);
        expect(getTrackStep(seq, 32)).toBe(0);
    });

    it('wraps correctly for activeLength = 7', () => {
        const seq = makeSeq(7);
        expect(getTrackStep(seq, 0)).toBe(0);
        expect(getTrackStep(seq, 6)).toBe(6);
        expect(getTrackStep(seq, 7)).toBe(0);
        expect(getTrackStep(seq, 13)).toBe(6);
        expect(getTrackStep(seq, 14)).toBe(0);
    });

    it('handles activeLength = 1 (all steps map to 0)', () => {
        const seq = makeSeq(1);
        expect(getTrackStep(seq, 0)).toBe(0);
        expect(getTrackStep(seq, 1)).toBe(0);
        expect(getTrackStep(seq, 31)).toBe(0);
    });

    it('reads the correct step data after modulo', () => {
        const seq: PartSequence = {
            steps: Array(32).fill(null).map((_, i) =>
                i === 5 ? { note: 'E4', velocity: 1, length: 1 } : null
            ),
            activeLength: 8,
        };
        // Global step 5 maps to step 5
        expect(getTrackStep(seq, 5)).toBe(5);
        expect(seq.steps[5]).not.toBeNull();
        // Global step 13 maps to step 5 again
        expect(getTrackStep(seq, 13)).toBe(5);
        expect(seq.steps[5]).not.toBeNull();
        // Global step 7 maps to step 7 (null)
        expect(getTrackStep(seq, 7)).toBe(7);
        expect(seq.steps[7]).toBeNull();
    });
});
