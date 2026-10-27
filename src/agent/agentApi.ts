/**
 * The agent render hook's API (`window.__HYPHON_AGENT__`), built over the
 * latest committed app state. `AgentBridge.tsx` mounts it; see that file.
 *
 * Every method calls the function behind the matching UI action — the import
 * modal's load step, the export modal's `live-patch` stem render, the bottom
 * bar's RBS / MIDI / XM builders — so what an agent hears is what a user
 * would export.
 */

import type { AppState } from '../contexts/AppStateContext';
import { transportMixStore } from '../stores/transportMixStore';
import { engineDegradationStore, type DegradationIssue } from '../stores/engineDegradationStore';
import { getStoredSampleRatePref } from '../utils/audioContextPolicy';
import { audioBufferToWav, type WavBitDepth } from '../utils/audioExport';
import { createOfflineBuffer } from '../audio/offline/createOfflineContext';
import type { StemExportInput, StemExportReport } from '../utils/stemExport';
import type { ExpressionLedTarget } from '../types/engine';
import {
    bytesToBase64,
    convertAgentSong,
    type AgentImportOptions,
    type AgentImportReport,
} from './agentSong';
import { captureTap } from './liveCapture';
import { getE2eAudioTap } from '../e2e/probe';

export interface AgentFile {
    /** `stems/master.wav`, `stems/partA.wav`, … as in the export modal's ZIP. */
    path: string;
    base64: string;
}

export interface AgentRenderOptions {
    /** Return every stem, not only the master. */
    stems?: boolean;
    bitDepth?: WavBitDepth;
}

export interface AgentRenderResult {
    files: AgentFile[];
    /** What the export modal reports in its toast. */
    report: StemExportReport;
    /** The ZIP's `metadata.json`: loudness, totalSteps, measureCount, silenced tracks, … */
    metadata: Record<string, unknown>;
    /** Engines running on a fallback (e.g. a macro model rendered as its fallback waveform). */
    engineIssues: DegradationIssue[];
}

export interface AgentSampleLoadResult {
    /** Sampler bank the phrase went into (the active bank, as the panel's file picker). */
    bank: number;
    sampleRate: number;
    seconds: number;
    /** A phoneme alignment exists for the bank after loading. */
    aligned: boolean;
}

export type AgentExportResult =
    | { ok: true; filename: string; base64: string; warnings: string[] }
    | { ok: false; error: string; warnings: string[] };

export interface AgentCaptureOptions {
    /** Audio-clock seconds to record (default: one pass of the song + 0.5 s). */
    seconds?: number;
    /**
     * What to record (default the master). A 303 track records its voice's
     * own output (`open303-lead303` / `-bass1` / `-bass2`), a drum track the
     * native drum kit, any other track its monitor analyser.
     */
    track?: ExpressionLedTarget | 'master';
}

export interface AgentCaptureResult {
    base64: string;
    sampleRate: number;
    seconds: number;
    /** The tap actually recorded (`master` when the track had none). */
    source: string;
}

export interface HyphonAgentApi {
    version: 1;
    importAISong: (song: string | object, options?: AgentImportOptions) => Promise<AgentImportReport>;
    renderMix: (options?: AgentRenderOptions) => Promise<AgentRenderResult>;
    exportRbs: () => Promise<AgentExportResult>;
    exportMidi: () => Promise<AgentExportResult>;
    exportXm: () => Promise<AgentExportResult>;
    captureLive: (options?: AgentCaptureOptions) => Promise<AgentCaptureResult>;
    /** Load a WAV into the active sampler bank, like the sampler panel's file picker. */
    loadSamplerPhrase: (wavBase64: string) => Promise<AgentSampleLoadResult>;
}

declare global {
    interface Window {
        __HYPHON_AGENT__?: HyphonAgentApi;
    }
}

/** The latest committed app state, published by `AgentBridge` on every commit. */
export interface AgentStateHandle {
    getSnapshot: () => AppState;
    subscribe: (listener: () => void) => () => void;
    publish: (state: AppState) => void;
}

