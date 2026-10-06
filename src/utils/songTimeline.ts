import { NUM_STEPS } from '@/constants';
import type { Pattern, PartSequence } from '@/types';
import type { TrackKey } from '@/constants/appDefaults';
import { tilePartSequence, type TrackLengths } from '@/utils/songMeter';

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

function emptyPartSequence(): PartSequence {
    return { steps: [] };
}

/**
 * Steps in measure `m`. The meter is song-wide today, so every measure has the
 * song `stepCount`; per-measure lengths (arrangement epic) plug in here.
 */
export function measureStepCount(meter: TimelineMeter | undefined, _m: number): number {
    return meter?.stepCount ?? NUM_STEPS;
}

/**
 * Join one track's per-measure sequences, tiling each to its measure length by
 * the track's loop length (re-anchored per measure, like live Song Mode).
 */
function concatPartSequences(
    parts: PartSequence[],
    measureSteps: readonly number[],
    loopLength: (measureLength: number) => number,
): PartSequence {
    const steps: PartSequence['steps'] = [];
    const automation: Record<string, (number | null)[]> = {};
    let hasAutomation = false;
    let offset = 0;
    for (let m = 0; m < parts.length; m++) {
        const length = measureSteps[m];
        const tiled = tilePartSequence(parts[m], length, loopLength(length));
        for (let i = 0; i < length; i++) steps.push(tiled.steps[i]);
        if (tiled.automation) {
            for (const [param, values] of Object.entries(tiled.automation)) {
                if (!automation[param]) {
                    automation[param] = new Array<number | null>(offset).fill(null);
                    hasAutomation = true;
                }
                automation[param].push(...values);
            }
        }
        offset += length;
        // Keep lanes absent in this measure aligned with the step array.
        for (const values of Object.values(automation)) {
            while (values.length < offset) values.push(null);
        }
    }
    return hasAutomation ? { steps, automation } : { steps };
}

function resolveMeasureSequence(
    trackKey: TrackKey,
    measure: { [key in TrackKey]: number | null },
    trackStorage: Record<TrackKey, (PartSequence | PartSequence[] | null)[]>,
    fallbackPattern: Pattern,
): PartSequence | PartSequence[] | null {
    const slotIndex = measure[trackKey];
    if (slotIndex !== null) {
        const stored = trackStorage[trackKey]?.[slotIndex];
        if (stored) return stored;
    }
    return fallbackPattern[trackKey] ?? null;
}

/**
 * Resolves the full timeline for stem export from song arrangement or current pattern.
 */
export function resolveSongTimeline(
    songStructure: { [key in TrackKey]: number | null }[],
    trackStorage: Record<TrackKey, (PartSequence | PartSequence[] | null)[]>,
    currentPattern: Pattern,
    useSongMode: boolean,
    meter?: TimelineMeter,
): ResolvedTimeline {
    const synthTracks = ['partA', 'partB', 'bass2', 'kick', 'snare', 'closedHat', 'openHat'] as const;

    let lastActiveMeasure = -1;
    if (useSongMode) {
        for (let i = songStructure.length - 1; i >= 0; i--) {
            const measure = songStructure[i];
            if (Object.values(measure).some((slot) => slot !== null)) {
                lastActiveMeasure = i;
                break;
            }
        }
    }

    const useFallbackPattern = !useSongMode || lastActiveMeasure === -1;
    const measureCount = useFallbackPattern ? 1 : Math.max(1, lastActiveMeasure + 1);
    const measureStepCounts = Array.from({ length: measureCount }, (_, m) => measureStepCount(meter, m));
    const totalSteps = measureStepCounts.reduce((sum, n) => sum + n, 0);
    const loopFor = (key: TrackKey) => (measureLength: number) =>
        meter?.trackLengths?.[key] ?? measureLength;

    const sequences = {
        partA: [] as PartSequence[],
        partB: [] as PartSequence[],
        bass2: [] as PartSequence[],
        kick: [] as PartSequence[],
        snare: [] as PartSequence[],
        closedHat: [] as PartSequence[],
        openHat: [] as PartSequence[],
        sampler: Array.from({ length: 8 }, () => [] as PartSequence[]),
    };

    for (let m = 0; m < measureCount; m++) {
        const measure = useFallbackPattern
            ? ({} as { [key in TrackKey]: number | null })
            : songStructure[m];

        for (const trackKey of synthTracks) {
            const resolved = resolveMeasureSequence(trackKey, measure, trackStorage, currentPattern);
            if (resolved) {
                sequences[trackKey].push(resolved as PartSequence);
            } else {
                sequences[trackKey].push(emptyPartSequence());
            }
        }

        const samplerResolved = resolveMeasureSequence('sampler', measure, trackStorage, currentPattern);
        if (samplerResolved && Array.isArray(samplerResolved)) {
            const banks = samplerResolved as PartSequence[];
            for (let b = 0; b < 8; b++) {
                sequences.sampler[b].push(banks[b] ?? emptyPartSequence());
            }
        } else {
            const banks = currentPattern.sampler;
            for (let b = 0; b < 8; b++) {
                sequences.sampler[b].push(banks[b] ?? emptyPartSequence());
            }
        }
    }

    const concat = (key: TrackKey, parts: PartSequence[]) =>
        concatPartSequences(parts, measureStepCounts, loopFor(key));

    return {
        measureCount,
        measureStepCounts,
        totalSteps,
        sequences: {
            partA: concat('partA', sequences.partA),
            partB: concat('partB', sequences.partB),
            bass2: concat('bass2', sequences.bass2),
            kick: concat('kick', sequences.kick),
            snare: concat('snare', sequences.snare),
            closedHat: concat('closedHat', sequences.closedHat),
            openHat: concat('openHat', sequences.openHat),
            sampler: sequences.sampler.map((bankParts) => concat('sampler', bankParts)),
        },
    };
}

export function stepDurationSeconds(tempo: number): number {
    return 60 / tempo / 4;
}

export function timelineDurationSeconds(totalSteps: number, tempo: number): number {
    return totalSteps * stepDurationSeconds(tempo);
}
