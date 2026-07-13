import type { TrackKey } from '../constants/appDefaults';
import { TRACK_KEYS } from '../constants';
import { MAX_TRACK_PATTERN_SLOT_INDEX } from './trackStorageUtils';
import type { SongCellCoord, SongMeasure, SongSegmentClipboard, SongStructure, SongModeTrackKey } from '../types/songMode';

export const SONG_MODE_TRACKS: { key: SongModeTrackKey; label: string; color: string }[] = [
    { key: 'partA', label: 'LEAD', color: '#06b6d4' },
    { key: 'partB', label: 'BASS', color: '#d946ef' },
    { key: 'bass2', label: 'BASS2', color: '#ff0066' },
    { key: 'kick', label: 'KICK', color: '#f97316' },
    { key: 'snare', label: 'SNARE', color: '#22c55e' },
    { key: 'closedHat', label: 'CH', color: '#eab308' },
    { key: 'openHat', label: 'OH', color: '#eab308' },
    { key: 'sampler', label: 'SMP', color: '#a855f7' },
];

export function cellId(measure: number, track: SongModeTrackKey): string {
    return `${track}@${measure}`;
}

export function parseCellId(id: string): SongCellCoord | null {
    const at = id.indexOf('@');
    if (at <= 0) return null;
    const track = id.slice(0, at) as SongModeTrackKey;
    const measure = Number(id.slice(at + 1));
    if (!Number.isFinite(measure)) return null;
    return { track, measure };
}

export function createEmptyMeasure(): SongMeasure {
    const row = {} as SongMeasure;
    for (const key of TRACK_KEYS) {
        row[key] = null;
    }
    return row;
}

export function cloneStructure(structure: SongStructure): SongStructure {
    return structure.map((m) => ({ ...m }));
}

export function clampSlot(value: number | null): number | null {
    if (value === null) return null;
    if (value < 0) return null;
    return Math.min(MAX_TRACK_PATTERN_SLOT_INDEX, Math.max(0, value));
}

export function cycleSlot(value: number | null, delta: number): number | null {
    if (value === null) return delta > 0 ? 0 : null;
    const next = value + delta;
    if (next < 0) return null;
    if (next > MAX_TRACK_PATTERN_SLOT_INDEX) return MAX_TRACK_PATTERN_SLOT_INDEX;
    return next;
}

/** Contiguous run of the same pattern slot on one track (for repeat badges). */
export function getPatternRun(
    structure: SongStructure,
    measure: number,
    track: SongModeTrackKey,
): { start: number; length: number; value: number } | null {
    const val = structure[measure]?.[track] ?? null;
    if (val === null) return null;
    let start = measure;
    while (start > 0 && structure[start - 1]?.[track] === val) start--;
    let end = measure;
    while (end < structure.length - 1 && structure[end + 1]?.[track] === val) end++;
    return { start, length: end - start + 1, value: val };
}

export function selectSingle(coord: SongCellCoord): Set<string> {
    return new Set([cellId(coord.measure, coord.track)]);
}

export function toggleCellSelection(selection: Set<string>, coord: SongCellCoord): Set<string> {
    const id = cellId(coord.measure, coord.track);
    const next = new Set(selection);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
}

/** Range on one track between anchor and target (inclusive). */
export function selectTrackRange(anchor: SongCellCoord, target: SongCellCoord): Set<string> {
    if (anchor.track !== target.track) return selectSingle(target);
    const lo = Math.min(anchor.measure, target.measure);
    const hi = Math.max(anchor.measure, target.measure);
    const next = new Set<string>();
    for (let m = lo; m <= hi; m++) next.add(cellId(m, anchor.track));
    return next;
}

/** All tracks across a measure range (column selection). */
export function selectMeasureColumns(anchorMeasure: number, targetMeasure: number): Set<string> {
    const lo = Math.min(anchorMeasure, targetMeasure);
    const hi = Math.max(anchorMeasure, targetMeasure);
    const next = new Set<string>();
    for (let m = lo; m <= hi; m++) {
        for (const { key } of SONG_MODE_TRACKS) next.add(cellId(m, key));
    }
    return next;
}

/** Rectangle selection in measure × track space. */
export function selectRectangle(anchor: SongCellCoord, target: SongCellCoord): Set<string> {
    const trackOrder = SONG_MODE_TRACKS.map((r) => r.key);
    const aTrack = trackOrder.indexOf(anchor.track);
    const bTrack = trackOrder.indexOf(target.track);
    const loM = Math.min(anchor.measure, target.measure);
    const hiM = Math.max(anchor.measure, target.measure);
    const loT = Math.min(aTrack, bTrack);
    const hiT = Math.max(aTrack, bTrack);
    const next = new Set<string>();
    for (let m = loM; m <= hiM; m++) {
        for (let t = loT; t <= hiT; t++) next.add(cellId(m, trackOrder[t]));
    }
    return next;
}

export function applyToSelection(
    structure: SongStructure,
    selection: Set<string>,
    updater: (value: number | null, coord: SongCellCoord) => number | null,
): SongStructure {
    if (selection.size === 0) return structure;
    const next = cloneStructure(structure);
    for (const id of selection) {
        const coord = parseCellId(id);
        if (!coord || !next[coord.measure]) continue;
        const current = next[coord.measure][coord.track] ?? null;
        next[coord.measure] = {
            ...next[coord.measure],
            [coord.track]: clampSlot(updater(current, coord)),
        };
    }
    return next;
}

