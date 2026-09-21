/**
 * Audible preview of an AI song, before it is imported (#1233).
 *
 * This is a *consumer* of `compileOfflineGraph`, not a second engine: the AI
 * modal renders the first N bars through the same offline patch bay, at the
 * same sample rate and through the same master loudness stage that freeze and
 * stem export use. If it sounds right here it bounces the same way.
 *
 * What cannot be previewed is stated, never faked: a sampler bank whose audio
 * is TTS or a URL has nothing to render before import, so the slot is reported
 * as skipped with a reason instead of being quietly dropped from the mix.
 */

import {
    convertAISong,
    type AIImportErrorDetails,
    type AISongData,
} from '../importers/ai-song';
import type { Pattern, PartSequence, SavedSongData, SynthParams } from '../types';
import {
    bass2ToSynthParams,
    renderDrumPattern,
    renderSynthPattern,
    type PatternRenderEngines,
} from './patternRenderer';
import { stepDurationSeconds } from './songTimeline';
import {
    bounceBuffersThroughOfflineGraph,
    type OfflineGraphReport,
} from '../audio/offline/compileOfflineGraph';
import { resolveExportSampleRate, type SampleRatePref } from './audioContextPolicy';

/** Steps in one bar of the 32-step (two-bar) pattern grid. */
export const STEPS_PER_BAR = 16;

/** Default preview length. Long enough to hear the groove, short to render. */
export const DEFAULT_PREVIEW_BARS = 2;

export type PreviewSlotStatus = 'rendered' | 'silent' | 'skipped';

export type PreviewSkipReason =
    | 'no-notes'
    | 'tts-not-rendered'
    | 'sample-not-loaded'
    | 'render-failed';

export interface AISongPreviewSlot {
    /** Track or sampler bank this row is about. */
    slot: string;
    status: PreviewSlotStatus;
    reason?: PreviewSkipReason;
    detail?: string;
}

export interface AISongPreviewResult {
    buffer: AudioBuffer;
    bars: number;
    sampleRate: number;
    tempo: number;
    /** One row per track / sampler bank — the "skip loudly" report. */
    slots: AISongPreviewSlot[];
    /** Patch, rate and WAM2 offline support of the graph it rendered through. */
    graph: OfflineGraphReport;
}

export interface AISongPreviewOptions {
    bars?: number;
    engines?: PatternRenderEngines;
    sampleRatePref?: SampleRatePref;
    /** `AudioContext.sampleRate` of the running engine, for the `native` pref. */
    liveSampleRate?: number | null;
    signal?: AbortSignal;
}

export class AISongPreviewError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AISongPreviewError';
    }
}

/** First `steps` of a sequence, padded so every track renders the same length. */
function takeSteps(sequence: PartSequence | undefined, steps: number): PartSequence {
    const source = sequence?.steps ?? [];
    const out: PartSequence['steps'] = Array.from({ length: steps }, () => null);
    for (let i = 0; i < Math.min(steps, source.length); i += 1) out[i] = source[i] ?? null;
    return { steps: out };
}

function hasNotes(sequence: PartSequence): boolean {
    return sequence.steps.some((step) => step !== null);
}

/** Flatten the import error union into one line the modal can show. */
function describeImportError(error: AIImportErrorDetails | undefined): string {
    if (!error) return 'conversion failed';
    switch (error.type) {
        case 'VALIDATION_ERROR':
            return `${error.field}: ${error.message}`;
        case 'UNSUPPORTED_VERSION':
            return `unsupported song version ${error.version}`;
        case 'CONVERSION_ERROR':
            return `${error.track}: ${error.details}`;
        case 'INVALID_NOTE':
            return `invalid note ${error.note} on ${error.track}`;
        case 'STORAGE_ERROR':
            return error.message;
    }
}

function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw new DOMException('Preview cancelled', 'AbortError');
}

/**
 * Render the first bars of an AI song to an audible buffer.
 *
 * Synth and drum tracks render through the shared pattern renderers, then the
 * whole mix is bounced through the live patch bay. Sampler banks are reported,
 * not rendered: their audio does not exist until the song is imported and the
 * TTS / sample fetch has run.
 */
