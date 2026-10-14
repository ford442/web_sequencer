/**
 * Arrangement → "what does each track play at song step N". Shared by the
 * live step handler and the offline timeline so export matches playback.
 */
import { TRACK_KEYS } from '@/constants';
import type { TrackKey } from '@/constants/appDefaults';
import type { Arrangement, ArrangementClip } from '@/types/song';
import { trackLoopLength, type SongMeter } from '@/utils/songMeter';
import { clipEnd } from './model';

type ClipIndex = Record<TrackKey, ArrangementClip[]>;

// Arrangements are immutable, so the per-track index is cached by identity.
const indexCache = new WeakMap<Arrangement, ClipIndex>();

export function arrangementIndex(arrangement: Arrangement): ClipIndex {
    let index = indexCache.get(arrangement);
    if (!index) {
        index = {} as ClipIndex;
        for (const key of TRACK_KEYS) index[key] = [];
        for (const clip of arrangement.clips) index[clip.track].push(clip);
        for (const key of TRACK_KEYS) index[key].sort((a, b) => a.startStep - b.startStep);
        indexCache.set(arrangement, index);
    }
    return index;
}

/** Clip sounding on `track` at song step `pos`, or null (binary search). */
export function clipAt(arrangement: Arrangement, track: TrackKey, pos: number): ArrangementClip | null {
    const clips = arrangementIndex(arrangement)[track];
    let lo = 0;
    let hi = clips.length - 1;
    let found = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (clips[mid].startStep <= pos) {
            found = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    if (found < 0) return null;
    const clip = clips[found];
    return pos < clipEnd(clip) ? clip : null;
}

/**
 * Pattern step a clip plays at song step `pos`, or -1 for a rest. The pattern
 * loops at the track's loop length (meter, not a hardcoded 32); a non-looping
 * clip plays it once.
 */
export function clipLocalStep(clip: ArrangementClip, pos: number, loopLength: number): number {
    const t = (clip.offsetSteps ?? 0) + (pos - clip.startStep);
    const len = Math.max(1, loopLength);
    if (clip.loop) return t % len;
    return t < len ? t : -1;
}

export interface ArrangementTrackState {
    /** Slot to read, or null when no clip covers the step. */
    slot: number | null;
    /** Step inside that slot's pattern; -1 = rest. */
    step: number;
}

export type ArrangementFrame = Record<TrackKey, ArrangementTrackState>;

export function createArrangementFrame(): ArrangementFrame {
    const frame = {} as ArrangementFrame;
    for (const key of TRACK_KEYS) frame[key] = { slot: null, step: -1 };
    return frame;
}

/** Fill `frame` (reused, no allocation) with every track's slot and step at `pos`. */
export function resolveArrangementFrame(
    frame: ArrangementFrame,
    arrangement: Arrangement,
    pos: number,
    meter: Pick<SongMeter, 'stepCount' | 'trackLengths'>,
): ArrangementFrame {
    for (let i = 0; i < TRACK_KEYS.length; i++) {
        const key = TRACK_KEYS[i];
        const clip = clipAt(arrangement, key, pos);
        const out = frame[key];
        if (clip) {
            out.slot = clip.patternSlot;
            out.step = clipLocalStep(clip, pos, trackLoopLength(meter, key));
        } else {
            out.slot = null;
            out.step = -1;
        }
    }
    return frame;
}
