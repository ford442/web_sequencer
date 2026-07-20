import type { Open303Params, Open303Config } from './Open303Params';
import { DEFAULT_303_PARAMS } from './Open303Params';
import type { TB303ModelId } from './TB303Models';
import { normalizeTB303Model, stockModelForFamily, tb303ModelFamily } from './TB303Models';
import { FallbackBassSynth } from './FallbackBassSynth';
import {
    engineTelemetry,
    loadHyphonWasmExportMap,
    logEngineFallback,
    resolvePublicAsset,
} from '../utils/engineTelemetry';
import { attachWorkletPerf } from '../utils/workletPerfBridge';
// Open303 DSP lives inside hyphon_native.wasm (see emscripten/open303_wrapper.cpp,
// integrated in commit aa4fc93). The standalone jc303-single.wasm artifact is gone.
const HYPHON_NATIVE_WASM_URL = resolvePublicAsset('hyphon_native.wasm');

/** Minimum WebAssembly memory pages required by the threaded hyphon_native.wasm build.
 *  The module declares initial: 8192 (512 MB). Must stay in sync with
 *  open303-processor.ts OPEN303_MIN_MEMORY_PAGES. */
const OPEN303_MIN_MEMORY_PAGES = 8192;

/** Maximum milliseconds to wait for the Open303 worklet to signal readiness. */
const OPEN303_INIT_TIMEOUT_MS = 8000;

export class Open303Oscillator {
    private workletNode: AudioWorkletNode | null = null;
    private gainNode: GainNode | null = null;
    private outputNode: GainNode | null = null;
    private fallbackSynth: FallbackBassSynth | null = null;
    private audioContext: AudioContext | null = null;

    private params: Open303Params = { ...DEFAULT_303_PARAMS };
    /** Persisted engine choice — applied once the worklet is ready. */
    private engine303: 'open303' | 'jc303' = 'open303';
    /** Persisted 303 voice/model choice — applied once the worklet is ready. */
    private model303: TB303ModelId = 'stock-open303';
    public isReady: boolean = false;
    public isFallback: boolean = false;

    async init(audioContext: AudioContext, workletUrl?: string, config?: Open303Config): Promise<boolean> {
        this.audioContext = audioContext;
        void config;

        // Create nodes
        this.outputNode = audioContext.createGain();
        this.gainNode = audioContext.createGain();
        this.gainNode.gain.value = 1.0;
        this.gainNode.connect(this.outputNode);

        // Ensure AudioWorklet is supported and URL is provided
        if (audioContext.audioWorklet && workletUrl) {
            try {
                console.log(`[Open303Oscillator] Fetching WASM: ${HYPHON_NATIVE_WASM_URL}`);
                const wasmResponse = await fetch(HYPHON_NATIVE_WASM_URL);

                if (!wasmResponse.ok) {
                    logEngineFallback('open303', 'wasm-worklet', `hyphon_native.wasm fetch HTTP ${wasmResponse.status} (${HYPHON_NATIVE_WASM_URL})`);
                    this.activateFallback();
                    return true;
                }

                const wasmBytes = await wasmResponse.arrayBuffer();
                console.log(`[Open303Oscillator] Fetched ${wasmBytes.byteLength} bytes`);

                const exportMap = await this.fetchExportMap();
                return this._initWithWasmBytes(audioContext, workletUrl, wasmBytes, true, exportMap);

            } catch (e) {
                logEngineFallback('open303', 'wasm-worklet', 'init exception before worklet load', e);
                this.activateFallback();
                return true; // Return true so audio doesn't die
            }
        }

        logEngineFallback(
            'open303',
            'wasm-worklet',
            !audioContext.audioWorklet ? 'AudioWorklet unavailable' : 'worklet URL missing',
        );
        this.activateFallback();
        return true;
    }

    /**
     * Complete the worklet init given pre-fetched WASM bytes.
     * Extracted so that the native/legacy retry path can reuse it.
     */
    private async fetchExportMap(): Promise<Record<string, string>> {
        const map = await loadHyphonWasmExportMap();
        if (Object.keys(map).length === 0) {
            logEngineFallback(
                'open303',
                'wasm-worklet',
                'hyphon_wasm_export_map.json empty and glue parse found no exports — worklet cannot resolve minified WASM symbols',
            );
        }
        return map;
    }

