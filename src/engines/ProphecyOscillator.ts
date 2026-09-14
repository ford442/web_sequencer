/**
 * ProphecyOscillator.ts
 *
 * TypeScript engine class for the Korg Prophecy formant synthesizer.
 * Communicates with the `prophecy-processor` AudioWorklet which drives
 * the `prophecy_*` C API inside hyphon_native.wasm.
 *
 * Usage:
 *   const osc = new ProphecyOscillator();
 *   await osc.init(audioContext, '/prophecy-processor.js');
 *   osc.connect(audioContext.destination);
 *   osc.noteOn(60, 100);
 */

import type { ProphecyParams } from './ProphecyParams';
import { ProphecyParam, DEFAULT_PROPHECY_PARAMS } from './ProphecyParams';

import {
    engineTelemetry,
    loadHyphonWasmExportMap,
    logEngineFallback,
    resolvePublicAsset,
} from '../utils/engineTelemetry';
import {
    formatMissingWasmExports,
    PROPHECY_REQUIRED_WASM_EXPORTS,
    prophecyExportMapInsufficient,
    wasmExportNameSnapshot,
    HYPHON_NATIVE_ARTIFACTS,
    type HyphonNativeArtifact,
} from '../audio-worklets/hyphonNativeImports';
import { hyphonNativeBackendName, resolveHyphonNativeArtifact } from './hyphonNativeVariant';

/** Milliseconds to wait for the Prophecy worklet to signal readiness. */
const PROPHECY_INIT_TIMEOUT_MS = 8000;

export class ProphecyOscillator {
    private workletNode:  AudioWorkletNode | null = null;
    private gainNode:     GainNode         | null = null;
    private outputNode:   GainNode         | null = null;
    private audioContext: AudioContext     | null = null;

    /** Snapshot of the current parameter state — applied once the worklet is ready. */
    private params: ProphecyParams = { ...DEFAULT_PROPHECY_PARAMS };

    public isReady: boolean = false;

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    /**
     * Initialize the engine.
     *
     * @param audioContext  The Web Audio context to attach to.
     * @param workletUrl    URL of the compiled `prophecy-processor.js` worklet module.
     * @returns             `true` when the worklet is ready; `false` on fatal failure.
     *
     * Prophecy shares the audio session's hyphon_native instance with the 303
     * voices, so it loads whichever profile (pthread / st) the context is bound to.
     */
    async init(audioContext: AudioContext, workletUrl: string): Promise<boolean> {
        this.audioContext = audioContext;

        this.outputNode = audioContext.createGain();
        this.gainNode   = audioContext.createGain();
        this.gainNode.gain.value = 1.0;
        this.gainNode.connect(this.outputNode);

        if (!audioContext.audioWorklet || !workletUrl) {
            logEngineFallback(
                'prophecy',
                'wasm-worklet',
                !audioContext.audioWorklet ? 'AudioWorklet unavailable' : 'worklet URL missing',
            );
            return false;
        }

        try {
            const { artifact, reason } = resolveHyphonNativeArtifact(audioContext);
            const wasmUrl = resolvePublicAsset(artifact.wasm);
            console.log(`[ProphecyOscillator] Fetching WASM: ${wasmUrl} (${artifact.threading}: ${reason})`);
            const response = await fetch(wasmUrl);
            if (!response.ok) {
                logEngineFallback('prophecy', 'wasm-worklet', `${artifact.wasm} fetch HTTP ${response.status} (${wasmUrl})`);
                return false;
            }

            const wasmBytes = await response.arrayBuffer();
            console.log(`[ProphecyOscillator] Fetched ${wasmBytes.byteLength} bytes`);

            const exportMap = await this.fetchExportMap(wasmBytes, artifact);
            return this._initWithWasmBytes(audioContext, workletUrl, wasmBytes, exportMap, artifact);

        } catch (e) {
            logEngineFallback('prophecy', 'wasm-worklet', 'init exception before worklet load', e);
            return false;
        }
    }

