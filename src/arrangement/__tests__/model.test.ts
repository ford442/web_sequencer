import { describe, expect, it } from 'vitest';
import {
    addClip,
    arrangementEnd,
    createArrangement,
    liftStructureEdit,
    normalizeArrangement,
    placeClip,
    projectArrangement,
    removeClip,
    setArrangementLength,
    songStructureToArrangement,
    updateClip,
} from '../model';
import { createEmptyMeasure } from '@/utils/songModeEditing';
import type { Arrangement, ArrangementClip } from '@/types/song';
import type { SongMeasure } from '@/types/songMode';

function measure(cells: Partial<SongMeasure>): SongMeasure {
    return { ...createEmptyMeasure(), ...cells };
}

function clip(partial: Partial<ArrangementClip> & Pick<ArrangementClip, 'id' | 'startStep' | 'lengthSteps'>): ArrangementClip {
    return { track: 'kick', patternSlot: 0, loop: true, ...partial };
}

function kickSpans(arr: Arrangement): Array<[number, number, number]> {
    return arr.clips
        .filter((c) => c.track === 'kick')
        .map((c) => [c.startStep, c.lengthSteps, c.offsetSteps ?? 0]);
}

describe('songStructureToArrangement (v1–v4 migration)', () => {
    it('makes one measure-long clip per occupied cell and keeps the measure count', () => {
        const structure = [measure({ kick: 0, partA: 3 }), measure({}), measure({ kick: 1 })];
        const arr = songStructureToArrangement(structure, 32);
        expect(arr.lengthSteps).toBe(96);
        expect(arr.clips.map((c) => [c.track, c.patternSlot, c.startStep, c.lengthSteps, c.loop])).toEqual([
            ['partA', 3, 0, 32, true],
            ['kick', 0, 0, 32, true],
            ['kick', 1, 64, 32, true],
        ]);
        expect(new Set(arr.clips.map((c) => c.id)).size).toBe(3);
    });

    it('uses the song meter for the clip length, not 32', () => {
        const arr = songStructureToArrangement([measure({ kick: 0 }), measure({ kick: 0 })], 24);
        expect(kickSpans(arr)).toEqual([[0, 24, 0], [24, 24, 0]]);
        expect(arr.lengthSteps).toBe(48);
    });

    it('ignores out-of-range or non-integer slots', () => {
        const arr = songStructureToArrangement([{ kick: 99, snare: 1.5, partA: -1 } as never], 16);
        expect(arr.clips).toEqual([]);
    });
});

describe('projectArrangement', () => {
    it('round-trips a grid-aligned arrangement', () => {
        const structure = [measure({ kick: 0, snare: 2 }), measure({ kick: 1 }), measure({})];
        const arr = songStructureToArrangement(structure, 16);
        expect(projectArrangement(arr, 16)).toEqual(structure);
    });

    it('shows the clip covering most of a measure', () => {
        let arr = createArrangement(32);
        arr = placeClip(arr, clip({ id: 'a', patternSlot: 0, startStep: 0, lengthSteps: 4 }));
        arr = placeClip(arr, clip({ id: 'b', patternSlot: 5, startStep: 4, lengthSteps: 28 }));
        const [m0, m1] = projectArrangement(arr, 16);
        expect(m0.kick).toBe(5);
        expect(m1.kick).toBe(5);
    });

    it('re-projects at a new measure length', () => {
        const arr = songStructureToArrangement([measure({ kick: 0 })], 32);
        expect(projectArrangement(arr, 16).map((m) => m.kick)).toEqual([0, 0]);
    });
});

describe('placeClip overlap rules', () => {
    const base = placeClip(createArrangement(64), clip({ id: 'clip-1', startStep: 0, lengthSteps: 64 }));

    it('splits a clip a new one lands inside, keeping the right half in phase', () => {
        const arr = placeClip(base, clip({ id: 'new', patternSlot: 2, startStep: 16, lengthSteps: 8 }));
        expect(kickSpans(arr)).toEqual([[0, 16, 0], [16, 8, 0], [24, 40, 24]]);
        expect(new Set(arr.clips.map((c) => c.id)).size).toBe(3);
    });

    it('removes a clip that is fully covered', () => {
        const small = placeClip(createArrangement(32), clip({ id: 'x', startStep: 8, lengthSteps: 4 }));
        const arr = placeClip(small, clip({ id: 'y', startStep: 0, lengthSteps: 32 }));
        expect(arr.clips.map((c) => c.id)).toEqual(['y']);
    });

    it('never touches other tracks', () => {
        const arr = placeClip(base, clip({ id: 's', track: 'snare', startStep: 0, lengthSteps: 64 }));
        expect(kickSpans(arr)).toEqual([[0, 64, 0]]);
    });

    it('grows the loop point to fit', () => {
        const arr = placeClip(base, clip({ id: 'z', startStep: 96, lengthSteps: 16 }));
        expect(arrangementEnd(arr)).toBe(112);
    });
});

