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

    it('computes timeline duration from tempo', () => {
        expect(timelineDurationSeconds(32, 120)).toBeCloseTo(4, 5);
    });
});