    private async _initWithWasmBytes(
        audioContext: AudioContext,
        workletUrl: string,
        wasmBytes: ArrayBuffer,
        isNative: boolean,
        exportMap: Record<string, string> = {}
    ): Promise<boolean> {
        try {
            // Add the Worklet Module and create the node
            await audioContext.audioWorklet.addModule(workletUrl);

            this.workletNode = new AudioWorkletNode(audioContext, 'open303-processor', {
                outputChannelCount: [2] // Request Stereo
            });

            // Compile + introspect to detect threading before sending to worklet
            const module = await WebAssembly.compile(wasmBytes);
            const imports = WebAssembly.Module.imports(module);
            const memoryImport = imports.find(i => i.kind === 'memory');
            const isThreaded = memoryImport !== undefined;
            const variant = isThreaded ? 'threaded' : 'single';

            console.log(`[Open303Oscillator] WASM variant: ${variant}, native=${isNative}`);

            // hyphon_native.wasm requires at least OPEN303_MIN_MEMORY_PAGES (512 MB).
            // Pass this as the floor so the worklet's createMemory() allocates enough.
            const memoryPages = isThreaded ? OPEN303_MIN_MEMORY_PAGES : undefined;

            this.workletNode.port.postMessage({
                type: 'init-wasm',
                data: {
                    wasmBytes,
                    sampleRate: audioContext.sampleRate,
                    isThreaded,
                    variant,
                    memoryPages,
                    exportMap,
                }
            });

            // Connect and Listen (gainNode is always set before _initWithWasmBytes is reached)
            if (!this.gainNode) throw new Error('gainNode not initialized');
            this.workletNode.connect(this.gainNode);
            attachWorkletPerf(this.workletNode, 'open303');

            // Wait for worklet to confirm initialization
            const initSuccess = await new Promise<boolean>((resolve) => {
                let readyReceived = false;
                
                this.workletNode!.port.onmessage = (e) => {
                    if (e.data.type === 'ready') {
                        readyReceived = true;
                        const backend = isNative ? 'wasm-native' : 'wasm';
                        console.log(`[Open303] Engine Fully Operational (${backend})`);
                        try { engineTelemetry.registerResolution('jc303', backend, 'worklet-ready'); } catch (_) {}
                        resolve(true);
                    } else if (e.data.type === 'error') {
                        logEngineFallback('open303', 'wasm-worklet', 'worklet init-wasm error', e.data.error);
                        resolve(false);
                    }
                };
                
                // Timeout: OPEN303_INIT_TIMEOUT_MS — 1.2 MB WASM should compile in < 3s on modern devices.
                // 20s was excessively generous and caused the second 303 instance to time out
                // when the first one failed (both share a Promise.allSettled budget).
                setTimeout(() => {
                    if (!readyReceived) {
                        logEngineFallback('open303', 'wasm-worklet', `worklet ready timeout (${OPEN303_INIT_TIMEOUT_MS}ms)`);
                        resolve(false);
                    }
                }, OPEN303_INIT_TIMEOUT_MS);
            });

            if (!initSuccess) {
                logEngineFallback('open303', 'wasm-worklet', 'worklet never reached ready state');
                this.cleanupWorklet();
                this.activateFallback();
                return true; // Return true so audio doesn't die
            }

            this.isReady = true;
            this.isFallback = false;
            this.applyModel303();
            this.applyAllParameters();
            try { engineTelemetry.registerResolution('open303', isNative ? 'wasm-native' : 'wasm', 'worklet-ready'); } catch (_) {}
            return true;

        } catch (e) {
            logEngineFallback('open303', 'wasm-worklet', 'AudioWorklet.addModule or node creation failed', e);
            this.activateFallback();
            return true;
        }
    }

    private activateFallback(): void {
        if (!this.audioContext || !this.outputNode) return;
        
        console.warn('[Open303] Activating FallbackBassSynth (JS voice)');
        try { engineTelemetry.registerResolution('open303', 'js', 'fallback-synth-active'); } catch (_) {}
        this.fallbackSynth = new FallbackBassSynth(this.audioContext);
        this.fallbackSynth.connect(this.outputNode);
        this.isReady = true;
        this.isFallback = true;
        
        // Apply current params to fallback
        this.fallbackSynth.setWaveform(this.params.waveform);
        this.fallbackSynth.setCutoff(this.params.cutoff);
        this.fallbackSynth.setResonance(this.params.resonance);
        this.fallbackSynth.setDecay(this.params.decay);
        this.fallbackSynth.setVolume(this.params.volume);
    }

    noteOn(midiNote: number, velocity: number = 100): void {
        if (!this.isReady) return;
        
        if (this.isFallback && this.fallbackSynth) {
            const t0 = performance.now();
            this.fallbackSynth.noteOn(midiNote, velocity);
            const t1 = performance.now();
            try { engineTelemetry.recordLatency('jc303', t1 - t0); } catch (_) {}
        } else if (this.workletNode) {
            const t0 = performance.now();
            this.workletNode.port.postMessage({ type: 'noteOn', data: { note: midiNote, velocity } });
            const t1 = performance.now();
            try { engineTelemetry.recordLatency('jc303', t1 - t0); } catch (_) {}
        }
    }

    noteOff(midiNote: number): void {
        if (!this.isReady) return;
        
        if (this.isFallback && this.fallbackSynth) {
            const t0 = performance.now();
            this.fallbackSynth.noteOff(midiNote);
            const t1 = performance.now();
            try { engineTelemetry.recordLatency('jc303', t1 - t0); } catch (_) {}
        } else if (this.workletNode) {
            const t0 = performance.now();
            this.workletNode.port.postMessage({ type: 'noteOff', data: { note: midiNote } });
            const t1 = performance.now();
            try { engineTelemetry.recordLatency('jc303', t1 - t0); } catch (_) {}
        }
    }