    /**
     * Complete worklet initialisation given pre-fetched WASM bytes.
     * Extracted so the init path stays testable without a real network.
     */
    private async fetchExportMap(
        wasmBytes: ArrayBuffer,
        artifact: HyphonNativeArtifact,
    ): Promise<Record<string, string>> {
        const map = await loadHyphonWasmExportMap(artifact.threading);
        const mapUrl = resolvePublicAsset(artifact.exportMap);
        const glueUrl = resolvePublicAsset(artifact.glue);
        const wasmModule = await WebAssembly.compile(wasmBytes);
        const rawExports = wasmExportNameSnapshot(wasmModule);

        if (Object.keys(map).length === 0) {
            logEngineFallback(
                'prophecy',
                'wasm-worklet',
                `${artifact.exportMap} empty and glue parse found no exports ` +
                `(tried ${mapUrl} and ${glueUrl}). ` +
                formatMissingWasmExports(rawExports, [...PROPHECY_REQUIRED_WASM_EXPORTS]),
            );
            return map;
        }

        if (prophecyExportMapInsufficient(wasmModule, map)) {
            logEngineFallback(
                'prophecy',
                'wasm-worklet',
                `export map did not resolve prophecy_* against WASM. ` +
                formatMissingWasmExports(rawExports, [...PROPHECY_REQUIRED_WASM_EXPORTS]),
            );
        }

        return map;
    }

    async _initWithWasmBytes(
        audioContext: AudioContext,
        workletUrl:   string,
        wasmBytes:    ArrayBuffer,
        exportMap:    Record<string, string> = {},
        artifact:     HyphonNativeArtifact = HYPHON_NATIVE_ARTIFACTS.pthread,
    ): Promise<boolean> {
        try {
            await audioContext.audioWorklet.addModule(workletUrl);

            this.workletNode = new AudioWorkletNode(audioContext, 'prophecy-processor', {
                outputChannelCount: [2],
            });

            // Both profiles import memory; the selection (not the import table,
            // which does not report `shared`) decides shared vs plain + page floor.
            console.log(`[ProphecyOscillator] WASM variant: ${artifact.threading}`);

            this.workletNode.port.postMessage({
                type: 'init-wasm',
                data: {
                    wasmBytes,
                    sampleRate: audioContext.sampleRate,
                    isThreaded:  artifact.sharedMemory,
                    variant:     artifact.threading,
                    memoryPages: artifact.minMemoryPages,
                    exportMap,
                },
            });

            if (!this.gainNode) throw new Error('gainNode not initialized');
            this.workletNode.connect(this.gainNode);

            const initSuccess = await new Promise<boolean>((resolve) => {
                let readyReceived = false;

                this.workletNode!.port.onmessage = (e) => {
                    if (e.data.type === 'ready') {
                        readyReceived = true;
                        console.log('[ProphecyOscillator] Engine ready');
                        try { engineTelemetry.recordHyphonNativeHeap(e.data.heap); } catch (_) {}
                        resolve(true);
                    } else if (e.data.type === 'hyphon-heap') {
                        try { engineTelemetry.recordHyphonNativeHeap(e.data.data); } catch (_) {}
                    } else if (e.data.type === 'error') {
                        const payload = e.data as { error?: unknown };
                        const errDetail =
                            typeof payload.error === 'string'
                                ? payload.error
                                : payload.error != null
                                  ? String(payload.error)
                                  : 'unknown worklet error';
                        logEngineFallback(
                            'prophecy',
                            'wasm-worklet',
                            `worklet init-wasm error: ${errDetail}`,
                        );
                        resolve(false);
                    }
                };

                setTimeout(() => {
                    if (!readyReceived) {
                        logEngineFallback('prophecy', 'wasm-worklet', `worklet ready timeout (${PROPHECY_INIT_TIMEOUT_MS}ms)`);
                        resolve(false);
                    }
                }, PROPHECY_INIT_TIMEOUT_MS);
            });

            if (!initSuccess) {
                logEngineFallback('prophecy', 'wasm-worklet', 'worklet never reached ready state');
                this.cleanupWorklet();
                return false;
            }

            this.isReady = true;
            this.applyAllParameters();
            try { engineTelemetry.registerResolution('prophecy', hyphonNativeBackendName(artifact.threading), `worklet-ready (${artifact.wasm})`); } catch (_) {}
            return true;

        } catch (e) {
            logEngineFallback('prophecy', 'wasm-worklet', 'AudioWorklet.addModule or node creation failed', e);
            this.cleanupWorklet();
            return false;
        }
    }

