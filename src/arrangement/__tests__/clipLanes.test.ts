import { describe, expect, it } from 'vitest';
import { createArrangement, normalizeArrangement, placeClip, setClipLanes, updateClip } from '../model';
import { layerClipLanes } from '../playback';
import { normalizeClipLanes, shiftClipLanes } from '../clipLanes';
import {
    resolveLaneTimeline,
    resolveLaneValuesAtStep,
    resolveOpen303ParamSteps,
} from '@/audio/automation/laneResolver';
import type { Arrangement, ArrangementClip } from '@/types/song';
import type { UnifiedAutomationLane } from '@/types/automation';

/** Clip-local automation (#1494): model, layering, and one resolver for live and offline. */

function lane(points: Array<[number, number]>, parameter = 'filterCutoff', id = 'l1'): UnifiedAutomationLane {
    return {
        id,
        target: 'synthA',
        parameter,
        name: parameter,
        points: points.map(([step, value]) => ({ step, value })),
        interpolation: 'linear',
        source: 'manual',
        scope: 'song',
        enabled: true,
    };
}

function clip(partial: Partial<ArrangementClip> & Pick<ArrangementClip, 'id' | 'startStep' | 'lengthSteps'>): ArrangementClip {
    return { track: 'partA', patternSlot: 0, loop: true, ...partial };
}

/** A filter that opens across the clip's own 16 steps. */
const sweep = () => lane([[0, 0], [15, 0.75]]);

function stepsOf(arr: Arrangement, id: string): number[] | undefined {
    return arr.clips.find((c) => c.id === id)?.lanes?.[0].points.map((p) => p.step);
}

describe('clip lanes — model', () => {
    it('overlap trim keeps the surviving clip its own lanes; the winner keeps its lanes', () => {
        let arr = placeClip(createArrangement(32), clip({ id: 'a', startStep: 0, lengthSteps: 32, lanes: [sweep()] }));
        arr = placeClip(arr, clip({ id: 'b', startStep: 16, lengthSteps: 16, lanes: [lane([[0, 1]], 'filterResonance', 'l2')] }));
        const a = arr.clips.find((c) => c.id === 'a')!;
        expect(a.lengthSteps).toBe(16);
        expect(a.lanes).toEqual([sweep()]);
        expect(arr.clips.find((c) => c.id === 'b')!.lanes?.[0].parameter).toBe('filterResonance');
    });

    it('a split shifts the right half lanes so the automation stays on the song timeline', () => {
        let arr = placeClip(createArrangement(32), clip({ id: 'a', startStep: 0, lengthSteps: 32, lanes: [lane([[0, 0], [20, 1]])] }));
        arr = placeClip(arr, clip({ id: 'mid', startStep: 8, lengthSteps: 4 }));
        const tail = arr.clips.find((c) => c.track === 'partA' && c.startStep === 12)!;
        expect(tail.offsetSteps).toBe(12);
        expect(tail.lanes?.[0].points.map((p) => p.step)).toEqual([-12, 8]);
        expect(stepsOf(arr, 'a')).toEqual([0, 20]);
    });

    it('a head trim moves offsetSteps and the lane origin together; a move keeps local steps', () => {
        let arr = placeClip(createArrangement(32), clip({ id: 'a', startStep: 0, lengthSteps: 16, lanes: [sweep()] }));
        arr = updateClip(arr, 'a', { startStep: 4, lengthSteps: 12, offsetSteps: 4 });
        expect(stepsOf(arr, 'a')).toEqual([-4, 11]);
        arr = updateClip(arr, 'a', { startStep: 20 });
        expect(stepsOf(arr, 'a')).toEqual([-4, 11]);
    });

    it('setClipLanes is one arrangement value; an empty list drops the field', () => {
        const base = placeClip(createArrangement(16), clip({ id: 'a', startStep: 0, lengthSteps: 16 }));
        const withLane = setClipLanes(base, 'a', [sweep()]);
        expect(withLane).not.toBe(base);
        expect(withLane.clips[0].lanes).toHaveLength(1);
        expect('lanes' in setClipLanes(withLane, 'a', []).clips[0]).toBe(false);
    });

    it('shiftClipLanes leaves no lanes alone', () => {
        expect(shiftClipLanes(undefined, 4)).toBeUndefined();
    });
});

