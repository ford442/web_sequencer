import type { Open303Params, Open303Config } from './Open303Params';
import { DEFAULT_303_PARAMS, DEFAULT_303_CONFIG } from './Open303Params';
import { FallbackBassSynth } from './FallbackBassSynth';
import { engineTelemetry } from '../utils/engineTelemetry';

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
                // 1. Determine which WASM variant to use
                // Single-threaded has best compatibility, threaded requires COOP/COEP headers
                const variant = (!cfg.forceSingleThreaded && cfg.preferThreaded) ? 'threaded' : 'single';

                // ========================================================================
                // CRITICAL: Resolve WASM relative to the JS bundle via import.meta.url.
                // This ensures correct loading when the app is deployed under a
                // subdirectory (e.g. /hyphon/).  Do NOT change this to use
                // window.location.origin — that strips the path and causes 404s.
                //
                // Previous external fallback (kept for reference only):
                //   https://wasm.noahcohn.com/jc303-single.wasm
                //   https://wasm.noahcohn.com/jc303-threaded.wasm
                // ========================================================================
                const moduleUrl = import.meta.url;
                const wasmUrl = new URL(`../jc303-${variant}.wasm`, moduleUrl).href;
                
                console.log(`[Open303Oscillator] Fetching WASM variant: ${variant} (${wasmUrl})`);

                // 2. Fetch the WASM binary manually
                let wasmResponse = await fetch(wasmUrl);
                
                // If threaded fails and we were trying threaded, fall back to single
                if (!wasmResponse.ok && variant === 'threaded') {
                    console.warn(`Failed to fetch ${wasmUrl}: ${wasmResponse.status}, falling back to single-threaded`);
                    const fallbackUrl = new URL('../jc303-single.wasm', moduleUrl).href;
                    wasmResponse = await fetch(fallbackUrl);
                }
                
                if (!wasmResponse.ok) {
                    console.warn(`Failed to fetch jc303 WASM: ${wasmResponse.status}`);
                    return false;
                }
                
                const wasmBytes = await wasmResponse.arrayBuffer();
                console.log(`[Open303Oscillator] Fetched ${wasmBytes.byteLength} bytes`);

                // 3. Add the Worklet Module
                await audioContext.audioWorklet.addModule(workletUrl);

                // 4. Create the Node
                this.workletNode = new AudioWorkletNode(audioContext, 'open303-processor', {
                    outputChannelCount: [2] // Request Stereo
                });

                // 5. Send WASM to the Worklet
                const module = await WebAssembly.compile(wasmBytes);
                const imports = WebAssembly.Module.imports(module);
                const memoryImport = imports.find(i => i.kind === 'memory');
                const isThreaded = memoryImport !== undefined;
                
                console.log(`[Open303Oscillator] WASM imports memory: ${isThreaded} (requested: ${variant})`);
                
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
                    
                    // Timeout after 10 seconds
                    setTimeout(() => {
                        if (!readyReceived) {
                            console.error("[Open303] Initialization timeout (10s)");
                            resolve(false);
                        }
                    }, 10000);
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

