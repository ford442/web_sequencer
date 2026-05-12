import { describe, it, expect } from 'vitest';
import { applyTrackLength } from '../useAppState';
import { getTrackStep } from '../useStepHandler';
import type { Pattern, PartSequence } from '../../types';
import { NUM_STEPS, MIN_TRACK_STEPS, MAX_TRACK_STEPS } from '../../constants';

describe('applyTrackLength reducer', () => {
    const makePattern = (): Pattern => ({
        partA: { steps: Array(NUM_STEPS).fill(null) },
        partB: { steps: Array(NUM_STEPS).fill(null) },
        bass2: { steps: Array(NUM_STEPS).fill(null) },
        kick: { steps: Array(NUM_STEPS).fill(null) },
        snare: { steps: Array(NUM_STEPS).fill(null) },
        closedHat: { steps: Array(NUM_STEPS).fill(null) },
        openHat: { steps: Array(NUM_STEPS).fill(null) },
        sampler: Array.from({ length: 8 }, () => ({ steps: Array(NUM_STEPS).fill(null) })),
    });

    it('sets activeLength on a single track', () => {
        const pattern = makePattern();
        const next = applyTrackLength(pattern, 'kick', 16);
        expect(next.kick.activeLength).toBe(16);
        expect(next.snare.activeLength).toBeUndefined();
    });

    it('clamps length to minimum (1)', () => {
        const pattern = makePattern();
        const next = applyTrackLength(pattern, 'partA', 0);
        expect(next.partA.activeLength).toBe(MIN_TRACK_STEPS);
    });

    it('clamps length to maximum (32)', () => {
        const pattern = makePattern();
        const next = applyTrackLength(pattern, 'partB', 50);
        expect(next.partB.activeLength).toBe(MAX_TRACK_STEPS);
    });

    it('sets activeLength on all sampler banks when track is "sampler"', () => {
        const pattern = makePattern();
        const next = applyTrackLength(pattern, 'sampler', 12);
        next.sampler.forEach((bank, i) => {
            expect(bank.activeLength, `bank ${i}`).toBe(12);
        });
    });

    it('sets activeLength on a specific sampler bank', () => {
        const pattern = makePattern();
        const next = applyTrackLength(pattern, { sampler: 3 }, 7);
        expect(next.sampler[3].activeLength).toBe(7);
        expect(next.sampler[0].activeLength).toBeUndefined();
        expect(next.sampler[7].activeLength).toBeUndefined();
    });

    it('does not mutate the original pattern', () => {
        const pattern = makePattern();
        const next = applyTrackLength(pattern, 'kick', 8);
        expect(pattern.kick.activeLength).toBeUndefined();
        expect(next.kick.activeLength).toBe(8);
        expect(next).not.toBe(pattern);
    });
});

describe('persistence via JSON round-trip', () => {
    it('preserves activeLength fields after JSON stringify/parse', () => {
        const pattern: Pattern = {
            partA: { steps: Array(NUM_STEPS).fill(null), activeLength: 7 },
            partB: { steps: Array(NUM_STEPS).fill(null), activeLength: 16 },
            bass2: { steps: Array(NUM_STEPS).fill(null) },
            kick: { steps: Array(NUM_STEPS).fill(null), activeLength: 1 },
            snare: { steps: Array(NUM_STEPS).fill(null), activeLength: 32 },
            closedHat: { steps: Array(NUM_STEPS).fill(null) },
            openHat: { steps: Array(NUM_STEPS).fill(null) },
            sampler: [
                { steps: Array(NUM_STEPS).fill(null), activeLength: 5 },
                ...Array.from({ length: 7 }, () => ({ steps: Array(NUM_STEPS).fill(null) })),
            ],
        };

        const json = JSON.stringify(pattern);
        const restored = JSON.parse(json) as Pattern;

        expect(restored.partA.activeLength).toBe(7);
        expect(restored.partB.activeLength).toBe(16);
        expect(restored.bass2.activeLength).toBeUndefined();
        expect(restored.kick.activeLength).toBe(1);
        expect(restored.snare.activeLength).toBe(32);
        expect(restored.sampler[0].activeLength).toBe(5);
        expect(restored.sampler[1].activeLength).toBeUndefined();
    });
});

describe('getTrackStep with activeLength edge cases', () => {
    it('falls back to steps.length when activeLength is absent', () => {
        const seq: PartSequence = { steps: Array(32).fill(null) };
        expect(getTrackStep(seq, 31)).toBe(31);
        expect(getTrackStep(seq, 32)).toBe(0);
    });

    it('uses activeLength when present even if larger than steps.length (defensive)', () => {
        const seq: PartSequence = { steps: Array(16).fill(null), activeLength: 8 };
        expect(getTrackStep(seq, 7)).toBe(7);
        expect(getTrackStep(seq, 8)).toBe(0);
    });
});
