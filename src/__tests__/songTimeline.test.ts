import { describe, it, expect } from 'vitest';
import { resolveSongTimeline, timelineDurationSeconds } from '../utils/songTimeline';
import { UPDATED_INITIAL_PATTERN } from '../constants/appDefaults';
import { getInitialTrackStorage } from '../constants/appDefaults';
import type { TrackKey } from '../constants/appDefaults';

describe('songTimeline', () => {
    const trackStorage = getInitialTrackStorage(UPDATED_INITIAL_PATTERN);

    it('resolves a single-pattern timeline when song mode is disabled', () => {
        const timeline = resolveSongTimeline([], trackStorage, UPDATED_INITIAL_PATTERN, false);
        expect(timeline.measureCount).toBe(1);
        expect(timeline.totalSteps).toBe(32);
        expect(timeline.sequences.partA.steps.length).toBe(32);
        expect(timeline.sequences.sampler).toHaveLength(8);
    });

    it('concatenates measures from song arrangement', () => {
        const structure: { [key in TrackKey]: number | null }[] = [
            { partA: 0, partB: 0, bass2: 0, kick: 0, snare: 0, closedHat: 0, openHat: 0, sampler: 0 },
            { partA: 0, partB: 0, bass2: 0, kick: 0, snare: 0, closedHat: 0, openHat: 0, sampler: 0 },
        ];
        const timeline = resolveSongTimeline(structure, trackStorage, UPDATED_INITIAL_PATTERN, true);
        expect(timeline.measureCount).toBe(2);
        expect(timeline.totalSteps).toBe(64);
        expect(timeline.sequences.kick.steps.length).toBe(64);
    });

    it('sums per-measure step counts for a 24-step (3/4) song', () => {
        const measure = { partA: 0, partB: null, bass2: null, kick: 0, snare: null, closedHat: null, openHat: null, sampler: null };
        const structure: { [key in TrackKey]: number | null }[] = [measure, measure, measure];
        const timeline = resolveSongTimeline(structure, trackStorage, UPDATED_INITIAL_PATTERN, true, { stepCount: 24 });
        expect(timeline.measureCount).toBe(3);
        expect(timeline.measureStepCounts).toEqual([24, 24, 24]);
        expect(timeline.totalSteps).toBe(72);
        expect(timeline.sequences.kick.steps).toHaveLength(72);
        expect(timeline.sequences.sampler[0].steps).toHaveLength(72);
    });

    it('tiles a track loop into each measure, re-anchored per measure', () => {
        const hats = Array.from({ length: 32 }, (_, i) => (i === 0 ? { note: 'C4', velocity: 1 } : null));
        const storage = getInitialTrackStorage(UPDATED_INITIAL_PATTERN);
        storage.closedHat[0] = { steps: hats };
        const measure = { partA: null, partB: null, bass2: null, kick: null, snare: null, closedHat: 0, openHat: null, sampler: null };
        const timeline = resolveSongTimeline([measure, measure], storage, UPDATED_INITIAL_PATTERN, true, {
            stepCount: 16,
            trackLengths: { closedHat: 12 },
        });
        const hits = timeline.sequences.closedHat.steps
            .map((s, i) => (s ? i : -1))
            .filter((i) => i >= 0);
        // 12-step loop inside 16-step measures: 0, 12 | 16, 28.
        expect(hits).toEqual([0, 12, 16, 28]);
        expect(timeline.totalSteps).toBe(32);
    });

    it('computes timeline duration from tempo', () => {
        expect(timelineDurationSeconds(32, 120)).toBeCloseTo(4, 5);
    });
});
