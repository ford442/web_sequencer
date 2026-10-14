/**
 * Linear arrangement document (#1342): pure functions over `Arrangement`.
 *
 * Arrangements are immutable values — every edit returns a new object, so
 * undo history can hold them by reference and the playback index can cache
 * on identity. Song Mode's measure grid is a projection (`projectArrangement`)
 * and its edits are lifted back cell by cell (`liftStructureEdit`).
 */
import { TRACK_KEYS } from '@/constants';
import type { TrackKey } from '@/constants/appDefaults';
import type { Arrangement, ArrangementClip } from '@/types/song';
import type { SongMeasure, SongStructure } from '@/types/songMode';
import { createEmptyMeasure } from '@/utils/songModeEditing';
import { MAX_TRACK_PATTERN_SLOT_INDEX } from '@/utils/trackStorageUtils';

/** Measures a new song's Song Mode grid starts with. */
export const DEFAULT_ARRANGEMENT_MEASURES = 16;

const TRACK_ORDER: Record<TrackKey, number> = Object.fromEntries(
    TRACK_KEYS.map((k, i) => [k, i]),
) as Record<TrackKey, number>;

export function clipEnd(clip: ArrangementClip): number {
    return clip.startStep + clip.lengthSteps;
}

/** Last step of the song + 1: the loop point, never shorter than any clip. */
export function arrangementEnd(arrangement: Arrangement): number {
    let end = arrangement.lengthSteps;
    for (const clip of arrangement.clips) {
        const e = clipEnd(clip);
        if (e > end) end = e;
    }
    return Math.max(1, end);
}

/** End of the last clip (0 when empty). Exports stop here, not at the loop point. */
export function lastClipEnd(arrangement: Arrangement): number {
    let end = 0;
    for (const clip of arrangement.clips) end = Math.max(end, clipEnd(clip));
    return end;
}

export function createArrangement(lengthSteps: number): Arrangement {
    return { clips: [], lengthSteps: Math.max(1, Math.floor(lengthSteps)) };
}

export function createDefaultArrangement(stepsPerMeasure: number): Arrangement {
    return createArrangement(DEFAULT_ARRANGEMENT_MEASURES * stepsPerMeasure);
}

function sortClips(clips: ArrangementClip[]): ArrangementClip[] {
    return clips.sort((a, b) => TRACK_ORDER[a.track] - TRACK_ORDER[b.track] || a.startStep - b.startStep);
}

/** Smallest `clip-N` id not used in `clips`, counting up from `after`. */
function idAllocator(clips: readonly ArrangementClip[]): () => string {
    let n = 0;
    for (const clip of clips) {
        const m = /^clip-(\d+)$/.exec(clip.id);
        if (m) n = Math.max(n, Number(m[1]));
    }
    return () => `clip-${++n}`;
}

export function newClipId(arrangement: Arrangement): string {
    return idAllocator(arrangement.clips)();
}

/**
 * Remove `[from, to)` from one track's clips: inside clips go, straddling clips
 * are trimmed or split. Head trims bump `offsetSteps` so the notes stay put.
 */
function cutTrackRange(
    clips: readonly ArrangementClip[],
    track: TrackKey,
    from: number,
    to: number,
    nextId: () => string,
    keepId?: string,
): ArrangementClip[] {
    if (to <= from) return clips.slice();
    const out: ArrangementClip[] = [];
    for (const clip of clips) {
        const start = clip.startStep;
        const end = clipEnd(clip);
        if (clip.track !== track || clip.id === keepId || end <= from || start >= to) {
            out.push(clip);
            continue;
        }
        const offset = clip.offsetSteps ?? 0;
        if (start < from) {
            out.push({ ...clip, lengthSteps: from - start });
        }
        if (end > to) {
            const tail: ArrangementClip = {
                ...clip,
                startStep: to,
                lengthSteps: end - to,
                offsetSteps: offset + (to - start),
            };
            // A split keeps the id on the left half; the right half is new.
            if (start < from) tail.id = nextId();
            out.push(tail);
        }
    }
    return out;
}