describe('clip edits', () => {
    it('adds with a fresh id, updates, and removes', () => {
        const { arrangement, id } = addClip(createArrangement(32), {
            track: 'kick', patternSlot: 1, startStep: 0, lengthSteps: 16, loop: true,
        });
        expect(id).toBe('clip-1');
        const trimmed = updateClip(arrangement, id, { lengthSteps: 8 });
        expect(kickSpans(trimmed)).toEqual([[0, 8, 0]]);
        expect(removeClip(trimmed, id).clips).toEqual([]);
    });

    it('clamps the loop point to the last clip', () => {
        const arr = placeClip(createArrangement(64), clip({ id: 'a', startStep: 0, lengthSteps: 40 }));
        expect(setArrangementLength(arr, 16).lengthSteps).toBe(40);
        expect(setArrangementLength(arr, 80).lengthSteps).toBe(80);
    });
});

describe('liftStructureEdit', () => {
    it('applies a Song Mode cell edit without disturbing trimmed clips elsewhere', () => {
        let arr = songStructureToArrangement([measure({ kick: 0 }), measure({ snare: 1 })], 16);
        const kickId = arr.clips.find((c) => c.track === 'kick')!.id;
        arr = updateClip(arr, kickId, { lengthSteps: 6 });
        const before = projectArrangement(arr, 16);
        const after = before.map((m) => ({ ...m }));
        after[1].snare = 3;
        const lifted = liftStructureEdit(arr, before, after, 16);
        expect(kickSpans(lifted)).toEqual([[0, 6, 0]]);
        expect(lifted.clips.find((c) => c.track === 'snare')).toMatchObject({ patternSlot: 3, startStep: 16, lengthSteps: 16 });
    });

    it('clears a cell and resizes the song when measures are added or removed', () => {
        const arr = songStructureToArrangement([measure({ kick: 0 }), measure({ kick: 0 })], 16);
        const before = projectArrangement(arr, 16);
        const shorter = liftStructureEdit(arr, before, before.slice(0, 1), 16);
        expect(kickSpans(shorter)).toEqual([[0, 16, 0]]);
        expect(shorter.lengthSteps).toBe(16);
        const longer = liftStructureEdit(arr, before, [...before, measure({})], 16);
        expect(longer.lengthSteps).toBe(48);
    });

    it('returns the same arrangement for a no-op edit', () => {
        const arr = songStructureToArrangement([measure({ kick: 0 })], 16);
        const s = projectArrangement(arr, 16);
        expect(liftStructureEdit(arr, s, s.map((m) => ({ ...m })), 16)).toBe(arr);
    });
});

describe('normalizeArrangement', () => {
    it('rejects non-arrangements so the loader falls back to songStructure', () => {
        expect(normalizeArrangement(undefined)).toBeNull();
        expect(normalizeArrangement({ lengthSteps: 4 })).toBeNull();
    });

    it('drops malformed clips, renames duplicate ids, and resolves overlaps', () => {
        const arr = normalizeArrangement({
            lengthSteps: 32,
            clips: [
                { id: 'a', track: 'kick', patternSlot: 0, startStep: 0, lengthSteps: 16, loop: true },
                { id: 'a', track: 'kick', patternSlot: 1, startStep: 8, lengthSteps: 16 },
                { id: 'bad', track: 'nope', patternSlot: 0, startStep: 0, lengthSteps: 4 },
                { id: 'bad2', track: 'snare', patternSlot: 0, startStep: 0, lengthSteps: 0 },
            ],
        })!;
        expect(kickSpans(arr)).toEqual([[0, 8, 0], [8, 16, 0]]);
        expect(new Set(arr.clips.map((c) => c.id)).size).toBe(2);
        expect(arr.clips.every((c) => c.loop)).toBe(true);
    });
});
