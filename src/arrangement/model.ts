/**
 * Linear arrangement document (#1342): pure functions over `Arrangement`.
 *
 * Arrangements are immutable values — every edit returns a new object, so
 * undo history can hold them by reference and the playback index can cache
 * on identity. Song Mode's measure grid is a projection (`projectArrangement`)
 * and its edits are lifted back cell by cell (`liftStructureEdit`).
 *
 * Clips are pattern clips or audio clips (v6, #1629), discriminated on
 * `kind`. Both keep the same rules: one clip sounds per track at a time
 * (`placeClip`), a head trim moves `offsetSteps`, and a split's right half
 * continues where the left half stopped. Pattern tracks and audio tracks are
 * disjoint keys, so a clip of one kind never cuts a clip of the other.
 */
import { AUDIO_TRACK_KEYS, MEDIA_ID_PATTERN, TRACK_KEYS } from '@/constants';
import type { TrackKey } from '@/constants/appDefaults';
import type { Arrangement, ArrangementClip, AudioClip, AudioClipWarp, AudioTrackKey, PatternClip } from '@/types/song';
import type { SongMeasure, SongStructure } from '@/types/songMode';
import { createEmptyMeasure } from '@/utils/songModeEditing';
import { MAX_TRACK_PATTERN_SLOT_INDEX } from '@/utils/trackStorageUtils';
import type { UnifiedAutomationLane } from '@/types/automation';
import { normalizeClipLanes, shiftClipLanes } from './clipLanes';

/** Measures a new song's Song Mode grid starts with. */
export const DEFAULT_ARRANGEMENT_MEASURES = 16;

const TRACK_ORDER: Record<TrackKey, number> = Object.fromEntries(
    TRACK_KEYS.map((k, i) => [k, i]),
) as Record<TrackKey, number>;

/** Lane order of every track: the pattern tracks, then the audio tracks. */
const LANE_ORDER = new Map<string, number>([
    ...TRACK_KEYS.map((k, i) => [k, i] as const),
    ...AUDIO_TRACK_KEYS.map((k, i) => [k, TRACK_KEYS.length + i] as const),
]);

export type ArrangementTrack = ArrangementClip['track'];

export function isAudioClip(clip: ArrangementClip): clip is AudioClip {
    return clip.kind === 'audio';
}

export function isPatternClip(clip: ArrangementClip): clip is PatternClip {
    return clip.kind !== 'audio';
}

export function isAudioTrackKey(value: unknown): value is AudioTrackKey {
    return typeof value === 'string' && (AUDIO_TRACK_KEYS as readonly string[]).includes(value);
}

/** A new clip: every field but the id, which `addClip` allocates. */
export type NewClip = Omit<PatternClip, 'id'> | Omit<AudioClip, 'id'>;

/** Fields an edit may change. Neither the kind nor the id of a clip ever changes. */
export type ClipPatch = Partial<Omit<PatternClip, 'id' | 'kind'>> | Partial<Omit<AudioClip, 'id' | 'kind'>>;

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
    return clips.sort((a, b) =>
        (LANE_ORDER.get(a.track) ?? 0) - (LANE_ORDER.get(b.track) ?? 0) || a.startStep - b.startStep);
}

/** The part of `clip` left of a cut at `length` steps. An audio clip loses its fade-out there. */
function headPart(clip: ArrangementClip, length: number): ArrangementClip {
    const head = { ...clip, lengthSteps: length };
    if (head.kind === 'audio') delete head.fadeOutFrames;
    return head;
}

/**
 * The part of `clip` right of a cut at song step `to`: it continues the
 * source where the left part stopped (`offsetSteps`). Pattern clip lanes
 * shift with it; an audio clip loses its fade-in there.
 */