describe('clip lanes — persistence', () => {
    it('a v5 arrangement without clip lanes loads unchanged', () => {
        const raw = {
            clips: [{ id: 'clip-1', track: 'kick', patternSlot: 0, startStep: 0, lengthSteps: 16, loop: true }],
            lengthSteps: 32,
        };
        const arr = normalizeArrangement(JSON.parse(JSON.stringify(raw)))!;
        expect(arr).toEqual(raw);
        expect('lanes' in arr.clips[0]).toBe(false);
    });

    it('clip lanes survive a save/load round trip; malformed points are dropped and sorted', () => {
        const arr = placeClip(createArrangement(16), clip({ id: 'clip-1', startStep: 0, lengthSteps: 16, lanes: [sweep()] }));
        expect(normalizeArrangement(JSON.parse(JSON.stringify(arr)))).toEqual(arr);
        const lanes = normalizeClipLanes([
            { ...sweep(), points: [{ step: 8, value: 2 }, { step: 'x', value: 0 }, { step: 2, value: 0.5 }] },
            { id: 3 },
        ])!;
        expect(lanes).toHaveLength(1);
        expect(lanes[0].points).toEqual([{ step: 2, value: 0.5 }, { step: 8, value: 1 }]);
    });
});

describe('clip lanes — one resolver, live and offline', () => {
    // Two clips of the same pattern on partA; only the first carries a sweep.
    // A song lane holds the cutoff at 0.2 everywhere.
    const songLanes = [lane([[0, 0.2]], 'filterCutoff', 'song')];
    let arr = placeClip(createArrangement(48), clip({ id: 'a', startStep: 0, lengthSteps: 16, lanes: [sweep()] }));
    arr = placeClip(arr, clip({ id: 'b', startStep: 16, lengthSteps: 16 }));

    /** What the live scheduler resolves at song step `s` (pattern step `s % 16`). */
    const live = (s: number) =>
        resolveLaneValuesAtStep(layerClipLanes(songLanes, arr, s), s % 16, s)
            .find((r) => r.lane.parameter === 'filterCutoff')?.value;

    const offline = resolveOpen303ParamSteps(
        resolveLaneTimeline(songLanes, { totalSteps: 48, stepCount: 16, songMode: true, arrangement: arr }),
        'synthA',
    ).map((p) => p?.cutoff);

    it('the clip sweep plays across its own 16 steps; the second clip does not inherit it', () => {
        expect(live(0)).toBe(0);
        expect(live(5)).toBeCloseTo(0.25);
        expect(live(15)).toBeCloseTo(0.75);
        expect(live(16)).toBe(0.2);
        expect(live(31)).toBe(0.2);
        // Past the last clip the song lane still plays.
        expect(live(40)).toBe(0.2);
    });

    it('offline renders the same value as live at every step', () => {
        for (let s = 0; s < 48; s++) expect(offline[s]).toBe(live(s));
    });

    it('moving the clip moves the sweep with it', () => {
        const moved = updateClip(arr, 'a', { startStep: 32 });
        const at = (s: number) => resolveLaneValuesAtStep(layerClipLanes(songLanes, moved, s), s % 16, s)[0]?.value;
        expect(at(0)).toBe(0.2);
        expect(at(32)).toBe(0);
        expect(at(37)).toBeCloseTo(0.25);
    });

    it('returns the song lanes untouched when no sounding clip has lanes', () => {
        expect(layerClipLanes(songLanes, arr, 20)).toBe(songLanes);
        expect(layerClipLanes(songLanes, arr, undefined)).toBe(songLanes);
    });

    it('a disabled clip lane falls through to the song lane', () => {
        const off = setClipLanes(arr, 'a', [{ ...sweep(), enabled: false }]);
        expect(resolveLaneValuesAtStep(layerClipLanes(songLanes, off, 5), 5, 5)[0].value).toBe(0.2);
    });
});
