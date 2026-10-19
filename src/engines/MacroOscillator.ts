/**
 * MacroOscillator.ts
 *
 * One macro part (SYNTH A or SYNTH B): a `macro-processor` AudioWorkletNode
 * driving a polyphonic, stereo macro_* voice inside hyphon_native.wasm
 * (emscripten/macro_wrapper.cpp — Plaits DSP, MIT).
 *
 * Unlike the Prophecy part, every note and param message carries its
 * AudioContext time, so the worklet lands it on its own frame instead of
 * whenever the message happens to arrive. Params are diffed against what was
 * last sent: applying a full patch per note costs nothing when nothing moved.
 */

import {
    engineTelemetry,
    loadHyphonWasmExportMap,
    logEngineFallback,
    resolvePublicAsset,
} from '../utils/engineTelemetry';
import {
    formatMissingWasmExports,
    MACRO_REQUIRED_WASM_EXPORTS,
    macroExportMapInsufficient,
    normalizeWasmExports,
    wasmExportNameSnapshot,
    HYPHON_NATIVE_ARTIFACTS,
    type HyphonNativeArtifact,
} from '../audio-worklets/hyphonNativeImports';
import { hyphonNativeBackendName, resolveHyphonNativeArtifact } from './hyphonNativeVariant';
import { attachWorkletPerf } from '../utils/workletPerfBridge';
import type { MacroParamId } from './MacroParams';

/** Milliseconds to wait for the macro worklet to signal readiness. */
const MACRO_INIT_TIMEOUT_MS = 8000;

export interface MacroNoteOptions {
    /** Per-note TIMBRE offset, −1…1 (a step's `timbre` − 0.5). */
    timbre?: number;
    /** Per-note MORPH offset, −1…1. */
    morph?: number;
    /** Glide in from the part's last pitch; legato when the part is mono. */
    slide?: boolean;
    /** Fine pitch in semitones. */
    fine?: number;
}

export class MacroOscillator {
    private workletNode: AudioWorkletNode | null = null;
    private outputNode: GainNode | null = null;
    private detachPerf: (() => void) | null = null;
    private audioContext: AudioContext | null = null;

    /** Last value posted per MacroParam id — the diff base for setParams. */
    private readonly sent = new Map<number, number>();
    /** Reused flat [id, value, …] buffer for set-params. */
    private readonly pending: number[] = [];

    public isReady = false;
    /** macro_engine_count() of the loaded wasm (0 until ready). */
    public engineCount = 0;

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    /**
     * Fetch hyphon_native for this context's threading profile, load the
     * worklet and create the voice. `true` when ready; `false` (with a logged
     * fallback naming the cause) otherwise — callers substitute, never go silent.
     */
    async init(audioContext: AudioContext, workletUrl: string, label = 'macro'): Promise<boolean> {
        this.audioContext = audioContext;
        this.outputNode = audioContext.createGain();

        if (!audioContext.audioWorklet || !workletUrl) {
            logEngineFallback('macro', 'wasm-worklet', `${label}: ${!audioContext.audioWorklet ? 'AudioWorklet unavailable' : 'worklet URL missing'}`);
            return false;
        }

        try {
            const { artifact, reason } = resolveHyphonNativeArtifact(audioContext);
            const wasmUrl = resolvePublicAsset(artifact.wasm);
            const response = await fetch(wasmUrl);
            if (!response.ok) {
                logEngineFallback('macro', 'wasm-worklet', `${label}: ${artifact.wasm} fetch HTTP ${response.status} (${wasmUrl})`);
                return false;
            }
            const wasmBytes = await response.arrayBuffer();
            console.log(`[MacroOscillator] ${label}: ${wasmBytes.byteLength} bytes (${artifact.threading}: ${reason})`);
            const exportMap = await this.fetchExportMap(wasmBytes, artifact, label);
            return this._initWithWasmBytes(audioContext, workletUrl, wasmBytes, exportMap, artifact, label);
        } catch (e) {
            logEngineFallback('macro', 'wasm-worklet', `${label}: init exception before worklet load`, e);
            return false;
        }
    }

