import type {
    Pattern,
    SynthParams,
    KickParams,
    SnareParams,
    HatParams,
    SamplerParams,
    Bass2Params,
} from '../types';
import type { TrackKey } from '../constants/appDefaults';
import { audioBufferToWav, type WavBitDepth } from './audioExport';
import { resolveSongTimeline, timelineDurationSeconds } from './songTimeline';
import {
    bass2ToSynthParams,
    renderDrumPattern,
    renderSamplerBankPattern,
    renderSynthPattern,
    type PatternRenderEngines,
} from './patternRenderer';
import { createZipBlob } from './zipStore';
import {
    bounceBuffersThroughOfflineGraph,
    type OfflineGraphReport,
} from '../audio/offline/compileOfflineGraph';
import {
    getStoredSampleRatePref,
    resolveExportSampleRate,
    type SampleRatePref,
} from './audioContextPolicy';
import { trackMuteSoloStore } from '../stores/trackMuteSoloStore';
import {
    analyzeLoudness,
    normalizeToTarget,
    DEFAULT_LIMITER_SETTINGS,
    type LoudnessReport,
    type LoudnessTargetKey,
    type NormalizeResult,
} from '../audio/loudness';

/** Rates the export dialog offers explicitly; `native` goes through the pref. */
export type StemExportSampleRate = 44100 | 48000;

/**
 * How the master stem is built.
 *
 * - `dry-exclusive` — the historical sample-sum of the dry stems: no master FX,
 *   no limiter. Still what a stem pack for another DAW wants.
 * - `live-patch` — the dry sum bounced through the user's live patch bay via
 *   `compileOfflineGraph`, master FX and loudness stage included. This is the
 *   "what you hear is what you bounce" master (#1233).
 */
export type StemMasterChain = 'dry-exclusive' | 'live-patch';

export interface StemExportOptions {
    /** Explicit rate. When omitted, `sampleRatePref` + `liveSampleRate` decide. */
    sampleRate?: StemExportSampleRate | number;
    /**
     * User sample-rate policy (#1136). `native` resolves to `liveSampleRate`,
     * so an export matches the context the user is monitoring through.
     */
    sampleRatePref?: SampleRatePref;
    /** `AudioContext.sampleRate` of the running engine, recorded by the caller. */
    liveSampleRate?: number | null;
    /** Master stem routing. Defaults to `dry-exclusive`. */
    masterChain?: StemMasterChain;
    /**
     * Called once with what the export actually did — the rate it ran at, the
     * master routing it ended up using, and the offline-graph report (including
     * WAM2 inserts that could not be rendered). The UI surfaces this instead of
     * leaving a degraded bounce to be discovered inside the ZIP.
     */
    onReport?: (report: StemExportReport) => void;
    bitDepth?: WavBitDepth;
    /** When true, uses song arrangement; otherwise exports the current pattern once. */
    useSongMode?: boolean;
    signal?: AbortSignal;
    onProgress?: (progress: number, label: string) => void;
    /**
     * Loudness handling for the master stem.
     *
     * The report is always computed (and written into metadata.json); passing
     * `normalizeTo` additionally gain-matches the master stem to that target
     * and re-limits it so the ceiling still holds.
     */
    loudness?: {
        normalizeTo?: number | LoudnessTargetKey;
        ceilingDbtp?: number;
        /** Oversampling for the offline true-peak measurement. Default 8×. */
        truePeakFactor?: number;
    };
}

export interface StemExportReport {
    sampleRate: number;
    sampleRatePref: SampleRatePref;
    bitDepth: WavBitDepth;
    /** `dry-exclusive`, `live-patch`, or `dry-exclusive-fallback`. */
    routing: string;
    routingNote: string;
    /** Null unless the master went through the offline patch-bay graph. */
    offlineGraph: OfflineGraphReport | null;
}

/** Channel data of an AudioBuffer, mutable in place. */
function bufferChannels(buffer: AudioBuffer): Float32Array[] {
    const channels: Float32Array[] = [];
    for (let ch = 0; ch < buffer.numberOfChannels; ch += 1) {
        channels.push(buffer.getChannelData(ch));
    }
    return channels;
}

export interface StemExportParams {
    synthA: SynthParams;
    synthB: SynthParams;
    bass2: Bass2Params;
    kick: KickParams;
    snare: SnareParams;
    closedHat: HatParams;
    openHat: HatParams;
    sampler: SamplerParams;
}