export function createAgentStateHandle(initial: AppState): AgentStateHandle {
    let current = initial;
    const listeners = new Set<() => void>();
    return {
        getSnapshot: () => current,
        subscribe: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        publish: (state) => {
            if (state === current) return;
            current = state;
            for (const listener of [...listeners]) listener();
        },
    };
}

type Store = AgentStateHandle;

/** Resolve once the store has been quiet for `quietMs` (a load commits over several renders). */
function waitForCommit(store: Store, quietMs = 200, timeoutMs = 5000): Promise<void> {
    return new Promise((resolve) => {
        let unsubscribe = () => {};
        let quiet: ReturnType<typeof setTimeout>;
        const done = () => {
            clearTimeout(quiet);
            clearTimeout(hard);
            unsubscribe();
            resolve();
        };
        const hard = setTimeout(done, timeoutMs);
        quiet = setTimeout(done, quietMs);
        unsubscribe = store.subscribe(() => {
            clearTimeout(quiet);
            quiet = setTimeout(done, quietMs);
        });
    });
}

/** The export modal's input, from the state `ExportModalBody` passes it. */
function stemInput(s: AppState): StemExportInput {
    const meter = transportMixStore.meterRef.current;
    return {
        songStructure: s.songStructure,
        arrangement: s.arrangement,
        trackStorage: s.trackStorage,
        currentPattern: s.pattern,
        tempo: s.tempo,
        params: {
            synthA: s.synthA, synthB: s.synthB, bass2: s.bass2,
            kick: s.kick, snare: s.snare, closedHat: s.closedHat, openHat: s.openHat,
            sampler: s.sampler,
        },
        engines: {
            webGpuEngine: s.audioEngine?.webGpuEngine,
            wasmEngine: s.audioEngine?.wasmEngine,
            pyodide: s.pyodide,
        },
        sampleBuffers: s.sampleBuffers,
        harmonizerActive: s.isHarmonizeActive,
        vocal: {
            alignments: s.sampler.map((_, bank) => s.audioEngine?.getAlignment?.(bank) ?? null),
            tuning: s.currentScale,
        },
        stepCount: meter.stepCount,
        trackLengths: meter.trackLengths,
    };
}

async function fileResult(build: () => Promise<{ success: true; blob: Blob; filename: string; warnings: string[] } | { success: false; error: string; warnings: string[] }>): Promise<AgentExportResult> {
    try {
        const result = await build();
        if (!result.success) return { ok: false, error: result.error, warnings: result.warnings };
        const bytes = new Uint8Array(await result.blob.arrayBuffer());
        return { ok: true, filename: result.filename, base64: bytesToBase64(bytes), warnings: result.warnings };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error), warnings: [] };
    }
}

const OPEN303_TAPS: Partial<Record<ExpressionLedTarget, 'synthA' | 'synthB' | 'bass2'>> = { synthA: 'synthA', synthB: 'synthB', bass2: 'bass2' };
const OPEN303_TAP_NAMES = { synthA: 'open303-lead303', synthB: 'open303-bass1', bass2: 'open303-bass2' } as const;
const DRUM_TRACKS = new Set<ExpressionLedTarget>(['kick', 'snare', 'closedHat', 'openHat']);
const is303 = (waveform: string | undefined) => waveform === '303-saw' || waveform === '303-sqr';

/** The node `captureLive` records for `track`, and its name; null → the master. */
function liveTap(s: AppState, track: ExpressionLedTarget): { node: AudioNode; source: string } | null {
    const synth = OPEN303_TAPS[track];
    if (synth && is303(s[synth].waveform)) {
        const name = OPEN303_TAP_NAMES[synth];
        const node = getE2eAudioTap(name);
        if (node) return { node, source: name };
    }
    if (DRUM_TRACKS.has(track)) {
        const node = getE2eAudioTap('drumkit-worklet');
        if (node) return { node, source: 'drumkit-worklet' };
    }
    const analyser = s.audioEngine?.trackAnalysers?.[track];
    return analyser ? { node: analyser, source: `${track}-monitor` } : null;
}