    private async fetchExportMap(
        wasmBytes: ArrayBuffer,
        artifact: HyphonNativeArtifact,
        label: string,
    ): Promise<Record<string, string>> {
        const map = await loadHyphonWasmExportMap(artifact.threading);
        const wasmModule = await WebAssembly.compile(wasmBytes);
        if (Object.keys(map).length > 0 && macroExportMapInsufficient(wasmModule, map)) {
            // Most likely a hyphon_native built before the macro family: the
            // worklet will refuse it by name and the parts substitute.
            const snapshot = wasmExportNameSnapshot(wasmModule);
            const resolved = normalizeWasmExports(snapshot, map) as Record<string, unknown>;
            const missing = MACRO_REQUIRED_WASM_EXPORTS.filter((name) => typeof resolved[name] !== 'function');
            logEngineFallback(
                'macro',
                'wasm-worklet',
                `${label}: export map did not resolve macro_* against WASM. ` +
                    formatMissingWasmExports(snapshot, missing),
            );
        }
        return map;
    }

    async _initWithWasmBytes(
        audioContext: AudioContext,
        workletUrl: string,
        wasmBytes: ArrayBuffer,
        exportMap: Record<string, string> = {},
        artifact: HyphonNativeArtifact = HYPHON_NATIVE_ARTIFACTS.pthread,
        label = 'macro',
    ): Promise<boolean> {
        try {
            await audioContext.audioWorklet.addModule(workletUrl);
            this.workletNode = new AudioWorkletNode(audioContext, 'macro-processor', {
                outputChannelCount: [2],
            });
            if (!this.outputNode) throw new Error('outputNode not initialized');
            this.workletNode.connect(this.outputNode);
            // CPU + underruns per block into the Engine HUD's worklet table.
            this.detachPerf = attachWorkletPerf(this.workletNode, 'macro');

            this.workletNode.port.postMessage({
                type: 'init-wasm',
                data: {
                    wasmBytes,
                    sampleRate: audioContext.sampleRate,
                    isThreaded: artifact.sharedMemory,
                    variant: artifact.threading,
                    memoryPages: artifact.minMemoryPages,
                    exportMap,
                },
            });

            const ready = await new Promise<boolean>((resolve) => {
                let settled = false;
                const node = this.workletNode!;
                node.port.onmessage = (e: MessageEvent) => {
                    const msg = e.data as { type?: string; heap?: unknown; data?: unknown; engineCount?: number; error?: unknown };
                    if (msg.type === 'ready') {
                        settled = true;
                        this.engineCount = typeof msg.engineCount === 'number' ? msg.engineCount : 0;
                        try { engineTelemetry.recordHyphonNativeHeap(msg.heap as never); } catch { /* telemetry only */ }
                        resolve(true);
                    } else if (msg.type === 'hyphon-heap') {
                        try { engineTelemetry.recordHyphonNativeHeap(msg.data as never); } catch { /* telemetry only */ }
                    } else if (msg.type === 'error') {
                        settled = true;
                        const detail = typeof msg.error === 'string' ? msg.error : 'unknown worklet error';
                        logEngineFallback('macro', 'wasm-worklet', `${label}: worklet init-wasm error: ${detail}`);
                        resolve(false);
                    }
                };
                setTimeout(() => {
                    if (!settled) {
                        logEngineFallback('macro', 'wasm-worklet', `${label}: worklet ready timeout (${MACRO_INIT_TIMEOUT_MS}ms)`);
                        resolve(false);
                    }
                }, MACRO_INIT_TIMEOUT_MS);
            });

            if (!ready) {
                this.cleanupWorklet();
                return false;
            }
            this.isReady = true;
            try {
                engineTelemetry.registerResolution(
                    'macro',
                    hyphonNativeBackendName(artifact.threading),
                    `${label} worklet-ready (${artifact.wasm}, ${this.engineCount} models)`,
                );
            } catch { /* telemetry only */ }
            return true;
        } catch (e) {
            logEngineFallback('macro', 'wasm-worklet', `${label}: AudioWorklet.addModule or node creation failed`, e);
            this.cleanupWorklet();
            return false;
        }
    }

