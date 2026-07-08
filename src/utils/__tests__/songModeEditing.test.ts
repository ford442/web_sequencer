import { describe, it, expect } from 'vitest';
import {
    createEmptyMeasure,
    normalizeSongStructure,
    isEmptySong,
    bulkSetPattern,
    bulkClear,
    bulkCycle,
    swapCells,
    copySegment,
    pasteSegment,
    insertMeasure,
    duplicateMeasure,
    removeMeasureAt,
    getPatternRun,
    selectTrackRange,
    selectMeasureColumns,
    cellId,
    clampSlot,
} from '../songModeEditing';
import type { SongStructure } from '../../types/songMode';

function measure(overrides: Partial<Record<string, number | null>> = {}) {
    return { ...createEmptyMeasure(), ...overrides };
}

describe('songModeEditing', () => {
    it('createEmptyMeasure includes all tracks including bass2', () => {
        const row = createEmptyMeasure();
        expect(row.bass2).toBeNull();
        expect(row.sampler).toBeNull();
    });

    it('isEmptySong is true for blank arrangement', () => {
        expect(isEmptySong([createEmptyMeasure(), createEmptyMeasure()])).toBe(true);
        expect(isEmptySong([measure({ kick: 0 })])).toBe(false);
    });

    it('normalizeSongStructure fills missing bass2 from legacy rows', () => {
        const legacy = [{ partA: 1, partB: null, kick: 2 }] as SongStructure;
        const normalized = normalizeSongStructure(legacy);
        expect(normalized[0].bass2).toBeNull();
        expect(normalized[0].partA).toBe(1);
        expect(normalized[0].kick).toBe(2);
    });

    it('bulk set, clear, and cycle respect selection', () => {
        const structure: SongStructure = [
            measure({ partA: 0, kick: 5 }),
            measure({ partA: 1 }),
        ];
        const sel = new Set([cellId(0, 'partA'), cellId(1, 'partA')]);
        const set = bulkSetPattern(structure, sel, 3);
        expect(set[0].partA).toBe(3);
        expect(set[1].partA).toBe(3);
        expect(set[0].kick).toBe(5);

        const cleared = bulkClear(set, sel);
        expect(cleared[0].partA).toBeNull();

        const cycled = bulkCycle(structure, sel, 1);
        expect(cycled[0].partA).toBe(1);
        expect(cycled[1].partA).toBe(2);
    });

    it('swapCells exchanges values without losing other tracks', () => {
        const structure: SongStructure = [
            measure({ partA: 1, kick: 9 }),
            measure({ partA: 4, kick: 2 }),
        ];
        const next = swapCells(structure, { measure: 0, track: 'partA' }, { measure: 1, track: 'partA' });
        expect(next[0].partA).toBe(4);
        expect(next[1].partA).toBe(1);
        expect(next[0].kick).toBe(9);
    });

    it('copy and paste segment preserves relative layout', () => {
        const structure: SongStructure = [
            measure({ partA: 1, kick: 2 }),
            measure({ partA: 3, snare: 4 }),
        ];
        const sel = new Set([cellId(0, 'partA'), cellId(0, 'kick'), cellId(1, 'snare')]);
        const clip = copySegment(structure, sel);
        expect(clip).not.toBeNull();
        const pasted = pasteSegment([createEmptyMeasure(), createEmptyMeasure(), createEmptyMeasure()], clip!, {
            measure: 2,
            track: 'partA',
        });
        expect(pasted[2].partA).toBe(1);
        expect(pasted[2].kick).toBe(2);
        expect(pasted[3].snare).toBe(4);
    });

    it('paste extends song length when needed', () => {
        const clip = copySegment([measure({ sampler: 7 })], new Set([cellId(0, 'sampler')]));
        const pasted = pasteSegment([], clip!, { measure: 0, track: 'sampler' });
        expect(pasted.length).toBe(1);
        expect(pasted[0].sampler).toBe(7);
    });

    it('insert, duplicate, and remove measures are length-aware', () => {
        const base: SongStructure = [measure({ kick: 1 }), measure({ kick: 2 })];
        const inserted = insertMeasure(base, 1, measure({ kick: 9 }));
        expect(inserted.length).toBe(3);
        expect(inserted[1].kick).toBe(9);

        const dup = duplicateMeasure(base, 0);
        expect(dup.length).toBe(3);
        expect(dup[1].kick).toBe(1);

        const removed = removeMeasureAt(dup, 1);
        expect(removed.length).toBe(2);
        expect(removeMeasureAt([measure()], 0).length).toBe(1);
    });

    it('getPatternRun detects repeat spans', () => {
        const structure: SongStructure = [
            measure({ partB: 2 }),
            measure({ partB: 2 }),
            measure({ partB: 2 }),
            measure({ partB: 5 }),
        ];
        expect(getPatternRun(structure, 0, 'partB')).toEqual({ start: 0, length: 3, value: 2 });
        expect(getPatternRun(structure, 2, 'partB')?.length).toBe(3);
        expect(getPatternRun(structure, 3, 'partB')?.length).toBe(1);
    });

    it('selectTrackRange and selectMeasureColumns build expected sets', () => {
        const trackSel = selectTrackRange({ measure: 0, track: 'kick' }, { measure: 2, track: 'kick' });
        expect(trackSel.size).toBe(3);
        expect(trackSel.has(cellId(1, 'kick'))).toBe(true);

        const colSel = selectMeasureColumns(1, 2);
        expect(colSel.has(cellId(1, 'sampler'))).toBe(true);
        expect(colSel.has(cellId(0, 'kick'))).toBe(false);
    });

    it('clampSlot enforces 0–31 and null', () => {
        expect(clampSlot(-1)).toBeNull();
        expect(clampSlot(32)).toBe(31);
        expect(clampSlot(5)).toBe(5);
    });

    it('sampler row edits do not mutate other tracks in structure', () => {
        const structure: SongStructure = [measure({ sampler: 3, kick: 1 })];
        const sel = new Set([cellId(0, 'sampler')]);
        const next = bulkSetPattern(structure, sel, 6);
        expect(next[0].sampler).toBe(6);
        expect(next[0].kick).toBe(1);
    });
});

describe('songModeEditing RBS roundtrip helpers', () => {
    it('normalizes RBS-style 16-measure arrangement rows', () => {
        const rbsLike = Array.from({ length: 16 }, (_, i) => ({
            partA: i,
            partB: i % 4,
            kick: 0,
            snare: null,
            closedHat: null,
            openHat: null,
            sampler: null,
        })) as SongStructure;
        const normalized = normalizeSongStructure(rbsLike);
        expect(normalized.length).toBe(16);
        expect(normalized[15].partA).toBe(15);
        expect(normalized.every((row: SongStructure[number]) => row.bass2 === null || typeof row.bass2 === 'number')).toBe(true);
    });
});