export async function renderAISongPreview(
    data: AISongData,
    options: AISongPreviewOptions = {},
): Promise<AISongPreviewResult> {
    const converted = convertAISong(data);
    if (!converted.success || !converted.song) {
        const detail = converted.success
            ? 'no song produced'
            : describeImportError(converted.error);
        throw new AISongPreviewError(`Cannot preview this song: ${detail}`);
    }

    const song: SavedSongData = converted.song;
    const pattern: Pattern = song.pattern;
    const tempo = song.tempo;
    const bars = Math.max(1, options.bars ?? DEFAULT_PREVIEW_BARS);
    const steps = bars * STEPS_PER_BAR;
    const durationSeconds = steps * stepDurationSeconds(tempo);

    const slots: AISongPreviewSlot[] = [];
    const buffers: AudioBuffer[] = [];
    const renderOpts = { tempo, signal: options.signal, engines: options.engines };

    // Resolve the rate up front and hand the same number to every per-track
    // render and to the bounce: a preview that resampled between the two would
    // not be the thing the export produces.
    const sampleRate = resolveExportSampleRate(options.sampleRatePref, options.liveSampleRate);

    const renderTrack = async (
        slot: string,
        sequence: PartSequence,
        render: () => Promise<AudioBuffer>,
    ): Promise<void> => {
        throwIfAborted(options.signal);
        if (!hasNotes(sequence)) {
            slots.push({ slot, status: 'silent', reason: 'no-notes' });
            return;
        }
        try {
            buffers.push(await render());
            slots.push({ slot, status: 'rendered' });
        } catch (error) {
            if (options.signal?.aborted) throw error;
            slots.push({
                slot,
                status: 'skipped',
                reason: 'render-failed',
                detail: error instanceof Error ? error.message : String(error),
            });
        }
    };

    const synthTracks: Array<{ slot: string; sequence: PartSequence; params: SynthParams }> = [
        { slot: 'synthA', sequence: takeSteps(pattern.partA, steps), params: song.params.synthA },
        { slot: 'synthB', sequence: takeSteps(pattern.partB, steps), params: song.params.synthB },
    ];
    // bass2 is optional on a saved song: a preview of a song without it plays
    // the other tracks rather than failing.
    if (song.params.bass2) {
        synthTracks.push({
            slot: 'bass2',
            sequence: takeSteps(pattern.bass2, steps),
            params: bass2ToSynthParams(song.params.bass2),
        });
    }

    for (const track of synthTracks) {
        await renderTrack(track.slot, track.sequence, () =>
            renderSynthPattern(track.params, {
                ...renderOpts,
                sequence: track.sequence,
                sampleRate,
            }),
        );
    }

    const drumTracks = ['kick', 'snare', 'closedHat', 'openHat'] as const;
    for (const drum of drumTracks) {
        const sequence = takeSteps(pattern[drum], steps);
        await renderTrack(drum, sequence, () =>
            renderDrumPattern(drum, song.params[drum], {
                ...renderOpts,
                sequence,
                sampleRate,
            }),
        );
    }

    for (const bank of data.tracks.sampler ?? []) {
        const source = bank.ttsText
            ? ('tts-not-rendered' as const)
            : ('sample-not-loaded' as const);
        slots.push({
            slot: `sampler-bank-${bank.bankIndex + 1}`,
            status: 'skipped',
            reason: source,
            detail: bank.ttsText
                ? `"${bank.ttsText}" is synthesised on import — not available in preview`
                : `${bank.sampleUrl ?? 'sample'} is loaded on import — not available in preview`,
        });
    }

    throwIfAborted(options.signal);

    const bounced = await bounceBuffersThroughOfflineGraph({
        buffers,
        durationSeconds,
        sampleRate,
        sampleRatePref: options.sampleRatePref,
        liveSampleRate: options.liveSampleRate ?? null,
    });

    return {
        buffer: bounced.buffer,
        bars,
        sampleRate,
        tempo,
        slots,
        graph: bounced.report,
    };
}

/** One-line summary of what the preview could not play, or null when all clear. */
export function summarizePreviewSkips(result: AISongPreviewResult): string | null {
    const skipped = result.slots.filter((slot) => slot.status === 'skipped');
    const bypassed = result.graph.slots.filter((slot) => slot.status === 'bypassed');
    if (skipped.length === 0 && bypassed.length === 0) return null;

    const parts: string[] = [];
    if (skipped.length > 0) {
        parts.push(`${skipped.length} slot${skipped.length === 1 ? '' : 's'} not rendered`);
    }
    if (bypassed.length > 0) {
        parts.push(
            `${bypassed.length} WAM2 insert${bypassed.length === 1 ? '' : 's'} unsupported offline`,
        );
    }
    return parts.join(' · ');
}