export function createAgentApi(store: Store): HyphonAgentApi {
    const state = () => store.getSnapshot();

    return {
        version: 1,

        async importAISong(song, options = {}) {
            const { song: converted, report } = convertAgentSong(song, options);
            if (!converted) return report;
            const s = state();
            if (s.isPlaying) await s.handlePlayToggle();
            await s.loadImportedAISong(converted);
            await waitForCommit(store);
            return report;
        },

        async renderMix(options = {}) {
            const s = state();
            const { renderStemFiles } = await import('../utils/stemExport');
            // The export modal's defaults: song mode, live-patch master, the
            // stored sample-rate policy against the running context.
            const { entries, report } = await renderStemFiles(stemInput(s), {
                sampleRatePref: getStoredSampleRatePref(),
                liveSampleRate: s.audioEngine?.context?.sampleRate ?? null,
                bitDepth: options.bitDepth ?? 16,
                useSongMode: true,
                masterChain: 'live-patch',
            });
            const metadataEntry = entries.find((e) => e.path === 'metadata.json');
            const metadata = metadataEntry
                ? (JSON.parse(new TextDecoder().decode(metadataEntry.data)) as Record<string, unknown>)
                : {};
            const files = entries
                .filter((e) => e.path.endsWith('.wav') && (options.stems || e.path === 'stems/master.wav'))
                .map((e) => ({ path: e.path, base64: bytesToBase64(e.data) }));
            const engineIssues = engineDegradationStore.getIssues().filter((issue) => issue.status === 'active');
            return { files, report, metadata, engineIssues };
        },

        async loadSamplerPhrase(wavBase64) {
            const s = state();
            const context = s.audioEngine?.context;
            if (!context) throw new Error('audio engine is not initialised');
            const bytes = Uint8Array.from(atob(wavBase64), (c) => c.charCodeAt(0));
            const buffer = await context.decodeAudioData(bytes.buffer);
            const bank = s.activeSamplerBank;
            await s.handleLoadSample(`bank_${bank}`, buffer);
            // prepareVocal runs after the load resolves; give it its commit.
            await waitForCommit(store);
            const aligned = !!state().audioEngine?.getAlignment?.(bank);
            return { bank, sampleRate: buffer.sampleRate, seconds: buffer.duration, aligned };
        },

        exportRbs: () => fileResult(() => state().buildRbsExport()),
        exportMidi: () => fileResult(() => state().buildSmfExport()),

        async exportXm() {
            try {
                const result = await state().buildXmExport();
                return {
                    ok: true,
                    filename: 'song.xm',
                    base64: bytesToBase64(result.bytes),
                    warnings: result.truncationMessage ? [result.truncationMessage] : [],
                };
            } catch (error) {
                return { ok: false, error: error instanceof Error ? error.message : String(error), warnings: [] };
            }
        },

        async captureLive(options = {}) {
            const s = state();
            const engine = s.audioEngine;
            if (!engine?.context) throw new Error('audio engine is not initialised');
            const track = options.track ?? 'master';
            const trackTap = track === 'master' ? null : liveTap(s, track);
            const tap = trackTap?.node ?? engine.analyserNode;
            if (!tap) throw new Error('no master monitor tap to record');

            const meter = transportMixStore.meterRef.current;
            const measures = Math.max(1, s.isSongModeActive ? s.songStructure.length : 1);
            const seconds = options.seconds ?? (measures * meter.stepCount * 15) / s.tempo + 0.5;

            if (s.isPlaying) await s.handlePlayToggle();
            await waitForCommit(store, 100);
            let started = false;
            try {
                const { left, right, sampleRate } = await captureTap(engine.context, tap, seconds, () => {
                    void state().handlePlayToggle();
                    started = true;
                });
                const buffer = createOfflineBuffer({ channels: 2, length: left.length, sampleRate });
                buffer.copyToChannel(left, 0);
                buffer.copyToChannel(right, 1);
                const wav = new Uint8Array(await (await audioBufferToWav(buffer, { bitDepth: 16 })).arrayBuffer());
                return { base64: bytesToBase64(wav), sampleRate, seconds, source: trackTap?.source ?? 'master' };
            } finally {
                if (started) {
                    await waitForCommit(store, 50);
                    if (state().isPlaying) await state().handlePlayToggle();
                }
            }
        },
    };
}
