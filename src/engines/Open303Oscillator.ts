import type { Open303Params, Open303Config } from './Open303Params';
import { DEFAULT_303_PARAMS, DEFAULT_303_CONFIG } from './Open303Params';
import { FallbackBassSynth } from './FallbackBassSynth';
import { engineTelemetry } from '../utils/engineTelemetry';
// Vite-managed asset: Vite content-hashes this and resolves the URL correctly in
// both dev and production, including subdirectory deployments. The placeholder at
// src/wasm/jc303-single.wasm (8-byte stub) is replaced by the real artifact after
// running: bash tools/build_jc303_omp.sh release single
import jc303WasmUrl from '../wasm/jc303-single.wasm?url';

export class Open303Oscillator {
    private workletNode: AudioWorkletNode | null = null;
    private gainNode: GainNode | null = null;
    private outputNode: GainNode | null = null;
    private fallbackSynth: FallbackBassSynth | null = null;
    private audioContext: AudioContext | null = null;

    private params: Open303Params = { ...DEFAULT_303_PARAMS };
    public isReady: boolean = false;
    public isFallback: boolean = false;

    async init(audioContext: AudioContext, workletUrl?: string, config?: Open303Config): Promise<boolean> {
        this.audioContext = audioContext;
        
        // Merge with defaults
        const cfg = { ...DEFAULT_303_CONFIG, ...config };
        
        // Create nodes
        this.outputNode = audioContext.createGain();
        this.gainNode = audioContext.createGain();
        this.gainNode.gain.value = 1.0;
        this.gainNode.connect(this.outputNode);

        // Ensure AudioWorklet is supported and URL is provided
        if (audioContext.audioWorklet && workletUrl) {
            try {
                // 1. Fetch the WASM binary via Vite-managed URL (content-hashed, dev+prod safe)
                console.log(`[Open303Oscillator] Fetching WASM from Vite asset: ${jc303WasmUrl}`);
                const wasmResponse = await fetch(jc303WasmUrl);

                if (!wasmResponse.ok) {
                    console.warn(`[Open303] WASM fetch failed (${wasmResponse.status}), activating fallback`);
                    try { engineTelemetry.registerResolution('jc303', 'fallback', 'wasm-fetch-failed'); } catch (_) {}
                    this.activateFallback();
                    return true;
                }

                const wasmBytes = await wasmResponse.arrayBuffer();
                console.log(`[Open303Oscillator] Fetched ${wasmBytes.byteLength} bytes`);

                // Guard against the committed 8-byte build stub. A real jc303 binary
                // is hundreds of KB; anything under 1 KB means the Colab build hasn't
                // been run yet. Skip the worklet entirely rather than burning 3 retries.
                if (wasmBytes.byteLength < 1024) {
                    console.warn(`[Open303] WASM is a stub (${wasmBytes.byteLength} bytes). Run: bash tools/build_jc303_omp.sh release single`);
                    try { engineTelemetry.registerResolution('jc303', 'fallback', 'wasm-stub'); } catch (_) {}
                    this.activateFallback();
                    return true;
                }

                // 2. Add the Worklet Module and create the node
                await audioContext.audioWorklet.addModule(workletUrl);

                this.workletNode = new AudioWorkletNode(audioContext, 'open303-processor', {
                    outputChannelCount: [2] // Request Stereo
                });

                // 3. Compile + introspect to detect threading before sending to worklet
                const module = await WebAssembly.compile(wasmBytes);
                const imports = WebAssembly.Module.imports(module);
                const memoryImport = imports.find(i => i.kind === 'memory');
                const isThreaded = memoryImport !== undefined;
                const variant = isThreaded ? 'threaded' : 'single';

                console.log(`[Open303Oscillator] WASM variant: ${variant}`);

                this.workletNode.port.postMessage({
                    type: 'init-wasm',
                    data: {
                        wasmBytes,
                        sampleRate: audioContext.sampleRate,
                        isThreaded,
                        variant
                    }
                });

                // 5. Connect and Listen
                this.workletNode.connect(this.gainNode);

                // Wait for worklet to confirm initialization
                const initSuccess = await new Promise<boolean>((resolve) => {
                    let readyReceived = false;
                    
                    this.workletNode!.port.onmessage = (e) => {
                        if (e.data.type === 'ready') {
                            readyReceived = true;
                            console.log("[Open303] Engine Fully Operational");
                            try { engineTelemetry.registerResolution('jc303', 'wasm', 'worklet-ready'); } catch (_) {}
                            resolve(true);
                        } else if (e.data.type === 'error') {
                            console.error("[Open303] Worklet Error:", e.data.error);
                            try { engineTelemetry.recordError('jc303', e.data.error); engineTelemetry.registerResolution('jc303', 'fallback', 'worklet-error'); } catch (_) {}
                            resolve(false);
                        }
                    };
                    
                    // Timeout: 20s to account for large WASM compile on slower devices
                    setTimeout(() => {
                        if (!readyReceived) {
                            console.error("[Open303] Initialization timeout (20s)");
                            resolve(false);
                        }
                    }, 20000);
                });

                if (!initSuccess) {
                    console.warn('[Open303] WASM failed, activating fallback synth');
                    try { engineTelemetry.registerResolution('jc303', 'fallback', 'wasm-init-failed'); } catch (_) {}
                    this.cleanupWorklet();
                    this.activateFallback();
                    return true; // Return true so audio doesn't die
                }

                this.isReady = true;
                this.isFallback = false;
                this.applyAllParameters();
                return true;

            } catch (e) {
                try { engineTelemetry.recordError('jc303', e); engineTelemetry.registerResolution('jc303', 'fallback', 'exception'); } catch (_) {}
                console.error("Open303 Init Failure:", e);
                console.warn('[Open303] Activating fallback synth');
                this.activateFallback();
                return true; // Return true so audio doesn't die
            }
        }
        
        // No worklet support - use fallback
        this.activateFallback();
        return true;
    }

    private activateFallback(): void {
        if (!this.audioContext || !this.outputNode) return;
        
        console.log('[Open303] Activating FallbackBassSynth');
        try { engineTelemetry.registerResolution('jc303','js','fallback-synth'); } catch (_) {}
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