function tailPart(clip: ArrangementClip, to: number): ArrangementClip {
    const shift = to - clip.startStep;
    const tail = {
        ...clip,
        startStep: to,
        lengthSteps: clipEnd(clip) - to,
        offsetSteps: (clip.offsetSteps ?? 0) + shift,
    };
    if (tail.kind === 'audio') delete tail.fadeInFrames;
    else if (tail.lanes) tail.lanes = shiftClipLanes(tail.lanes, shift);
    return tail;
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
 * are trimmed or split. Head trims bump `offsetSteps` so the notes stay put,
 * and shift clip lanes by the same amount so the automation stays put too.
 */
function cutTrackRange(
    clips: readonly ArrangementClip[],
    track: ArrangementTrack,
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
        if (start < from) out.push(headPart(clip, from - start));
        if (end > to) {
            const tail = tailPart(clip, to);
            // A split keeps the id on the left half; the right half is new.
            if (start < from) tail.id = nextId();
            out.push(tail);
        }
    }
    return out;
}

/**
 * Split a clip at song step `at` (strictly inside it): the left half keeps the
 * id, the right half gets a new one and continues the source. Returns the
 * arrangement unchanged when `at` is not inside the clip.
 */
export function splitClip(arrangement: Arrangement, id: string, at: number): { arrangement: Arrangement; rightId: string | null } {
    const clip = arrangement.clips.find((c) => c.id === id);
    const step = Math.round(at);
    if (!clip || step <= clip.startStep || step >= clipEnd(clip)) return { arrangement, rightId: null };
    const rightId = newClipId(arrangement);
    const right = { ...tailPart(clip, step), id: rightId };
    const clips = arrangement.clips.map((c) => (c.id === id ? headPart(c, step - c.startStep) : c));
    clips.push(right);
    return { arrangement: { ...arrangement, clips: sortClips(clips) }, rightId };
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
    clip: NewClip,
): { arrangement: Arrangement; id: string } {
    const id = newClipId(arrangement);
    return { arrangement: placeClip(arrangement, { ...clip, id } as ArrangementClip), id };
}

/** An edited audio clip kept valid: whole frames, gain in range, a zero fade left out. */
function tidyAudioEdit(clip: AudioClip): void {
    clip.offsetFrames = Math.max(0, Math.round(Number.isFinite(clip.offsetFrames) ? clip.offsetFrames : 0));
    const [minDb, maxDb] = AUDIO_CLIP_GAIN_DB_RANGE;
    clip.gainDb = Number.isFinite(clip.gainDb) ? Math.min(maxDb, Math.max(minDb, clip.gainDb)) : 0;
    for (const key of ['fadeInFrames', 'fadeOutFrames'] as const) {
        const frames = Math.round(clip[key] ?? 0);
        if (Number.isFinite(frames) && frames > 0) clip[key] = frames;
        else delete clip[key];
    }
}

export function updateClip(
    arrangement: Arrangement,
    id: string,
    patch: ClipPatch,
): Arrangement {
    const clip = arrangement.clips.find((c) => c.id === id);
    if (!clip) return arrangement;
    const next = { ...clip, ...patch } as ArrangementClip;
    // A clip stays on a track of its own kind.
    if (isAudioClip(clip) !== isAudioTrackKey(next.track)) return arrangement;
    next.startStep = Math.max(0, Math.round(next.startStep));
    next.lengthSteps = Math.max(1, Math.round(next.lengthSteps));
    if (isAudioClip(next)) tidyAudioEdit(next);
    // A head trim moves `offsetSteps` and the lane origin together (#1494),
    // unless the patch brings its own lanes.
    const headShift = (next.offsetSteps ?? 0) - (clip.offsetSteps ?? 0);
    if (headShift !== 0 && isPatternClip(clip) && isPatternClip(next) && clip.lanes
        && (patch as Partial<PatternClip>).lanes === undefined) {
        next.lanes = shiftClipLanes(clip.lanes, headShift);
    }
    return placeClip(arrangement, next);
}