    // ── MIDI ──────────────────────────────────────────────────────────────────

    noteOn(midiNote: number, velocity: number = 100, audioTime?: number): void {
        if (!this.isReady || !this.workletNode) return;
        this.workletNode.port.postMessage({ type: 'noteOn', data: { note: midiNote, velocity, audioTime } });
    }

    noteOff(midiNote: number, audioTime?: number): void {
        if (!this.isReady || !this.workletNode) return;
        this.workletNode.port.postMessage({ type: 'noteOff', data: { note: midiNote, audioTime } });
    }

    allNotesOff(): void {
        if (!this.workletNode) return;
        this.workletNode.port.postMessage({ type: 'allNotesOff', data: {} });
    }

    // ── Parameters ────────────────────────────────────────────────────────────

    /**
     * Set a single synthesis parameter.
     * @param paramId  A `ProphecyParam.*` constant.
     * @param value    Normalised value (range depends on parameter — see ProphecyParams.ts).
     */
    setParam(paramId: number, value: number): void {
        if (this.workletNode)
            this.workletNode.port.postMessage({ type: 'set-param', data: { paramId, value } });
    }

    // Convenience setters that also update the internal snapshot
    setWaveform(v: number)      { this.params.waveform     = v; this.setParam(ProphecyParam.WAVEFORM,      v); }
    setVowel(v: number)         { this.params.vowel        = v; this.setParam(ProphecyParam.VOWEL,         v); }
    setVolume(v: number)        { this.params.volume       = v; this.setParam(ProphecyParam.VOLUME,        v); }
    setAttack(v: number)        { this.params.attack       = v; this.setParam(ProphecyParam.ATTACK,        v); }
    setDecay(v: number)         { this.params.decay        = v; this.setParam(ProphecyParam.DECAY,         v); }
    setSustain(v: number)       { this.params.sustain      = v; this.setParam(ProphecyParam.SUSTAIN,       v); }
    setRelease(v: number)       { this.params.release      = v; this.setParam(ProphecyParam.RELEASE,       v); }
    setPortamento(v: number)    { this.params.portamento   = v; this.setParam(ProphecyParam.PORTAMENTO,    v); }
    setFormantShift(v: number)  { this.params.formantShift = v; this.setParam(ProphecyParam.FORMANT_SHIFT, v); }
    setResonance(v: number)     { this.params.resonance    = v; this.setParam(ProphecyParam.RESONANCE,     v); }

    // ── Audio routing ─────────────────────────────────────────────────────────

    connect(dest: AudioNode): void {
        if (this.outputNode) this.outputNode.connect(dest);
    }

    disconnect(): void {
        if (this.outputNode) this.outputNode.disconnect();
    }

    // ── Cleanup ───────────────────────────────────────────────────────────────

    cleanup(): void {
        this.cleanupWorklet();
        if (this.gainNode) {
            this.gainNode.disconnect();
            this.gainNode = null;
        }
        if (this.outputNode) {
            this.outputNode.disconnect();
            this.outputNode = null;
        }
        this.isReady = false;
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private cleanupWorklet(): void {
        if (this.workletNode) {
            // hyphon_native is shared by every voice in the audio session: ask the
            // processor to destroy its handle before the port goes away.
            this.workletNode.port.postMessage({ type: 'dispose' });
            this.workletNode.disconnect();
            this.workletNode.port.close();
            this.workletNode = null;
        }
    }

    /** Re-apply all parameters after the worklet becomes ready. */
    private applyAllParameters(): void {
        this.setWaveform(this.params.waveform);
        this.setVowel(this.params.vowel);
        this.setVolume(this.params.volume);
        this.setAttack(this.params.attack);
        this.setDecay(this.params.decay);
        this.setSustain(this.params.sustain);
        this.setRelease(this.params.release);
        this.setPortamento(this.params.portamento);
        this.setFormantShift(this.params.formantShift);
        this.setResonance(this.params.resonance);
    }
}
