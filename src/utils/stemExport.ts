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
    analyzeLoudness,
    normalizeToTarget,
    DEFAULT_LIMITER_SETTINGS,
    type LoudnessReport,
    type LoudnessTargetKey,
    type NormalizeResult,
} from '../audio/loudness';

export type StemExportSampleRate = 44100 | 48000;

export interface StemExportOptions {
    sampleRate?: StemExportSampleRate;
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

export interface StemExportInput {
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
 * Master stem is the sample-aligned sum of all dry stems (exclusive routing — no master FX).
 */
export async function exportStemsToZip(
    input: StemExportInput,
    options: StemExportOptions = {},
): Promise<Blob> {
    const {
        sampleRate = 44100,
        bitDepth = 16,
        useSongMode = true,
        signal,
        onProgress,
    } = options;

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

    const stems = new Map<StemId, AudioBuffer>();
    const totalStages = STEM_RENDER_ORDER.length;

    for (let stage = 0; stage < STEM_RENDER_ORDER.length; stage++) {
        throwIfAborted(signal);
        const { id, label } = STEM_RENDER_ORDER[stage];
        onProgress?.(stage / totalStages, label);

        let buffer: AudioBuffer;

        switch (id) {
            case 'partA':
                buffer = await renderSynthPattern(input.params.synthA, {
                    ...renderOpts,
                    sequence: timeline.sequences.partA,
                });
                break;
            case 'partB':
                buffer = await renderSynthPattern(input.params.synthB, {
                    ...renderOpts,
                    sequence: timeline.sequences.partB,
                });
                break;
            case 'bass2':
                buffer = await renderSynthPattern(bass2ToSynthParams(input.params.bass2), {
                    ...renderOpts,
                    sequence: timeline.sequences.bass2,
                });
                break;
            case 'drums': {
                const kick = await renderDrumPattern('kick', input.params.kick, {
                    ...renderOpts,
                    sequence: timeline.sequences.kick,
                });
                throwIfAborted(signal);
                const snare = await renderDrumPattern('snare', input.params.snare, {
                    ...renderOpts,
                    sequence: timeline.sequences.snare,
                });
                throwIfAborted(signal);
                const ch = await renderDrumPattern('closedHat', input.params.closedHat, {
                    ...renderOpts,
                    sequence: timeline.sequences.closedHat,
                });
                throwIfAborted(signal);
                const oh = await renderDrumPattern('openHat', input.params.openHat, {
                    ...renderOpts,
                    sequence: timeline.sequences.openHat,
                });
                buffer = mixBuffers([kick, snare, ch, oh], targetLength, sampleRate);
                break;
            }
            default:
                if (id.startsWith('sampler-bank-')) {
                    const bankIndex = Number(id.replace('sampler-bank-', '')) - 1;
                    buffer = await renderSamplerBankPattern(
                        timeline.sequences.sampler[bankIndex],
                        input.sampleBuffers?.[bankIndex] ?? null,
                        input.params.sampler[bankIndex],
                        input.tempo,
                        sampleRate,
                        signal,
                    );
                } else {
                    buffer = sumStemBuffers(stems, targetLength, sampleRate);
                }
                break;
        }

        stems.set(id, alignBufferLength(buffer, targetLength, sampleRate));
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
        bitDepth,
        routing: 'dry-exclusive',
        routingNote:
            'Master stem is the sample-sum of all dry stems without master reverb, saturation, or pan.',
        stems: Array.from(stems.keys()),
    };

    zipEntries.push({
        path: 'metadata.json',
        data: new TextEncoder().encode(JSON.stringify(metadata, null, 2)),
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
