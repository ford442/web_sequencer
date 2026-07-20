import { NUM_STEPS } from '../constants';
import type { Pattern, PartSequence } from '../types';
import type { TrackKey } from '../constants/appDefaults';

export interface ResolvedTimeline {
    /** Number of 32-step measures in the export. */
    measureCount: number;
    /** Total step count (measureCount * NUM_STEPS). */
    totalSteps: number;
    /** Per-track concatenated step sequences across all measures. */
    sequences: Record<Exclude<TrackKey, 'sampler'>, PartSequence> & {
        sampler: PartSequence[];
    };
}

function emptyPartSequence(): PartSequence {
    return { steps: Array(NUM_STEPS).fill(null) };
}

function concatPartSequences(parts: PartSequence[]): PartSequence {
    const steps = parts.flatMap((p) => p?.steps ?? Array(NUM_STEPS).fill(null));
    return { steps };
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

    return {
        measureCount,
        totalSteps: measureCount * NUM_STEPS,
        sequences: {
            partA: concatPartSequences(sequences.partA),
            partB: concatPartSequences(sequences.partB),
            bass2: concatPartSequences(sequences.bass2),
            kick: concatPartSequences(sequences.kick),
            snare: concatPartSequences(sequences.snare),
            closedHat: concatPartSequences(sequences.closedHat),
            openHat: concatPartSequences(sequences.openHat),
            sampler: sequences.sampler.map((bankParts) => concatPartSequences(bankParts)),
        },
    };
}

export function stepDurationSeconds(tempo: number): number {
    return 60 / tempo / 4;
}

export function timelineDurationSeconds(totalSteps: number, tempo: number): number {
    return totalSteps * stepDurationSeconds(tempo);
}