/**
 * Put `clip` on the timeline (insert or replace by id). It wins any overlap on
 * its track: clips under it are trimmed, split or removed.
 */
export function placeClip(arrangement: Arrangement, clip: ArrangementClip): Arrangement {
    const nextId = idAllocator([...arrangement.clips, clip]);
    const others = arrangement.clips.filter((c) => c.id !== clip.id);
    const clips = cutTrackRange(others, clip.track, clip.startStep, clipEnd(clip), nextId);
    clips.push(clip);
    return {
        clips: sortClips(clips),
        lengthSteps: Math.max(arrangement.lengthSteps, clipEnd(clip)),
    };
}

/** Add a clip with a fresh id. Returns the new arrangement and that id. */
export function addClip(
    arrangement: Arrangement,
    clip: Omit<ArrangementClip, 'id'>,
): { arrangement: Arrangement; id: string } {
    const id = newClipId(arrangement);
    return { arrangement: placeClip(arrangement, { ...clip, id }), id };
}

export function updateClip(
    arrangement: Arrangement,
    id: string,
    patch: Partial<Omit<ArrangementClip, 'id'>>,
): Arrangement {
    const clip = arrangement.clips.find((c) => c.id === id);
    if (!clip) return arrangement;
    const next = { ...clip, ...patch };
    next.startStep = Math.max(0, Math.round(next.startStep));
    next.lengthSteps = Math.max(1, Math.round(next.lengthSteps));
    return placeClip(arrangement, next);
}

export function removeClip(arrangement: Arrangement, id: string): Arrangement {
    const clips = arrangement.clips.filter((c) => c.id !== id);
    return clips.length === arrangement.clips.length ? arrangement : { ...arrangement, clips };
}

export function setArrangementLength(arrangement: Arrangement, lengthSteps: number): Arrangement {
    const target = Math.max(1, Math.round(lengthSteps));
    // The loop point never cuts a clip; shrink to the last clip at most.
    const lengthStepsClamped = Math.max(target, lastClipEnd(arrangement));
    return lengthStepsClamped === arrangement.lengthSteps
        ? arrangement
        : { ...arrangement, lengthSteps: lengthStepsClamped };
}

// ---------------------------------------------------------------------------
// Song Mode compatibility
// ---------------------------------------------------------------------------

function isSlot(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_TRACK_PATTERN_SLOT_INDEX;
}

/**
 * v1–v4 migration: one clip per occupied Song Mode cell, each one measure
 * long, so playback re-anchors per measure exactly as Song Mode did.
 */
export function songStructureToArrangement(
    structure: readonly Partial<Record<TrackKey, unknown>>[],
    stepsPerMeasure: number,
): Arrangement {
    const spm = Math.max(1, stepsPerMeasure);
    const clips: ArrangementClip[] = [];
    let n = 0;
    structure.forEach((measure, m) => {
        for (const track of TRACK_KEYS) {
            const slot = measure?.[track];
            if (!isSlot(slot)) continue;
            clips.push({
                id: `clip-${++n}`,
                track,
                patternSlot: slot,
                startStep: m * spm,
                lengthSteps: spm,
                loop: true,
            });
        }
    });
    return { clips: sortClips(clips), lengthSteps: Math.max(1, structure.length) * spm };
}

/** Song Mode measure count for an arrangement at this measure length. */
export function projectedMeasureCount(arrangement: Arrangement, stepsPerMeasure: number): number {
    return Math.max(1, Math.ceil(arrangementEnd(arrangement) / Math.max(1, stepsPerMeasure)));
}

/**
 * Song Mode view of the arrangement: per measure and track, the slot of the
 * clip that covers most of that measure (earliest wins a tie); null = silent.
 * Grid-aligned arrangements round-trip exactly.
 */