    setParam(func: string, value: number): void {
        if (this.isFallback && this.fallbackSynth) {
            // Map to fallback synth methods
            switch(func) {
                case 'setWaveform': this.fallbackSynth.setWaveform(value); break;
                case 'setCutoff': this.fallbackSynth.setCutoff(value); break;
                case 'setResonance': this.fallbackSynth.setResonance(value); break;
                case 'setDecay': this.fallbackSynth.setDecay(value); break;
                case 'setVolume': this.fallbackSynth.setVolume(value); break;
                // envMod, accent, filterMode not implemented in fallback
            }
        } else if (this.workletNode) {
            this.workletNode.port.postMessage({ type: 'param', data: { func: `jc303_${func}`, value } });
        }
    }

    /**
     * Switch the DSP engine used by this oscillator's AudioWorklet processor.
     *
     * 'open303' — custom synthesizer (default, open303_* API in hyphon_native.wasm)
     * 'jc303'   — authentic rosic::Open303 (jc303_* multi-instance API)
     *
     * The worklet will silently ignore the request when the requested engine is
     * not available in the loaded WASM build.
     */
    setEngine303(engine: 'open303' | 'jc303'): void {
        this.engine303 = engine;
        this.model303 = stockModelForFamily(engine);
        this.applyEngine303();
    }

    private applyEngine303(): void {
        if (!this.workletNode) return;
        this.workletNode.port.postMessage({ type: 'set-engine', data: { engine: this.engine303 } });
        if (this.isReady) {
            // Params were routed to the previous engine — push them to the new one.
            this.applyAllParameters();
        }
    }

    /**
     * Select the 303 voice/model for this oscillator (see engines/TB303Models.ts).
     *
     * Unknown or not-yet-shipped models normalize to the stock voice of their
     * engine family. When the loaded WASM predates the model registry the
     * worklet falls back to plain engine-family switching, so stock voices
     * always work.
     */
    setModel303(model: TB303ModelId | string): void {
        this.model303 = normalizeTB303Model(model);
        this.engine303 = tb303ModelFamily(this.model303);
        this.applyModel303();
    }

    /** Currently selected 303 voice/model. */
    getModel303(): TB303ModelId {
        return this.model303;
    }

    private applyModel303(): void {
        if (!this.workletNode) return;
        this.workletNode.port.postMessage({
            type: 'set-303-model',
            // engine is included so the worklet can route correctly even when
            // the WASM build has no native model registry (pre-voices builds).
            data: { model: this.model303, engine: this.engine303 },
        });
        if (this.isReady) {
            // Params were routed to the previous engine — push them to the new one.
            this.applyAllParameters();
        }
    }

    // Explicit setters used by the application
    setWaveform(v: number) { this.params.waveform = v; this.setParam('setWaveform', v); }
    setCutoff(v: number) { this.params.cutoff = v; this.setParam('setCutoff', v); }
    setResonance(v: number) { this.params.resonance = v; this.setParam('setResonance', v); }
    setFilterMode(v: number) { this.params.filterMode = v; this.setParam('setFilterMode', v); }
    setDecay(v: number) { this.params.decay = v; this.setParam('setDecay', v); }
    setEnvMod(v: number) { this.params.envMod = v; this.setParam('setEnvMod', v); }
    setAccent(v: number) { this.params.accent = v; this.setParam('setAccent', v); }
    setVolume(v: number) { this.params.volume = v; this.setParam('setVolume', v); }

    // Helper to sync state
    private applyAllParameters() {
        this.setWaveform(this.params.waveform);
        this.setCutoff(this.params.cutoff);
        this.setResonance(this.params.resonance);
        this.setFilterMode(this.params.filterMode);
        this.setDecay(this.params.decay);
        this.setEnvMod(this.params.envMod);
        this.setAccent(this.params.accent);
        this.setVolume(this.params.volume);
    }

    connect(dest: AudioNode) {
        if (this.outputNode) this.outputNode.connect(dest);
    }

    disconnect() {
        if (this.outputNode) this.outputNode.disconnect();
    }

    private cleanupWorklet() {
        if (this.workletNode) {
            this.workletNode.disconnect();
            this.workletNode.port.close();
            this.workletNode = null;
        }
    }

    // Public cleanup method for external disposal
    cleanup() {
        this.cleanupWorklet();
        if (this.gainNode) {
            this.gainNode.disconnect();
            this.gainNode = null;
        }
        if (this.outputNode) {
            this.outputNode.disconnect();
            this.outputNode = null;
        }
        if (this.fallbackSynth) {
            this.fallbackSynth.cleanup();
            this.fallbackSynth = null;
        }
        this.isReady = false;
        this.isFallback = false;
    }
}