/**
 * Snapshot of the runtime mute/solo mix, passed in rather than read from the
 * singleton inside the renderer so exports stay deterministic and testable.
 * Defaults to the live store.
 */
export type StemExportMuteSolo = (track: TrackKey) => boolean;

export interface StemExportInput {
    /** Per-track audibility. Defaults to the live mute/solo store. */
    isTrackAudible?: StemExportMuteSolo;
    songStructure: { [key in TrackKey]: number | null }[];
    trackStorage: Record<TrackKey, (import('../types').PartSequence | import('../types').PartSequence[] | null)[]>;
    currentPattern: Pattern;
    tempo: number;
    params: StemExportParams;
    engines?: PatternRenderEngines;
    sampleBuffers?: (AudioBuffer | null)[];
}

export type StemId =
    | 'partA'
    | 'partB'
    | 'bass2'
    | 'drums'
    | `sampler-bank-${number}`
    | 'master';

const STEM_RENDER_ORDER: Array<{ id: StemId; label: string }> = [
    { id: 'partA', label: 'Rendering LEAD (partA)…' },
    { id: 'partB', label: 'Rendering BASS (partB)…' },
    { id: 'bass2', label: 'Rendering BASS2…' },
    { id: 'drums', label: 'Rendering drums…' },
    { id: 'sampler-bank-1', label: 'Rendering sampler bank 1…' },
    { id: 'sampler-bank-2', label: 'Rendering sampler bank 2…' },
    { id: 'sampler-bank-3', label: 'Rendering sampler bank 3…' },
    { id: 'sampler-bank-4', label: 'Rendering sampler bank 4…' },
    { id: 'sampler-bank-5', label: 'Rendering sampler bank 5…' },
    { id: 'sampler-bank-6', label: 'Rendering sampler bank 6…' },
    { id: 'sampler-bank-7', label: 'Rendering sampler bank 7…' },
    { id: 'sampler-bank-8', label: 'Rendering sampler bank 8…' },
    { id: 'master', label: 'Building master stem…' },
];

/** An all-zero stem, used in place of rendering a track the mix has silenced. */
function silentBuffer(targetLength: number, sampleRate: number): AudioBuffer {
    const ctx = new OfflineAudioContext(2, Math.max(1, targetLength), sampleRate);
    return ctx.createBuffer(2, Math.max(1, targetLength), sampleRate);
}

function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
        throw new DOMException('Export cancelled', 'AbortError');
    }
}

function alignBufferLength(buffer: AudioBuffer, targetLength: number, sampleRate: number): AudioBuffer {
    if (buffer.length === targetLength) return buffer;

    const channels = buffer.numberOfChannels;
    const aligned = new OfflineAudioContext(channels, targetLength, sampleRate);
    const out = aligned.createBuffer(channels, targetLength, sampleRate);

    for (let ch = 0; ch < channels; ch++) {
        const src = buffer.getChannelData(ch);
        const dst = out.getChannelData(ch);
        const copyLen = Math.min(src.length, targetLength);
        dst.set(src.subarray(0, copyLen));
    }

    return out;
}

function mixBuffers(buffers: AudioBuffer[], targetLength: number, sampleRate: number): AudioBuffer {
    const channels = 2;
    const mixed = new OfflineAudioContext(channels, targetLength, sampleRate);
    const out = mixed.createBuffer(channels, targetLength, sampleRate);

    for (const buffer of buffers) {
        const aligned = alignBufferLength(buffer, targetLength, sampleRate);
        for (let ch = 0; ch < channels; ch++) {
            const srcCh = Math.min(ch, aligned.numberOfChannels - 1);
            const src = aligned.getChannelData(srcCh);
            const dst = out.getChannelData(ch);
            for (let i = 0; i < targetLength; i++) {
                dst[i] += src[i];
            }
        }
    }

    return out;
}

function sumStemBuffers(stems: Map<StemId, AudioBuffer>, targetLength: number, sampleRate: number): AudioBuffer {
    const stemList = Array.from(stems.entries())
        .filter(([id]) => id !== 'master')
        .map(([, buffer]) => buffer);
    return mixBuffers(stemList, targetLength, sampleRate);
}

function stemFileName(id: StemId): string {
    if (id.startsWith('sampler-bank-')) {
        return `stems/${id}.wav`;
    }
    return `stems/${id}.wav`;
}

export function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * Renders dry per-track stems and returns a ZIP blob with aligned WAV files.
 *
 * Per-track stems are always dry. The master stem is the sample-aligned sum of
 * them, either exclusively (`masterChain: 'dry-exclusive'`) or bounced through
 * the live patch bay's master chain (`'live-patch'`, #1233). Everything renders
 * at the rate the sample-rate policy resolves to.
 */