/** Replace a pattern clip's lanes (clip-local steps). One edit, one undo step. */
export function setClipLanes(
    arrangement: Arrangement,
    id: string,
    lanes: UnifiedAutomationLane[],
): Arrangement {
    const index = arrangement.clips.findIndex((c) => c.id === id);
    const found = index < 0 ? null : arrangement.clips[index];
    if (!found || !isPatternClip(found)) return arrangement;
    const clip = { ...found };
    if (lanes.length) clip.lanes = lanes;
    else delete clip.lanes;
    const clips = arrangement.clips.slice();
    clips[index] = clip;
    return { ...arrangement, clips };
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
    const clips: PatternClip[] = [];
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
        if (!isPatternClip(clip)) continue;
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

const AUDIO_WARPS: readonly AudioClipWarp[] = ['off', 'repitch', 'stretch'];
/** Clip gain range in dB; beyond it is a typo, not a mix decision. */
export const AUDIO_CLIP_GAIN_DB_RANGE = [-96, 24] as const;

function normalizePatternClip(c: Record<string, unknown>, startStep: number, lengthSteps: number): PatternClip | null {
    if (!isTrackKey(c.track) || !isSlot(c.patternSlot)) return null;
    const offset = nonNegInt(c.offsetSteps);
    const lanes = normalizeClipLanes(c.lanes);
    return {
        ...(c.kind === 'pattern' ? { kind: 'pattern' as const } : {}),
        id: typeof c.id === 'string' && c.id ? c.id : '',
        track: c.track,
        patternSlot: c.patternSlot,
        startStep,
        lengthSteps,
        loop: c.loop !== false,
        ...(offset ? { offsetSteps: offset } : {}),
        ...(lanes ? { lanes } : {}),
    };
}

function normalizeAudioClip(c: Record<string, unknown>, startStep: number, lengthSteps: number): AudioClip | null {
    if (!isAudioTrackKey(c.track) || typeof c.mediaId !== 'string' || !MEDIA_ID_PATTERN.test(c.mediaId)) return null;
    const offset = nonNegInt(c.offsetSteps);
    const fadeIn = nonNegInt(c.fadeInFrames);
    const fadeOut = nonNegInt(c.fadeOutFrames);
    const [minDb, maxDb] = AUDIO_CLIP_GAIN_DB_RANGE;
    const gainDb = typeof c.gainDb === 'number' && Number.isFinite(c.gainDb)
        ? Math.min(maxDb, Math.max(minDb, c.gainDb))
        : 0;
    const warp = AUDIO_WARPS.includes(c.warp as AudioClipWarp) ? (c.warp as AudioClipWarp) : 'off';
    const sourceBpm = typeof c.sourceBpm === 'number' && Number.isFinite(c.sourceBpm) && c.sourceBpm > 0
        ? c.sourceBpm
        : null;
    return {
        kind: 'audio',
        id: typeof c.id === 'string' && c.id ? c.id : '',
        track: c.track,
        mediaId: c.mediaId,
        startStep,
        lengthSteps,
        ...(offset ? { offsetSteps: offset } : {}),
        offsetFrames: nonNegInt(c.offsetFrames) ?? 0,
        gainDb,
        ...(fadeIn ? { fadeInFrames: fadeIn } : {}),
        ...(fadeOut ? { fadeOutFrames: fadeOut } : {}),
        warp,
        ...(sourceBpm !== null ? { sourceBpm } : {}),
    };
}

/**
 * Validate a persisted arrangement. Malformed clips are dropped, duplicate ids
 * renamed, and overlaps resolved (the later-starting clip wins). Returns null
 * when `raw` is not an arrangement at all, so the caller falls back to
 * `songStructure`. A clip whose `kind` this build does not know is dropped.
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
        if (startStep === null || !lengthSteps) continue;
        const clip = c.kind === 'audio'
            ? normalizeAudioClip(c, startStep, lengthSteps)
            : c.kind === undefined || c.kind === 'pattern'
                ? normalizePatternClip(c, startStep, lengthSteps)
                : null;
        if (clip) valid.push(clip);
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
