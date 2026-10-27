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
import { describeOfflineVocalSupport, type OfflineVocalBankReport } from '../audio/offline/vocalOfflineSupport';
import {
    bass2ToSynthParams,
    renderDrumPattern,
    renderSynthPattern,
    type PatternRenderEngines,
} from './patternRenderer';
import { createZipBlob } from './zipStore';
import { renderSamplerBankStem, type StemVocalInput } from './stemExportVocal';
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
import { noteFxStore } from '../stores/noteFxStore';
import { measurePassStarts } from '../sequencer/noteFx/chain';
import { noteFxLaneLookup } from '../sequencer/noteFx/runtime';
import { chainIsActive, type NoteFxTrack, type SongNoteFx } from '../sequencer/noteFx/types';
import { trackLoopLength } from './songMeter';
import { NUM_STEPS } from '../constants';
import type { UnifiedAutomationLane } from '../types';
import { automationStore } from '../stores/automationStore';
import {
    resolveSynthLaneAutomation,
    type OfflineAutomationReport,
} from '../audio/offline/offlineLaneAutomation';
import { createOfflineBuffer } from '../audio/offline/createOfflineContext';
import {
    createMixBus,
    type MixBus,
    type MixBusEngine,
} from '../audio/offline/mixBus/mixBus';
import {
    analyzeLoudness,
    normalizeToTarget,
    DEFAULT_LIMITER_SETTINGS,
    type LoudnessReport,
    type LoudnessTargetKey,
    type NormalizeResult,
} from '../audio/loudness';

/** Rates the export dialog offers explicitly; `native` goes through the pref. */
/**
 * Any positive rate. Not narrowed to 44100 | 48000: `native` resolves to
 * whatever the live context runs at (e.g. 96000 on a pro interface).
 */
export type StemExportSampleRate = number;

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
    sampleRate?: StemExportSampleRate;
    /**
     * User sample-rate policy (#1136). `native` resolves to `liveSampleRate`,
     * so an export matches the context the user is monitoring through.
     */
    sampleRatePref?: SampleRatePref;
    /**
     * `AudioContext.sampleRate` of the running engine. Defaults to the rate the
     * live context factory last recorded (`getLastLiveSampleRate`).
     */
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
     * Mix bus for the drum and master sums (#1341). Defaults to a fresh
     * `createMixBus()` — the C++ bus in a worker, or the JS path with a
     * reason — which the export disposes. An injected bus is the caller's to
     * dispose.
     */
    mixBus?: MixBus;
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
    /**
     * Sampler banks whose live sound the bank stems do not contain: HARM, a
     * note FX chain on a stretch bank, or a stretch bank the offline Rubber
     * Band host could not load (its stem is left out). Empty when none.
     */
    vocalOffline: OfflineVocalBankReport[];
    /** Which engine summed the stems, and why it fell back if it did. */
    mixBus: StemMixBusReport;
    /** Song automation lanes the stems play, and the routed ones they cannot (#1384). */
    automation: OfflineAutomationReport;
}

export interface StemMixBusReport {
    /** Engine that produced the master stem's dry sum. */
    engine: MixBusEngine;
    /** Why the native worker was not used; null when it was. */
    reason: string | null;
    /** Per-channel sample peak of the dry sum, before any master bounce. */
    dryMasterPeaks: number[];
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
    /** Linear arrangement (#1342). When present, song-mode export walks its clips. */
    arrangement?: import('../types').Arrangement;
    trackStorage: Record<TrackKey, (import('../types').PartSequence | import('../types').PartSequence[] | null)[]>;
    currentPattern: Pattern;
    tempo: number;
    /** Song pattern length (default 32) — sets each measure's length. */
    stepCount?: number;
    /** Per-track loop lengths, tiled into each measure like live playback. */
    trackLengths?: import('./songMeter').TrackLengths;
    params: StemExportParams;
    engines?: PatternRenderEngines;
    sampleBuffers?: (AudioBuffer | null)[];
    /** Live HARM state: harmony layers exist only in the realtime graph. */
    harmonizerActive?: boolean;
    /** Alignments and vowel pack for stretch banks (offline Rubber Band host). */
    vocal?: StemVocalInput;
    /** Per-track note FX chains (#1345). Defaults to the live note FX store. */
    noteFx?: SongNoteFx;
    /**
     * Song automation lanes (#1384). Defaults to the live automation store's
     * lanes — none while automation playback is off, as live.
     */
    automationLanes?: readonly UnifiedAutomationLane[];
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
    return createOfflineBuffer({ channels: 2, length: targetLength, sampleRate });
}

function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
        throw new DOMException('Export cancelled', 'AbortError');
    }
}

function alignBufferLength(buffer: AudioBuffer, targetLength: number, sampleRate: number): AudioBuffer {
    if (buffer.length === targetLength) return buffer;

    const channels = buffer.numberOfChannels;
    const out = createOfflineBuffer({ channels, length: targetLength, sampleRate });

    for (let ch = 0; ch < channels; ch++) {
        const src = buffer.getChannelData(ch);
        const dst = out.getChannelData(ch);
        const copyLen = Math.min(src.length, targetLength);
        dst.set(src.subarray(0, copyLen));
    }

    return out;
}

