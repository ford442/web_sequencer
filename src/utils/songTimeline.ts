import { NUM_STEPS } from '@/constants';
import type { Pattern, PartSequence } from '@/types';
import type { TrackKey } from '@/constants/appDefaults';
import { tilePartSequence, trackLoopLength, type TrackLengths } from '@/utils/songMeter';
import type { Arrangement, ArrangementClip } from '@/types/song';
import { lastClipEnd, songStructureToArrangement } from '@/arrangement/model';
import { clipLocalStep } from '@/arrangement/playback';

/** Song meter fields the timeline needs; absent = 32 steps, no per-track loops. */
export interface TimelineMeter {
    stepCount?: number;
    trackLengths?: TrackLengths;
}

export interface ResolvedTimeline {
    /** Number of measures (song arrangement rows) in the export. */
    measureCount: number;
    /** Steps in each measure, in order (`measureStepCount` per measure). */
    measureStepCounts: number[];
    /** Total step count (sum of `measureStepCounts`). */
    totalSteps: number;
    /** Per-track concatenated step sequences across all measures. */
    sequences: Record<Exclude<TrackKey, 'sampler'>, PartSequence> & {
        sampler: PartSequence[];
    };
}

/**
 * Steps in measure `m`. The meter is song-wide, so every measure has the song
 * `stepCount`; clip lengths live on the arrangement, not on measures.
 */
export function measureStepCount(meter: TimelineMeter | undefined, _m: number): number {
    return meter?.stepCount ?? NUM_STEPS;
}

type TimelineSequences = ResolvedTimeline['sequences'];
type StoredSequences = Record<TrackKey, (PartSequence | PartSequence[] | null)[]>;
const SYNTH_TRACKS = ['partA', 'partB', 'bass2', 'kick', 'snare', 'closedHat', 'openHat'] as const;

/** Copy one clip's pattern into `out` over `[start, end)`, looping like live playback. */
function writeClip(
    out: PartSequence,
    seq: PartSequence | null | undefined,
    clip: ArrangementClip,
    loopLength: number,
    totalSteps: number,
): void {
    const end = Math.min(totalSteps, clip.startStep + clip.lengthSteps);
    for (let pos = clip.startStep; pos < end; pos++) {
        const local = clipLocalStep(clip, pos, loopLength);
        out.steps[pos] = local >= 0 ? seq?.steps[local] ?? null : null;
        if (!seq?.automation) continue;
        for (const [param, values] of Object.entries(seq.automation)) {
            const lane = (out.automation ??= {})[param] ??= new Array<number | null>(totalSteps).fill(null);
            lane[pos] = local >= 0 ? values[local] ?? null : null;
        }
    }
}

/**
 * Walk the arrangement's clips into flat per-track sequences. The export ends
 * at the last clip's end (trailing silence before the loop point is dropped);
 * gaps between clips are rests, exactly as the live player leaves them.
 */
export function resolveArrangementTimeline(
    arrangement: Arrangement,
    trackStorage: StoredSequences,
    meter?: TimelineMeter,
): ResolvedTimeline {
    const stepCount = meter?.stepCount ?? NUM_STEPS;
    const loopMeter = { stepCount, trackLengths: meter?.trackLengths ?? {} };
    const totalSteps = Math.max(1, lastClipEnd(arrangement));
    const blank = (): PartSequence => ({ steps: new Array<PartSequence['steps'][number]>(totalSteps).fill(null) });
    const sequences: TimelineSequences = {
        partA: blank(), partB: blank(), bass2: blank(), kick: blank(),
        snare: blank(), closedHat: blank(), openHat: blank(),
        sampler: Array.from({ length: 8 }, blank),
    };

    for (const clip of arrangement.clips) {
        const loopLength = trackLoopLength(loopMeter, clip.track);
        const stored = trackStorage[clip.track]?.[clip.patternSlot] ?? null;
        if (clip.track === 'sampler') {
            const banks = Array.isArray(stored) ? stored : [];
            for (let b = 0; b < 8; b++) writeClip(sequences.sampler[b], banks[b], clip, loopLength, totalSteps);
        } else {
            writeClip(sequences[clip.track], Array.isArray(stored) ? null : stored, clip, loopLength, totalSteps);
        }
    }

    const measureStepCounts: number[] = [];
    for (let left = totalSteps; left > 0; left -= stepCount) measureStepCounts.push(Math.min(stepCount, left));
    return { measureCount: measureStepCounts.length, measureStepCounts, totalSteps, sequences };
}

/** One pattern loop of the current pattern (pattern mode, or an empty song). */
function resolvePatternTimeline(currentPattern: Pattern, meter?: TimelineMeter): ResolvedTimeline {
    const length = measureStepCount(meter, 0);
    const tile = (key: TrackKey, seq: PartSequence | undefined) =>
        tilePartSequence(seq, length, meter?.trackLengths?.[key] ?? length);
    const sequences = {} as TimelineSequences;
    for (const key of SYNTH_TRACKS) sequences[key] = tile(key, currentPattern[key]);
    sequences.sampler = Array.from({ length: 8 }, (_, b) => tile('sampler', currentPattern.sampler[b]));
    return { measureCount: 1, measureStepCounts: [length], totalSteps: length, sequences };
}

/**
 * Resolves the full timeline for export. Song mode walks the arrangement's
 * clips (the linear player); callers that only hold the Song Mode grid get it
 * migrated one clip per cell. Pattern mode — or a song with no clips — is one
 * loop of the current pattern.
 */
export function resolveSongTimeline(
    songStructure: { [key in TrackKey]: number | null }[],
    trackStorage: StoredSequences,
    currentPattern: Pattern,
    useSongMode: boolean,
    meter?: TimelineMeter,
    arrangement?: Arrangement,
): ResolvedTimeline {
    if (useSongMode) {
        const arr = arrangement ?? songStructureToArrangement(songStructure, measureStepCount(meter, 0));
        if (arr.clips.length > 0) return resolveArrangementTimeline(arr, trackStorage, meter);
    }
    return resolvePatternTimeline(currentPattern, meter);
}

export function stepDurationSeconds(tempo: number): number {
    return 60 / tempo / 4;
}

export function timelineDurationSeconds(totalSteps: number, tempo: number): number {
    return totalSteps * stepDurationSeconds(tempo);
}
