import { describe, it, expect } from 'vitest';
import { resolveSongTimeline, timelineDurationSeconds } from '../utils/songTimeline';
import { UPDATED_INITIAL_PATTERN } from '../constants/appDefaults';
import { getInitialTrackStorage } from '../constants/appDefaults';
import type { TrackKey } from '../constants/appDefaults';
import { createArrangement, placeClip, songStructureToArrangement } from '../arrangement/model';
import type { PartSequence } from '../types';

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

    describe('arrangement clips', () => {
        const hitsEvery4 = (): PartSequence => ({
            steps: Array.from({ length: 16 }, (_, i) => (i % 4 === 0 ? { note: 'C4', velocity: 1 } : null)),
        });
        const hits = (seq: PartSequence) => seq.steps.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);

        it('trims a clip: export length follows the clips and no notes play past the trim', () => {
            const storage = getInitialTrackStorage(UPDATED_INITIAL_PATTERN);
            storage.kick[0] = hitsEvery4();
            storage.snare[0] = hitsEvery4();
            let arr = createArrangement(64);
            arr = placeClip(arr, { id: 'k', track: 'kick', patternSlot: 0, startStep: 0, lengthSteps: 8, loop: true });
            const kickOnly = resolveSongTimeline([], storage, UPDATED_INITIAL_PATTERN, true, { stepCount: 16 }, arr);
            // The export stops at the last clip, not at the 64-step loop point.
            expect(kickOnly.totalSteps).toBe(8);
            expect(hits(kickOnly.sequences.kick)).toEqual([0, 4]);

            arr = placeClip(arr, { id: 's', track: 'snare', patternSlot: 0, startStep: 0, lengthSteps: 32, loop: true });
            const both = resolveSongTimeline([], storage, UPDATED_INITIAL_PATTERN, true, { stepCount: 16 }, arr);
            expect(both.totalSteps).toBe(32);
            expect(both.measureStepCounts).toEqual([16, 16]);
            expect(hits(both.sequences.kick)).toEqual([0, 4]);
            expect(hits(both.sequences.snare)).toEqual([0, 4, 8, 12, 16, 20, 24, 28]);
        });

        it('rests in gaps and after a one-shot clip, and keeps head-trim offsets', () => {
            const storage = getInitialTrackStorage(UPDATED_INITIAL_PATTERN);
            storage.kick[0] = hitsEvery4();
            let arr = createArrangement(16);
            arr = placeClip(arr, { id: 'a', track: 'kick', patternSlot: 0, startStep: 0, lengthSteps: 32, loop: false });
            arr = placeClip(arr, { id: 'b', track: 'kick', patternSlot: 0, startStep: 40, lengthSteps: 8, loop: true, offsetSteps: 4 });
            const t = resolveSongTimeline([], storage, UPDATED_INITIAL_PATTERN, true, { stepCount: 16 }, arr);
            expect(t.totalSteps).toBe(48);
            // One-shot: 0..15 only. Gap 32..39 silent. Offset 4: local 4 at song step 40.
            expect(hits(t.sequences.kick)).toEqual([0, 4, 8, 12, 40, 44]);
        });

        it('matches the Song Mode walk for a migrated v4 song', () => {
            const m = { partA: 0, partB: null, bass2: null, kick: 0, snare: null, closedHat: null, openHat: null, sampler: 0 };
            const structure = [m, m, m];
            const fromGrid = resolveSongTimeline(structure, trackStorage, UPDATED_INITIAL_PATTERN, true, { stepCount: 24 });
            const fromClips = resolveSongTimeline([], trackStorage, UPDATED_INITIAL_PATTERN, true, { stepCount: 24 },
                songStructureToArrangement(structure, 24));
            expect(fromClips).toEqual(fromGrid);
        });

        it('falls back to one pattern loop when the arrangement has no clips', () => {
            const t = resolveSongTimeline([], trackStorage, UPDATED_INITIAL_PATTERN, true, { stepCount: 16 }, createArrangement(128));
            expect(t.totalSteps).toBe(16);
            expect(t.measureCount).toBe(1);
        });
    });
});
