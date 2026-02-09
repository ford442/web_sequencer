import type { Open303Params } from './Open303Params';
import { DEFAULT_303_PARAMS } from './Open303Params';

// Declare global for the fallback legacy loader
declare global {
    interface Window {
        JC303Module?: () => Promise<any>;
    }
}

export class Open303Oscillator {

    // -- Strategy 1: AudioWorklet --
    private workletNode: AudioWorkletNode | null = null;

    // -- Strategy 2: Legacy ScriptProcessor --
    private wasmModule: any = null;
    private processorNode: ScriptProcessorNode | null = null;

    private gainNode: GainNode | null = null;
    private outputNode: GainNode | null = null;
    private params: Open303Params = { ...DEFAULT_303_PARAMS };
    
    isReady: boolean = false;
    useWorklet: boolean = false;

    async init(audioContext: AudioContext, workletUrl?: string, forceScriptProcessor: boolean = false): Promise<boolean> {
        this.outputNode = audioContext.createGain();
        this.gainNode = audioContext.createGain();
        this.gainNode.gain.value = 1.0;
        this.gainNode.connect(this.outputNode);

        // 1. Try Audio Worklet (Preferred) - unless forcing fallback
        if (!forceScriptProcessor && audioContext.audioWorklet && workletUrl) {
            try {
                console.log("Open303: Attempting to load Worklet...");

                // Load the WASM file manually to pass to the worklet
                const wasmResponse = await fetch('./jc303.wasm');
                if (!wasmResponse.ok) throw new Error(`WASM file not found (${wasmResponse.status})`);
                const wasmBytes = await wasmResponse.arrayBuffer();

                await audioContext.audioWorklet.addModule(workletUrl);

                this.workletNode = new AudioWorkletNode(audioContext, 'open303-processor', {
                    outputChannelCount: [2]
                });

                // Initialize the Worklet with the WASM binary
                this.workletNode.port.postMessage({
                    type: 'init-wasm',
                    data: {
                        wasmBytes,
                        sampleRate: audioContext.sampleRate
                    }
                });

                this.workletNode.connect(this.gainNode);
                this.useWorklet = true;
                this.isReady = true;
                this.applyAllParameters();
                console.log("Open303: AudioWorklet Initialized Successfully.");
                return true;

            } catch (e) {
                console.warn("Open303: Worklet initialization failed. Falling back.", e);
            }
        } else if (forceScriptProcessor) {
            console.log("Open303: ScriptProcessorNode fallback forced by user setting");
        }

        // 2. Fallback to ScriptProcessor (Legacy)
        return this.initLegacy(audioContext);
    }

    private async initLegacy(audioContext: AudioContext): Promise<boolean> {
        try {
            console.log("Open303: Attempting Legacy Init...");
            if (typeof window.JC303Module === 'undefined') {
                 // Try to load the JS shim if missing
                 await new Promise<void>((resolve, reject) => {
                    const script = document.createElement('script');
                    script.src = './jc303.js';
                    script.onload = () => resolve();
                    script.onerror = () => reject(new Error('jc303.js not found'));
                    document.head.appendChild(script);
                 });
            }

            if (!window.JC303Module) throw new Error("JC303Module not available");

            this.wasmModule = await window.JC303Module();

            // Memory View Shim
            if (typeof this.wasmModule.HEAPF32 === 'undefined' && this.wasmModule.memory) {
                Object.defineProperty(this.wasmModule, 'HEAPF32', {
                    configurable: true,
                    get: function() { return new Float32Array(this.memory.buffer); }
                });
            }

            const success = this.wasmModule.ccall(
                'jc303_init', 'number', ['number', 'number'], [audioContext.sampleRate, 2048]
            );

            if (!success) throw new Error("WASM init returned false");

            // Setup Script Processor
            this.processorNode = audioContext.createScriptProcessor(2048, 0, 2);
            this.processorNode.onaudioprocess = (e) => {
                if (!this.wasmModule) return;
                const outputBuffer = e.outputBuffer;
                const ptr = this.wasmModule.ccall('jc303_process', 'number', ['number'], [outputBuffer.length]);
                if (ptr) {
                    const wasmView = new Float32Array(this.wasmModule.HEAPF32.buffer, ptr, outputBuffer.length);
                    for (let c = 0; c < outputBuffer.numberOfChannels; c++) {
                        outputBuffer.getChannelData(c).set(wasmView);
                    }
                }
            };

            if (this.gainNode) { this.processorNode.connect(this.gainNode); }
            this.isReady = true;
            this.useWorklet = false;
            this.applyAllParameters();
            console.log("Open303: Legacy Engine Initialized.");
            return true;

        } catch (e) {
            console.error("Open303: All initialization strategies failed.", e);
            return false;
        }
    }

    noteOn(midiNote: number, velocity: number = 100): void {
        if (!this.isReady) return;
        if (this.useWorklet && this.workletNode) {
            this.workletNode.port.postMessage({ type: 'noteOn', data: { note: midiNote, velocity } });
        } else if (this.wasmModule) {
            this.wasmModule.ccall('jc303_noteOn', 'void', ['number', 'number'], [midiNote, velocity]);
        }
    }

    noteOff(midiNote: number): void {
        if (!this.isReady) return;
        if (this.useWorklet && this.workletNode) {
            this.workletNode.port.postMessage({ type: 'noteOff', data: { note: midiNote } });
        } else if (this.wasmModule) {
            this.wasmModule.ccall('jc303_noteOff', 'void', ['number'], [midiNote]);
        }
    }

    setParam(funcName: string, value: number): void {
        if (!this.isReady) return;
        if (this.useWorklet && this.workletNode) {
            this.workletNode.port.postMessage({ type: 'param', data: { func: `jc303_${funcName}`, value } });
        } else if (this.wasmModule) {
            this.wasmModule.ccall(`jc303_${funcName}`, 'void', ['number'], [value]);
        }
    }

    // Explicit setters using the generic helper
    setWaveform(v: number) { this.params.waveform = v; this.setParam('setWaveform', v); }
    setCutoff(v: number) { this.params.cutoff = v; this.setParam('setCutoff', v); }
    setResonance(v: number) { this.params.resonance = v; this.setParam('setResonance', v); }
    setDecay(v: number) { this.params.decay = v; this.setParam('setDecay', v); }
    setEnvMod(v: number) { this.params.envMod = v; this.setParam('setEnvMod', v); }
    setAccent(v: number) { this.params.accent = v; this.setParam('setAccent', v); }
    setVolume(v: number) { this.params.volume = v; this.setParam('setVolume', v); }

    // Helper to apply all from current state
    private applyAllParameters() {
        this.setWaveform(this.params.waveform);
        this.setCutoff(this.params.cutoff);
        this.setResonance(this.params.resonance);
        this.setDecay(this.params.decay);
        this.setEnvMod(this.params.envMod);
        this.setAccent(this.params.accent);
        this.setVolume(this.params.volume);
    }

    connect(dest: AudioNode) { this.outputNode?.connect(dest); }
    disconnect() { this.outputNode?.disconnect(); }
}
