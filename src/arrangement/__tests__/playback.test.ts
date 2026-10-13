import { describe, expect, it } from 'vitest';
import { createArrangement, placeClip } from '../model';
import { clipAt, clipLocalStep, createArrangementFrame, resolveArrangementFrame } from '../playback';
import type { ArrangementClip } from '@/types/song';

function clip(partial: Partial<ArrangementClip> & Pick<ArrangementClip, 'id' | 'startStep' | 'lengthSteps'>): ArrangementClip {
    return { track: 'kick', patternSlot: 0, loop: true, ...partial };
}

describe('clipLocalStep', () => {
    it('loops the pattern at its loop length', () => {
        const c = clip({ id: 'a', startStep: 32, lengthSteps: 64 });
        expect([32, 47, 48, 95].map((p) => clipLocalStep(c, p, 16))).toEqual([0, 15, 0, 15]);
    });

    it('plays a one-shot clip once, then rests', () => {
        const c = clip({ id: 'a', startStep: 0, lengthSteps: 64, loop: false });
        expect(clipLocalStep(c, 15, 16)).toBe(15);
        expect(clipLocalStep(c, 16, 16)).toBe(-1);
    });

    it('honours the head-trim offset', () => {
        const c = clip({ id: 'a', startStep: 4, lengthSteps: 12, offsetSteps: 4 });
        expect(clipLocalStep(c, 4, 16)).toBe(4);
        expect(clipLocalStep(c, 15, 16)).toBe(15);
    });
});

describe('clipAt / resolveArrangementFrame', () => {
    let arr = createArrangement(64);
    arr = placeClip(arr, clip({ id: 'k1', startStep: 0, lengthSteps: 8, patternSlot: 2 }));
    arr = placeClip(arr, clip({ id: 'k2', startStep: 16, lengthSteps: 16, patternSlot: 3 }));
    arr = placeClip(arr, clip({ id: 's1', track: 'snare', startStep: 0, lengthSteps: 64, patternSlot: 1 }));

    it('finds the clip under a step and leaves gaps empty', () => {
        expect(clipAt(arr, 'kick', 0)?.id).toBe('k1');
        expect(clipAt(arr, 'kick', 7)?.id).toBe('k1');
        expect(clipAt(arr, 'kick', 8)).toBeNull();
        expect(clipAt(arr, 'kick', 16)?.id).toBe('k2');
        expect(clipAt(arr, 'kick', 32)).toBeNull();
        expect(clipAt(arr, 'partA', 0)).toBeNull();
    });

    it('resolves every track at a step into a reused frame', () => {
        const frame = createArrangementFrame();
        const meter = { stepCount: 16, trackLengths: { snare: 12 } };
        resolveArrangementFrame(frame, arr, 20, meter);
        expect(frame.kick).toEqual({ slot: 3, step: 4 });
        expect(frame.snare).toEqual({ slot: 1, step: 8 });
        expect(frame.partA).toEqual({ slot: null, step: -1 });
        const same = resolveArrangementFrame(frame, arr, 10, meter);
        expect(same).toBe(frame);
        expect(frame.kick).toEqual({ slot: null, step: -1 });
    });
});