export function projectArrangement(arrangement: Arrangement, stepsPerMeasure: number): SongStructure {
    const spm = Math.max(1, stepsPerMeasure);
    const count = projectedMeasureCount(arrangement, spm);
    const measures: SongMeasure[] = Array.from({ length: count }, () => createEmptyMeasure());
    const coverage: Record<string, number> = {};
    for (const clip of arrangement.clips) {
        const start = clip.startStep;
        const end = clipEnd(clip);
        for (let m = Math.floor(start / spm); m * spm < end && m < count; m++) {
            const covered = Math.min(end, (m + 1) * spm) - Math.max(start, m * spm);
            const key = `${clip.track}@${m}`;
            if (covered > (coverage[key] ?? 0)) {
                coverage[key] = covered;
                measures[m][clip.track] = clip.patternSlot;
            }
        }
    }
    return measures;
}

/**
 * Apply a Song Mode grid edit to the arrangement. Only cells that changed are
 * touched: that measure is cut out of the track and, if the new cell has a
 * slot, refilled with one measure-long clip. Untouched clips keep their trim,
 * offset and loop flag.
 */
export function liftStructureEdit(
    arrangement: Arrangement,
    prev: SongStructure,
    next: SongStructure,
    stepsPerMeasure: number,
): Arrangement {
    const spm = Math.max(1, stepsPerMeasure);
    const nextId = idAllocator(arrangement.clips);
    let clips = arrangement.clips.slice();
    let changed = false;
    const span = Math.max(prev.length, next.length);
    for (let m = 0; m < span; m++) {
        for (const track of TRACK_KEYS) {
            const before = prev[m]?.[track] ?? null;
            const after = next[m]?.[track] ?? null;
            if (before === after) continue;
            changed = true;
            clips = cutTrackRange(clips, track, m * spm, (m + 1) * spm, nextId);
            if (isSlot(after)) {
                clips.push({
                    id: nextId(),
                    track,
                    patternSlot: after,
                    startStep: m * spm,
                    lengthSteps: spm,
                    loop: true,
                });
            }
        }
    }
    const lengthSteps = next.length !== prev.length
        ? Math.max(1, next.length) * spm
        : arrangement.lengthSteps;
    if (!changed && lengthSteps === arrangement.lengthSteps) return arrangement;
    return { clips: sortClips(clips), lengthSteps };
}

// ---------------------------------------------------------------------------
// Load-time validation
// ---------------------------------------------------------------------------

function isTrackKey(value: unknown): value is TrackKey {
    return typeof value === 'string' && value in TRACK_ORDER;
}

function nonNegInt(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

/**
 * Validate a persisted arrangement. Malformed clips are dropped, duplicate ids
 * renamed, and overlaps resolved (the later-starting clip wins). Returns null
 * when `raw` is not an arrangement at all, so the caller falls back to
 * `songStructure`.
 */
export function normalizeArrangement(raw: unknown): Arrangement | null {
    if (!raw || typeof raw !== 'object') return null;
    const obj = raw as { clips?: unknown; lengthSteps?: unknown };
    if (!Array.isArray(obj.clips)) return null;
    const valid: ArrangementClip[] = [];
    for (const item of obj.clips as unknown[]) {
        if (!item || typeof item !== 'object') continue;
        const c = item as Record<string, unknown>;
        const startStep = nonNegInt(c.startStep);
        const lengthSteps = nonNegInt(c.lengthSteps);
        if (!isTrackKey(c.track) || !isSlot(c.patternSlot) || startStep === null || !lengthSteps) continue;
        const offset = nonNegInt(c.offsetSteps);
        valid.push({
            id: typeof c.id === 'string' && c.id ? c.id : '',
            track: c.track,
            patternSlot: c.patternSlot,
            startStep,
            lengthSteps,
            loop: c.loop !== false,
            ...(offset ? { offsetSteps: offset } : {}),
        });
    }
    const seen = new Set<string>();
    const nextId = idAllocator(valid);
    for (const clip of valid) {
        if (!clip.id || seen.has(clip.id)) clip.id = nextId();
        seen.add(clip.id);
    }
    valid.sort((a, b) => a.startStep - b.startStep);
    let arrangement = createArrangement(nonNegInt(obj.lengthSteps) ?? 1);
    for (const clip of valid) arrangement = placeClip(arrangement, clip);
    return arrangement;
}
