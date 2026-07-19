import { describe, expect, it } from 'vitest';
import {
    updateSamplerRange,
    updateSamplerStep,
    updateTrackRange,
    updateTrackStep,
} from '../patternUpdates';
import type { Note, Pattern } from '../../../types';

const makeNote = (overrides: Partial<Note> = {}): Note => ({
    note: 'C4',
    velocity: 1,
    ...overrides,
});

const makePattern = (): Pattern => ({
    partA: { steps: Array.from({ length: 4 }, () => makeNote()) },
    partB: { steps: Array.from({ length: 4 }, () => makeNote()) },
    bass2: { steps: Array.from({ length: 4 }, () => makeNote()) },
    kick: { steps: Array.from({ length: 4 }, () => makeNote()) },
    snare: { steps: Array.from({ length: 4 }, () => makeNote()) },
    closedHat: { steps: Array.from({ length: 4 }, () => makeNote()) },
    openHat: { steps: Array.from({ length: 4 }, () => makeNote()) },
    sampler: [
        { steps: Array.from({ length: 4 }, () => makeNote()) },
        { steps: Array.from({ length: 4 }, () => makeNote()) },
    ],
});

describe('updateTrackStep', () => {
    it('updates only the targeted step on the targeted track, leaving everything else untouched', () => {
        const prev = makePattern();
        const next = updateTrackStep(prev, 'partA', 1, (s) => ({ ...s, velocity: 0.5 }));

        expect(next.partA.steps[1]!.velocity).toBe(0.5);
        expect(next.partA.steps[0]!.velocity).toBe(1);
        expect(next.partA.steps[2]!.velocity).toBe(1);
        expect(next.partB).toBe(prev.partB);
        expect(next).not.toBe(prev);
    });

    it('is a no-op for the sampler track key (sampler steps are per-bank, not per-track)', () => {
        const prev = makePattern();
        const next = updateTrackStep(prev, 'sampler' as keyof Pattern, 0, (s) => ({ ...s, velocity: 0.1 }));
        expect(next).toBe(prev);
    });
});

describe('updateTrackRange', () => {
    it('applies the updater to every step within [low, high] inclusive on one track', () => {
        const prev = makePattern();
        const next = updateTrackRange(prev, 'kick', 1, 2, (s) => ({ ...s, velocity: 0.25 }));

        expect(next.kick.steps[0]!.velocity).toBe(1);
        expect(next.kick.steps[1]!.velocity).toBe(0.25);
        expect(next.kick.steps[2]!.velocity).toBe(0.25);
        expect(next.kick.steps[3]!.velocity).toBe(1);
    });
});

describe('updateSamplerStep', () => {
    it('updates a step within the targeted sampler bank only', () => {
        const prev = makePattern();
        const next = updateSamplerStep(prev, 1, 2, (s) => ({ ...s, note: 'D4' }));

        expect(next.sampler[1].steps[2]!.note).toBe('D4');
        expect(next.sampler[0]).toBe(prev.sampler[0]);
        expect(next.sampler[1].steps[0]!.note).toBe('C4');
    });
});

describe('updateSamplerRange', () => {
    it('applies the updater across a step range within the targeted bank only', () => {
        const prev = makePattern();
        const next = updateSamplerRange(prev, 0, 0, 1, (s) => ({ ...s, velocity: 0.75 }));

        expect(next.sampler[0].steps[0]!.velocity).toBe(0.75);
        expect(next.sampler[0].steps[1]!.velocity).toBe(0.75);
        expect(next.sampler[0].steps[2]!.velocity).toBe(1);
        expect(next.sampler[1]).toBe(prev.sampler[1]);
    });
});
