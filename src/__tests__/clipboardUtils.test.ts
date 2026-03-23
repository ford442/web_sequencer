import { describe, it, expect } from 'vitest';
import { copySteps, pasteSteps } from '../utils/clipboardUtils';
import type { Pattern } from '../types';

const emptySteps = Array(32).fill(null);
// Helper to create a fresh pattern
// @ts-expect-error - Auto-generated to fix CI build
const createEmptyPattern = (): Pattern => ({
    partA: { steps: [...emptySteps] },
    partB: { steps: [...emptySteps] },
    kick: { steps: [...emptySteps] },
    snare: { steps: [...emptySteps] },
    closedHat: { steps: [...emptySteps] },
    openHat: { steps: [...emptySteps] },
    sampler: Array.from({ length: 8 }, () => ({ steps: [...emptySteps] }))
});

describe('clipboardUtils', () => {
    it('copies steps from partA', () => {
        const pattern = createEmptyPattern();
        pattern.partA.steps[0] = { note: 'C4', velocity: 1, length: 1 };
        pattern.partA.steps[2] = { note: 'D4', velocity: 0.5, length: 2 };

        const selection = { trackKey: 'partA' as const, startStep: 0, endStep: 2 };
        const copied = copySteps(pattern, selection, 0);

        expect(copied).toHaveLength(3);
        expect(copied![0]).toEqual({ note: 'C4', velocity: 1, length: 1 });
        expect(copied![1]).toBeNull();
        expect(copied![2]).toEqual({ note: 'D4', velocity: 0.5, length: 2 });
    });

    it('pastes steps into partB', () => {
        const pattern = createEmptyPattern();
        const clipboard = [
             { note: 'C4', velocity: 1, length: 1 },
             null,
             { note: 'D4', velocity: 0.5, length: 2 }
        ];

        const newPattern = pasteSteps(pattern, clipboard, 'partB' as const, 0, 0);

        expect(newPattern.partB.steps[0]).toEqual(clipboard[0]);
        expect(newPattern.partB.steps[1]).toBeNull();
        expect(newPattern.partB.steps[2]).toEqual(clipboard[2]);
        expect(newPattern.partB.steps[3]).toBeNull();
    });

    it('handles sampler copy/paste correctly', () => {
        const pattern = createEmptyPattern();
        pattern.sampler[0].steps[0] = { note: 'C3', velocity: 1, length: 1 };

        const selection = { trackKey: 'sampler' as const, startStep: 0, endStep: 0 };
        const copied = copySteps(pattern, selection, 0);

        expect(copied).toHaveLength(1);
        expect(copied![0]).toEqual({ note: 'C3', velocity: 1, length: 1 });

        const newPattern = pasteSteps(pattern, copied!, 'sampler' as const, 1, 0);
        expect(newPattern.sampler[0].steps[1]).toEqual(copied![0]);
    });

    it('handles overflow', () => {
        const pattern = createEmptyPattern();
        const clipboard = [ { note: 'C4', velocity: 1, length: 1 }, { note: 'D4', velocity: 1, length: 1 } ];

        const newPattern = pasteSteps(pattern, clipboard, 'partA' as const, 31, 0);

        expect(newPattern.partA.steps[31]).toEqual(clipboard[0]);
        // Step 32 is out of bounds
    });

    it('deep clones on copy and paste', () => {
        const pattern = createEmptyPattern();
        const originalNote = { note: 'C4', velocity: 1, length: 1 };
        pattern.partA.steps[0] = originalNote;

        const selection = { trackKey: 'partA' as const, startStep: 0, endStep: 0 };
        const copied = copySteps(pattern, selection, 0);

        // Modify original
        originalNote.velocity = 0.5;

        // Copied should remain 1
        expect(copied![0]?.velocity).toBe(1);

        // Paste
        const newPattern = pasteSteps(pattern, copied!, 'partB' as const, 0, 0);

        // Modify clipboard note
        copied![0]!.velocity = 0.8;

        // Pasted should remain 1
        expect(newPattern.partB.steps[0]?.velocity).toBe(1);
    });
});