    // ── Notes ─────────────────────────────────────────────────────────────────

    /** @param velocity 0–1. */
    noteOn(midiNote: number, velocity: number, audioTime?: number, opts: MacroNoteOptions = {}): void {
        if (!this.isReady || !this.workletNode) return;
        this.workletNode.port.postMessage({
            type: 'noteOn',
            data: { note: midiNote, velocity, audioTime, timbre: opts.timbre, morph: opts.morph, slide: opts.slide, fine: opts.fine },
        });
    }

    noteOff(midiNote: number, audioTime?: number): void {
        if (!this.isReady || !this.workletNode) return;
        this.workletNode.port.postMessage({ type: 'noteOff', data: { note: midiNote, audioTime } });
    }

    /** MIDI All Notes Off at `audioTime`: gates close, tails ring out. */
    releaseAll(audioTime?: number): void {
        if (!this.workletNode) return;
        this.workletNode.port.postMessage({ type: 'releaseAll', data: { audioTime } });
    }

    /** Transport stop: drop scheduled notes, fade every voice out over 2 ms. */
    allNotesOff(): void {
        if (!this.workletNode) return;
        this.workletNode.port.postMessage({ type: 'allNotesOff', data: {} });
    }

    // ── Parameters ────────────────────────────────────────────────────────────

    /**
     * Post every param whose value differs from what was last sent, all landing
     * on `audioTime`. Before the worklet is ready nothing is sent and nothing is
     * recorded, so the first call after ready carries the whole patch.
     */
    setParams(params: ReadonlyArray<readonly [MacroParamId, number]>, audioTime?: number): void {
        if (!this.isReady || !this.workletNode) return;
        const pending = this.pending;
        pending.length = 0;
        for (const [id, value] of params) {
            if (!Number.isFinite(value) || this.sent.get(id) === value) continue;
            this.sent.set(id, value);
            pending.push(id, value);
        }
        if (pending.length === 0) return;
        this.workletNode.port.postMessage({ type: 'set-params', data: { params: pending.slice(), audioTime } });
    }

    /**
     * Knob moves: post the params that changed, in effect now, overriding any
     * value a note already queued for them (macro_set_param_now).
     */
    setParamsNow(params: ReadonlyArray<readonly [MacroParamId, number]>): void {
        if (!this.isReady || !this.workletNode) return;
        const pending = this.pending;
        pending.length = 0;
        for (const [id, value] of params) {
            if (!Number.isFinite(value) || this.sent.get(id) === value) continue;
            this.sent.set(id, value);
            pending.push(id, value);
        }
        if (pending.length === 0) return;
        this.workletNode.port.postMessage({ type: 'set-params-now', data: { params: pending.slice() } });
    }

    /** One param at `audioTime` (automation). Always sent. */
    setParam(paramId: MacroParamId, value: number, audioTime?: number): void {
        if (!this.isReady || !this.workletNode || !Number.isFinite(value)) return;
        this.sent.set(paramId, value);
        this.workletNode.port.postMessage({ type: 'set-param', data: { paramId, value, audioTime } });
    }

    // ── Routing ───────────────────────────────────────────────────────────────

    connect(dest: AudioNode): void {
        this.outputNode?.connect(dest);
    }

    disconnect(): void {
        this.outputNode?.disconnect();
    }

    /** The node to plug into a patch socket. */
    get output(): GainNode | null {
        return this.outputNode;
    }

    // ── Cleanup ───────────────────────────────────────────────────────────────

    cleanup(): void {
        this.cleanupWorklet();
        this.outputNode?.disconnect();
        this.outputNode = null;
        this.isReady = false;
        this.sent.clear();
        this.audioContext = null;
    }

    private cleanupWorklet(): void {
        this.detachPerf?.();
        this.detachPerf = null;
        if (this.workletNode) {
            // hyphon_native is shared by every voice in the audio session: ask the
            // processor to destroy its handle before the port goes away.
            this.workletNode.port.postMessage({ type: 'dispose' });
            this.workletNode.disconnect();
            this.workletNode.port.close();
            this.workletNode = null;
        }
    }
}
