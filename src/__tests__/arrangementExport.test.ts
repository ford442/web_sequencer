/**
 * XM and `.rbs` walk the arrangement timeline (#1494): a one-shot clip
 * shorter than its span, and a gap, export as rests — the same steps
 * `resolveArrangementTimeline` (live playback, stems, SMF) produces.
 */
import { describe, expect, it } from 'vitest';
import { createArrangement, placeClip, projectArrangement } from '../arrangement/model';
import { resolveArrangementTimeline } from '../utils/songTimeline';
import { buildXmSongPatterns, XM_TRACK_MAP } from '../utils/xmPatternFill';
import { RbsExporter, hyphonSongFromSavedData } from '../importers/rbs/RbsExporter';
import { RbsParser } from '../importers/rbs/RbsParser';
import { RbsImporter } from '../importers/rbs/RbsImporter';
import { buildSyntheticIffFile } from './rbs/fixtures';
import type { Arrangement, Note, PartSequence, SavedSongData } from '../types';
import type { TrackKey } from '../constants/appDefaults';

const hit = (): Note => ({ note: 'C2', velocity: 1 });
const seq = (hits: number[], length = 16): PartSequence => ({
    steps: Array.from({ length }, (_, i) => (hits.includes(i) ? hit() : null)),
});

function storage(): Record<TrackKey, (PartSequence | PartSequence[] | null)[]> {
    const ts = {} as Record<TrackKey, (PartSequence | PartSequence[] | null)[]>;
    for (const key of ['partA', 'partB', 'bass2', 'snare', 'closedHat', 'openHat'] as const) ts[key] = [seq([])];
    ts.kick = [seq([0, 4, 8, 12])];
    ts.sampler = [Array.from({ length: 8 }, () => seq([]))];
    return ts;
}

/**
 * Kick: a one-shot clip spanning two bars (the 16-step pattern, then a rest
 * tail), a one-bar gap, then a looping clip. 64 steps, 4 measures of 16.
 */
function song(): Arrangement {
    let arr = placeClip(createArrangement(64), { id: 'a', track: 'kick', patternSlot: 0, startStep: 0, lengthSteps: 32, loop: false });
    arr = placeClip(arr, { id: 'b', track: 'kick', patternSlot: 0, startStep: 48, lengthSteps: 16, loop: true });
    return arr;
}

const kickSteps = (steps: readonly (Note | null)[]) => steps.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);
const expected = () => kickSteps(resolveArrangementTimeline(song(), storage(), { stepCount: 16 }).sequences.kick.steps);

describe('arrangement export', () => {
    it('the Song Mode projection would have played the one-shot tail; the timeline rests', () => {
        // Projection: measure 1 is covered by clip "a", so it would replay the pattern.
        expect(projectArrangement(song(), 16)[1].kick).toBe(0);
        expect(expected()).toEqual([0, 4, 8, 12, 48, 52, 56, 60]);
    });

    it('XM walks the timeline: rests after the one-shot ends and in the gap', () => {
        const { patterns, patternOrderTable } = buildXmSongPatterns({
            songStructure: projectArrangement(song(), 16),
            trackStorage: storage(),
            stepCount: 16,
            arrangement: song(),
        });
        expect(patternOrderTable).toEqual([0, 1, 2, 3]);
        const chan = XM_TRACK_MAP.kick.chan;
        const rows = patterns.flatMap((p, m) => p.data.map((row, i) => (row[chan].note ? m * 16 + i : -1))).filter((i) => i >= 0);
        expect(rows).toEqual(expected());
    });

    it('.rbs bakes the timeline: rest bars select an empty pattern per device, and the file re-imports to the same hits', async () => {
        const arrangement = song();
        const source = await new RbsParser().parseBytes(buildSyntheticIffFile({ includeDevl: true, playMode: 0, trakEvents: [] }));
        if (!source.success) throw new Error('fixture did not parse');
        const { params } = new RbsImporter().convertToHyphonSong(source.data).song;
        const saved = {
            version: 5,
            pattern: { kick: seq([]), partA: seq([]), partB: seq([]), bass2: seq([]), snare: seq([]), closedHat: seq([]), openHat: seq([]), sampler: [] },
            tempo: 120,
            params,
            trackStorage: storage(),
            activeTrackSlots: {},
            songStructure: projectArrangement(arrangement, 16),
            arrangement,
            stepCount: 16,
        } as unknown as SavedSongData;

        const hs = hyphonSongFromSavedData(saved, { isSongModeActive: true });
        const structure = hs.songArrangement!.songStructure.map((m) => m.kick);
        expect(structure).toEqual([0, 1, 1, 0]);
        // Devices bake independently: LEAD has no clip, so it holds its one empty slot.
        expect(hs.songArrangement!.songStructure.map((m) => m.partA)).toEqual([0, 0, 0, 0]);
        expect(hs.songArrangement!.songStructure.map((m) => m.snare)).toEqual(structure);
        const kicks = hs.songArrangement!.trackStorage.kick;
        expect(kickSteps(kicks[0]!.steps)).toEqual([0, 4, 8, 12]);
        expect(kickSteps(kicks[1]!.steps)).toEqual([]);
        // Flattened back out, the baked song is the timeline.
        const flat = structure.flatMap((slot) => kicks[slot!]!.steps);
        expect(kickSteps(flat)).toEqual(expected());

        const { bytes } = new RbsExporter({ mode: 'song', drumKit: '808' }).exportToBytes(hs);
        const parsed = await new RbsParser().parseBytes(bytes);
        expect(parsed.success).toBe(true);
        if (!parsed.success) return;
        expect(parsed.data.songData?.glob.playMode).toBe(1);
        const reimported = new RbsImporter({ drumKitMapping: '808' }).convertToHyphonSong(parsed.data).song.songArrangement!;
        // The importer sizes a song by its last TRAK event (`ceil(tick / bar)`),
        // so the closing select on the last bar's first tick is not read back:
        // compare the bars it does read. The rest bars re-import as rests.
        const bars = reimported.songStructure.length;
        expect(bars).toBeGreaterThanOrEqual(3);
        const reFlat = reimported.songStructure
            .flatMap((m) => (reimported.trackStorage.kick[m.kick as number]?.steps ?? []).slice(0, 16));
        expect(kickSteps(reFlat)).toEqual(expected().filter((s) => s < bars * 16));
    });
});