export function bulkSetPattern(structure: SongStructure, selection: Set<string>, slot: number | null): SongStructure {
    return applyToSelection(structure, selection, () => clampSlot(slot));
}

export function bulkClear(structure: SongStructure, selection: Set<string>): SongStructure {
    return bulkSetPattern(structure, selection, null);
}

export function bulkCycle(structure: SongStructure, selection: Set<string>, delta: number): SongStructure {
    return applyToSelection(structure, selection, (v) => cycleSlot(v, delta));
}

export function swapCells(structure: SongStructure, a: SongCellCoord, b: SongCellCoord): SongStructure {
    if (a.measure === b.measure && a.track === b.track) return structure;
    const next = cloneStructure(structure);
    const va = next[a.measure]?.[a.track] ?? null;
    const vb = next[b.measure]?.[b.track] ?? null;
    next[a.measure] = { ...next[a.measure], [a.track]: vb };
    next[b.measure] = { ...next[b.measure], [b.track]: va };
    return next;
}

export function moveCellValue(structure: SongStructure, from: SongCellCoord, to: SongCellCoord): SongStructure {
    if (from.measure === to.measure && from.track === to.track) return structure;
    const next = cloneStructure(structure);
    const val = next[from.measure]?.[from.track] ?? null;
    next[from.measure] = { ...next[from.measure], [from.track]: null };
    next[to.measure] = { ...next[to.measure], [to.track]: val };
    return next;
}

export function insertMeasure(structure: SongStructure, index: number, template?: SongMeasure): SongStructure {
    const row = template ? { ...template } : createEmptyMeasure();
    const i = Math.max(0, Math.min(structure.length, index));
    return [...structure.slice(0, i), row, ...structure.slice(i)];
}

export function duplicateMeasure(structure: SongStructure, index: number): SongStructure {
    if (index < 0 || index >= structure.length) return structure;
    return insertMeasure(structure, index + 1, { ...structure[index] });
}

export function removeMeasureAt(structure: SongStructure, index: number): SongStructure {
    if (structure.length <= 1) return structure;
    if (index < 0 || index >= structure.length) return structure;
    return structure.filter((_, i) => i !== index);
}

/** Duplicate one track's pattern across the next measure (row-aware extend). */
export function duplicateTrackMeasure(
    structure: SongStructure,
    measureIndex: number,
    track: SongModeTrackKey,
): SongStructure {
    if (measureIndex < 0 || measureIndex >= structure.length) return structure;
    const val = structure[measureIndex][track];
    const insertAt = measureIndex + 1;
    const next = insertMeasure(structure, insertAt);
    next[insertAt] = { ...next[insertAt], [track]: val };
    return next;
}

export function copySegment(structure: SongStructure, selection: Set<string>): SongSegmentClipboard | null {
    if (selection.size === 0) return null;
    const coords = [...selection].map((id) => parseCellId(id)).filter(Boolean) as SongCellCoord[];
    if (coords.length === 0) return null;
    const minM = Math.min(...coords.map((c) => c.measure));
    const maxM = Math.max(...coords.map((c) => c.measure));
    const trackOrder = SONG_MODE_TRACKS.map((r) => r.key);
    const trackIdx = coords.map((c) => trackOrder.indexOf(c.track));
    const minT = Math.min(...trackIdx);
    const maxT = Math.max(...trackIdx);
    const cells = coords.map((c) => ({
        dMeasure: c.measure - minM,
        track: c.track,
        value: structure[c.measure]?.[c.track] ?? null,
    }));
    return { cells, width: maxM - minM + 1, height: maxT - minT + 1 };
}

export function pasteSegment(
    structure: SongStructure,
    clipboard: SongSegmentClipboard,
    anchor: SongCellCoord,
): SongStructure {
    let next = cloneStructure(structure);
    const neededMeasures = anchor.measure + clipboard.width;
    while (next.length < neededMeasures) {
        next = [...next, createEmptyMeasure()];
    }
    for (const cell of clipboard.cells) {
        const m = anchor.measure + cell.dMeasure;
        if (m < 0 || m >= next.length) continue;
        next[m] = { ...next[m], [cell.track]: clampSlot(cell.value) };
    }
    return next;
}

export function updateCell(
    structure: SongStructure,
    measure: number,
    track: SongModeTrackKey,
    value: number | null,
): SongStructure {
    if (measure < 0 || measure >= structure.length) return structure;
    const next = cloneStructure(structure);
    next[measure] = { ...next[measure], [track]: clampSlot(value) };
    return next;
}

/** Ensure every measure row includes all track keys (RBS / legacy roundtrip). */
export function normalizeSongStructure(structure: SongStructure): SongStructure {
    return structure.map((row) => {
        const normalized = createEmptyMeasure();
        for (const key of TRACK_KEYS) {
            normalized[key] = row[key] ?? null;
        }
        return normalized;
    });
}

export function isEmptySong(structure: SongStructure): boolean {
    return structure.every((m) => TRACK_KEYS.every((k) => m[k] === null));
}