export async function exportStemsToZip(
    input: StemExportInput,
    options: StemExportOptions = {},
): Promise<Blob> {
    const {
        bitDepth = 16,
        useSongMode = true,
        masterChain = 'dry-exclusive',
        signal,
        onProgress,
    } = options;

    // #1233: the render rate is the user's live policy, not a hardcoded 44.1k.
    // An explicit `sampleRate` (the export dialog's own choice) still wins.
    const sampleRatePref = options.sampleRatePref ?? getStoredSampleRatePref();
    const sampleRate =
        options.sampleRate ?? resolveExportSampleRate(sampleRatePref, options.liveSampleRate);

    const timeline = resolveSongTimeline(
        input.songStructure,
        input.trackStorage,
        input.currentPattern,
        useSongMode,
    );

    const targetLength = Math.ceil(
        timelineDurationSeconds(timeline.totalSteps, input.tempo) * sampleRate,
    );

    const renderOpts = {
        tempo: input.tempo,
        sampleRate,
        signal,
        engines: input.engines,
    };

    // Mute and solo are honored here: a silenced track is rendered as silence
    // rather than omitted, so the ZIP keeps a stable file set and the master
    // stem (the sum of the dry stems) reflects the mix the user is hearing.
    const isAudible: StemExportMuteSolo =
        input.isTrackAudible ?? ((track) => trackMuteSoloStore.isAudible(track));

    const stems = new Map<StemId, AudioBuffer>();
    const totalStages = STEM_RENDER_ORDER.length;

    for (let stage = 0; stage < STEM_RENDER_ORDER.length; stage++) {
        throwIfAborted(signal);
        const { id, label } = STEM_RENDER_ORDER[stage];
        onProgress?.(stage / totalStages, label);

        let buffer: AudioBuffer;

        switch (id) {
            case 'partA':
                buffer = isAudible('partA')
                    ? await renderSynthPattern(input.params.synthA, {
                          ...renderOpts,
                          sequence: timeline.sequences.partA,
                      })
                    : silentBuffer(targetLength, sampleRate);
                break;
            case 'partB':
                buffer = isAudible('partB')
                    ? await renderSynthPattern(input.params.synthB, {
                          ...renderOpts,
                          sequence: timeline.sequences.partB,
                      })
                    : silentBuffer(targetLength, sampleRate);
                break;
            case 'bass2':
                buffer = isAudible('bass2')
                    ? await renderSynthPattern(bass2ToSynthParams(input.params.bass2), {
                          ...renderOpts,
                          sequence: timeline.sequences.bass2,
                      })
                    : silentBuffer(targetLength, sampleRate);
                break;
            case 'drums': {
                // The drum stem mixes four tracks, so each is gated on its own.
                const drumBuffers: AudioBuffer[] = [];
                if (isAudible('kick')) {
                    drumBuffers.push(await renderDrumPattern('kick', input.params.kick, {
                        ...renderOpts,
                        sequence: timeline.sequences.kick,
                    }));
                    throwIfAborted(signal);
                }
                if (isAudible('snare')) {
                    drumBuffers.push(await renderDrumPattern('snare', input.params.snare, {
                        ...renderOpts,
                        sequence: timeline.sequences.snare,
                    }));
                    throwIfAborted(signal);
                }
                if (isAudible('closedHat')) {
                    drumBuffers.push(await renderDrumPattern('closedHat', input.params.closedHat, {
                        ...renderOpts,
                        sequence: timeline.sequences.closedHat,
                    }));
                    throwIfAborted(signal);
                }
                if (isAudible('openHat')) {
                    drumBuffers.push(await renderDrumPattern('openHat', input.params.openHat, {
                        ...renderOpts,
                        sequence: timeline.sequences.openHat,
                    }));
                }
                buffer = mixBuffers(drumBuffers, targetLength, sampleRate);
                break;
            }
            default:
                if (id.startsWith('sampler-bank-')) {
                    const bankIndex = Number(id.replace('sampler-bank-', '')) - 1;
                    buffer = isAudible('sampler')
                        ? await renderSamplerBankPattern(
                              timeline.sequences.sampler[bankIndex],
                              input.sampleBuffers?.[bankIndex] ?? null,
                              input.params.sampler[bankIndex],
                              input.tempo,
                              sampleRate,
                              signal,
                          )
                        : silentBuffer(targetLength, sampleRate);
                } else {
                    buffer = sumStemBuffers(stems, targetLength, sampleRate);
                }
                break;
        }

        stems.set(id, alignBufferLength(buffer, targetLength, sampleRate));
    }

    throwIfAborted(signal);

    // The master stem is the only stem that is allowed to be wet: bounce the dry
    // sum through the live patch bay so master FX and the loudness stage are the
    // ones the user was monitoring with. Falling back is never silent — the
    // routing field in metadata.json says which path produced the file.
    let routing: string = 'dry-exclusive';
    let routingNote =
        'Master stem is the sample-sum of all dry stems without master reverb, saturation, or pan.';
    let offlineGraph: OfflineGraphReport | null = null;

    if (masterChain === 'live-patch') {
        onProgress?.(0.9, 'Bouncing master through the live patch…');
        const drySum = stems.get('master');
        try {
            if (!drySum) throw new Error('no master stem to bounce');
            const bounced = await bounceBuffersThroughOfflineGraph({
                buffers: [drySum],
                durationSeconds: targetLength / sampleRate,
                sampleRate,
                sampleRatePref,
                liveSampleRate: options.liveSampleRate ?? null,
            });
            stems.set('master', alignBufferLength(bounced.buffer, targetLength, sampleRate));
            offlineGraph = bounced.report;
            routing = 'live-patch';
            routingNote =
                'Master stem rendered through the live patch bay (master FX chain + loudness stage); '
                + 'the per-track stems stay dry.';
        } catch (error) {
            if (signal?.aborted) throw error;
            routing = 'dry-exclusive-fallback';
            routingNote =
                'Live-patch master bounce failed, so the master stem is the dry sum: '
                + (error instanceof Error ? error.message : String(error));
        }
    }

    throwIfAborted(signal);

    // Measure (and optionally normalise) the master stem with the same DSP the
    // real-time master bus runs, so the exported file and the live meters agree.
    const masterStem = stems.get('master');
    let masterLoudness: LoudnessReport | NormalizeResult | null = null;
    if (masterStem) {
        const channels = bufferChannels(masterStem);
        const target = options.loudness?.normalizeTo;
        masterLoudness =
            target === undefined
                ? analyzeLoudness(channels, sampleRate, options.loudness?.truePeakFactor ?? 8)
                : normalizeToTarget(channels, sampleRate, target, {
                      ceilingDbtp: options.loudness?.ceilingDbtp ?? DEFAULT_LIMITER_SETTINGS.ceilingDbtp,
                  });
    }

    onProgress?.(0.95, 'Encoding WAV files…');

    const wavOptions = { sampleRate, bitDepth };
    const zipEntries: { path: string; data: Uint8Array }[] = [];

    for (const [id, buffer] of stems) {
        throwIfAborted(signal);
        const wavBlob = await audioBufferToWav(buffer, wavOptions);
        const wavBytes = new Uint8Array(await wavBlob.arrayBuffer());
        zipEntries.push({ path: stemFileName(id), data: wavBytes });
    }

    const metadata = {
        tempo: input.tempo,
        loudness: masterLoudness,
        measureCount: timeline.measureCount,
        totalSteps: timeline.totalSteps,
        sampleRate,
        sampleRatePref,
        liveSampleRate: options.liveSampleRate ?? null,
        bitDepth,
        routing,
        routingNote,
        /**
         * Patch, rate and per-slot WAM2 offline support of the master bounce.
         * Null for a dry-exclusive export, which never builds an offline graph.
         */
        offlineGraph,
        stems: Array.from(stems.keys()),
        silencedTracks: (
            ['partA', 'partB', 'bass2', 'kick', 'snare', 'closedHat', 'openHat', 'sampler'] as TrackKey[]
        ).filter((t) => !isAudible(t)),
    };

    zipEntries.push({
        path: 'metadata.json',
        data: new TextEncoder().encode(JSON.stringify(metadata, null, 2)),
    });

    options.onReport?.({
        sampleRate,
        sampleRatePref,
        bitDepth,
        routing,
        routingNote,
        offlineGraph,
    });

    throwIfAborted(signal);
    onProgress?.(1, 'Creating ZIP…');
    return createZipBlob(zipEntries);
}

export async function exportStemsDownload(
    input: StemExportInput,
    options: StemExportOptions = {},
    filename = 'hyphon-stems.zip',
): Promise<void> {
    const zip = await exportStemsToZip(input, options);
    downloadBlob(zip, filename);
}

export { measureMasterStemDeviation } from './stemExportMath';