/** Wrap mix-bus output channels in an AudioBuffer for the WAV encoder. */
function channelsToBuffer(channels: Float32Array[], targetLength: number, sampleRate: number): AudioBuffer {
    const count = channels.length;
    const out = createOfflineBuffer({ channels: count, length: targetLength, sampleRate });
    for (let ch = 0; ch < count; ch++) {
        out.getChannelData(ch).set(channels[ch].subarray(0, out.length));
    }
    return out;
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

/** The files a stem export writes, before they are zipped. */
export interface StemFiles {
    /** `stems/<id>.wav` per stem, then `metadata.json`. */
    entries: { path: string; data: Uint8Array }[];
    report: StemExportReport;
}

/**
 * Renders dry per-track stems as aligned WAV files plus `metadata.json`.
 *
 * Per-track stems are always dry. The master stem is the sample-aligned sum of
 * them, either exclusively (`masterChain: 'dry-exclusive'`) or bounced through
 * the live patch bay's master chain (`'live-patch'`, #1233). Everything renders
 * at the rate the sample-rate policy resolves to.
 *
 * `exportStemsToZip` zips these; the agent render hook (`window.__HYPHON_AGENT__`)
 * hands them back as bytes.
 */
export async function renderStemFiles(
    input: StemExportInput,
    options: StemExportOptions = {},
): Promise<StemFiles> {
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
        { stepCount: input.stepCount, trackLengths: input.trackLengths },
        input.arrangement,
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

    // Note FX (#1345): the same chain the live step handler plays, one pass
    // per track loop — re-anchored at each measure in song mode, as live.
    const songNoteFx = input.noteFx ?? noteFxStore.exportChains();
    const noteFxFor = (track: NoteFxTrack, salt = 0) => {
        const chain = songNoteFx[track];
        if (!chainIsActive(chain)) return undefined;
        const loopLength = trackLoopLength(
            { stepCount: input.stepCount ?? NUM_STEPS, trackLengths: input.trackLengths ?? {} },
            track,
        );
        return {
            chain,
            loopLength,
            passStarts: useSongMode ? measurePassStarts(timeline.measureStepCounts, loopLength) : undefined,
            salt,
            lookup: noteFxLaneLookup(track),
        };
    };

    // Automation lanes (#1384): resolved onto the timeline exactly as the live
    // scheduler plays them, measure by measure — clip lanes (#1494) layered
    // over the song lanes on the steps their clips cover.
    const automationLanes = input.automationLanes
        ?? (automationStore.getState().playbackEnabled ? automationStore.exportLanes() : []);
    const automation = resolveSynthLaneAutomation(
        automationLanes,
        {
            totalSteps: timeline.totalSteps,
            stepCount: input.stepCount ?? NUM_STEPS,
            songMode: useSongMode,
            arrangement: useSongMode ? input.arrangement : undefined,
        },
        [
            { target: 'synthA', waveform: input.params.synthA.waveform ?? '' },
            { target: 'synthB', waveform: input.params.synthB.waveform ?? '' },
            { target: 'bass2', waveform: input.params.bass2.waveform ?? '' },
        ],
    );

    const stems = new Map<StemId, AudioBuffer>();
    /** Stretch banks the offline vocal host could not render: no stem, never dry. */
    const vocalUnsupported = new Map<number, string>();
    const totalStages = STEM_RENDER_ORDER.length;

    // The dry master is built as the stems arrive (#1341): each audible stem
    // is streamed into the bus right after it renders, so the C++ sum runs in
    // the worker while the next stem renders. Silenced stems add nothing —
    // they are zeros, and x + 0 is x. Summation order is STEM_RENDER_ORDER,
    // as before, so the JS path is bit-identical to the old main-thread loop.
    const ownsBus = !options.mixBus;
    const bus = options.mixBus ?? (await createMixBus());
    const masterMix = bus.begin(targetLength, 2);
    let dryMaster: { engine: MixBusEngine; peaks: number[] } | null = null;

    try {
        for (let stage = 0; stage < STEM_RENDER_ORDER.length; stage++) {
            throwIfAborted(signal);
            const { id, label } = STEM_RENDER_ORDER[stage];
            onProgress?.(stage / totalStages, label);

            let buffer: AudioBuffer;
            /** Rendered (not a silent placeholder) — only these feed the master. */
            let audible = false;

            switch (id) {
                case 'partA':
                    audible = isAudible('partA');
                    buffer = audible
                        ? await renderSynthPattern(input.params.synthA, {
                              ...renderOpts,
                              sequence: timeline.sequences.partA,
                              noteFx: noteFxFor('partA'),
                              automation: automation.byTarget.synthA,
                          })
                        : silentBuffer(targetLength, sampleRate);
                    break;
                case 'partB':
                    audible = isAudible('partB');
                    buffer = audible
                        ? await renderSynthPattern(input.params.synthB, {
                              ...renderOpts,
                              sequence: timeline.sequences.partB,
                              noteFx: noteFxFor('partB'),
                              automation: automation.byTarget.synthB,
                          })
                        : silentBuffer(targetLength, sampleRate);
                    break;
                case 'bass2':
                    audible = isAudible('bass2');
                    buffer = audible
                        ? await renderSynthPattern(bass2ToSynthParams(input.params.bass2), {
                              ...renderOpts,
                              sequence: timeline.sequences.bass2,
                              noteFx: noteFxFor('bass2'),
                              automation: automation.byTarget.bass2,
                          })
                        : silentBuffer(targetLength, sampleRate);
                    break;
                case 'drums': {
                    // The drum stem mixes four tracks, so each is gated on its own.
                    const drumMix = bus.begin(targetLength, 2);
                    try {
                        const drums = [
                            ['kick', input.params.kick],
                            ['snare', input.params.snare],
                            ['closedHat', input.params.closedHat],
                            ['openHat', input.params.openHat],
                        ] as const;
                        for (const [track, params] of drums) {
                            if (!isAudible(track)) continue;
                            const rendered = await renderDrumPattern(track, params, {
                                ...renderOpts,
                                sequence: timeline.sequences[track],
                            });
                            drumMix.add(bufferChannels(rendered));
                            audible = true;
                            throwIfAborted(signal);
                        }
                        buffer = channelsToBuffer((await drumMix.finish()).channels, targetLength, sampleRate);
                    } finally {
                        drumMix.discard();
                    }
                    break;
                }
                default:
                    if (id.startsWith('sampler-bank-')) {
                        const bankIndex = Number(id.replace('sampler-bank-', '')) - 1;
                        audible = isAudible('sampler');
                        const bankStem = audible
                            ? await renderSamplerBankStem({
                                  bankIndex,
                                  sequence: timeline.sequences.sampler[bankIndex],
                                  sampleBuffer: input.sampleBuffers?.[bankIndex] ?? null,
                                  params: input.params.sampler[bankIndex],
                                  tempo: input.tempo,
                                  sampleRate,
                                  signal,
                                  noteFx: noteFxFor('sampler', bankIndex),
                                  vocal: input.vocal,
                              })
                            : { kind: 'rendered' as const, buffer: silentBuffer(targetLength, sampleRate) };
                        if (bankStem.kind === 'unsupported') {
                            vocalUnsupported.set(bankIndex, bankStem.reason);
                            continue;
                        }
                        buffer = bankStem.buffer;
                    } else {
                        const mixed = await masterMix.finish();
                        dryMaster = { engine: mixed.engine, peaks: mixed.peaks };
                        buffer = channelsToBuffer(mixed.channels, targetLength, sampleRate);
                    }
                    break;
            }

            const aligned = alignBufferLength(buffer, targetLength, sampleRate);
            stems.set(id, aligned);
            if (audible) masterMix.add(bufferChannels(aligned));
        }
    } finally {
        masterMix.discard();
        if (ownsBus) bus.dispose();
    }

    const mixBusReport: StemMixBusReport = {
        engine: dryMaster?.engine ?? bus.status().engine,
        reason: bus.status().reason,
        dryMasterPeaks: dryMaster?.peaks ?? [],
    };

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

    const vocalOffline = isAudible('sampler')
        ? describeOfflineVocalSupport({
              sampler: input.params.sampler,
              sequences: timeline.sequences.sampler,
              harmonizerActive: input.harmonizerActive,
              unsupported: vocalUnsupported,
              noteFxBanks: new Set(input.params.sampler.flatMap((_, bank) => (noteFxFor('sampler', bank) ? [bank] : []))),
          })
        : [];

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
        /** Sampler banks the bounce does not match, and stretch banks left out (#1273). */
        vocalOffline,
        /** Engine that summed the dry stems (#1341) and the dry master's sample peaks. */
        mixBus: mixBusReport,
        /** Automation lanes the stems play, and the routed ones they cannot (#1384). */
        automation: automation.report,
        stems: Array.from(stems.keys()),
        silencedTracks: (
            ['partA', 'partB', 'bass2', 'kick', 'snare', 'closedHat', 'openHat', 'sampler'] as TrackKey[]
        ).filter((t) => !isAudible(t)),
    };

    zipEntries.push({
        path: 'metadata.json',
        data: new TextEncoder().encode(JSON.stringify(metadata, null, 2)),
    });

    const report: StemExportReport = {
        sampleRate,
        sampleRatePref,
        bitDepth,
        routing,
        routingNote,
        offlineGraph,
        vocalOffline,
        mixBus: mixBusReport,
        automation: automation.report,
    };
    options.onReport?.(report);

    throwIfAborted(signal);
    return { entries: zipEntries, report };
}

/** Renders the stems (see `renderStemFiles`) and returns them as a ZIP blob. */
export async function exportStemsToZip(
    input: StemExportInput,
    options: StemExportOptions = {},
): Promise<Blob> {
    const { entries } = await renderStemFiles(input, options);
    options.onProgress?.(1, 'Creating ZIP…');
    return createZipBlob(entries);
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
