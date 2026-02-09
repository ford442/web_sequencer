import type { Open303Params, Open303Config } from './Open303Params';
import { DEFAULT_303_PARAMS, DEFAULT_303_CONFIG } from './Open303Params';

// Declare global for the fallback legacy loader
declare global {
    interface Window {
        JC303Module?: () => Promise<any>;
    }
}

// WASM variant constants
const VARIANT_THREADED = 'threaded';
const VARIANT_SINGLE = 'single';

export class Open303Oscillator {

    // -- Strategy 1: AudioWorklet --
    private workletNode: AudioWorkletNode | null = null;

    // -- Strategy 2: Legacy ScriptProcessor --
    private wasmModule: any = null;
    private processorNode: ScriptProcessorNode | null = null;

    private gainNode: GainNode | null = null;
    private outputNode: GainNode | null = null;
    private params: Open303Params = { ...DEFAULT_303_PARAMS };
    private config: Open303Config = { ...DEFAULT_303_CONFIG };

    isReady: boolean = false;
    useWorklet: boolean = false;
    isThreaded: boolean = false;  // Track which WASM variant is loaded

    async init(audioContext: AudioContext, workletUrl?: string, config?: Open303Config): Promise<boolean> {
        // Merge user config with defaults
        this.config = { ...DEFAULT_303_CONFIG, ...config };
        
        console.log("Open303: Initializing with config:", this.config);

        this.outputNode = audioContext.createGain();
        this.gainNode = audioContext.createGain();
        this.gainNode.gain.value = 1.0;
        this.gainNode.connect(this.outputNode);

        // Determine fallback strategy based on config
        // Priority chain:
        // 1. AudioWorklet + Threaded WASM (if preferWorklet && preferThreaded && !force flags)
        // 2. AudioWorklet + Single-threaded WASM (if preferWorklet && !forceScriptProcessor)
        // 3. ScriptProcessor + Threaded WASM (if preferThreaded && !forceSingleThreaded)
        // 4. ScriptProcessor + Single-threaded WASM (final fallback)

        const tryWorklet = this.config.preferWorklet && !this.config.forceScriptProcessor;
        const tryThreaded = this.config.preferThreaded && !this.config.forceSingleThreaded;

        // Strategy 1: Try AudioWorklet
        if (tryWorklet && audioContext.audioWorklet && workletUrl) {
            // Try threaded variant first if preferred
            if (tryThreaded) {
                const success = await this.tryInitWorklet(audioContext, workletUrl, VARIANT_THREADED);
                if (success) return true;
                console.warn("Open303: AudioWorklet with threaded WASM failed, trying single-threaded...");
            }
            
            // Try single-threaded variant
            const success = await this.tryInitWorklet(audioContext, workletUrl, VARIANT_SINGLE);
            if (success) return true;
            console.warn("Open303: AudioWorklet initialization failed. Falling back to ScriptProcessor.");
        } else if (this.config.forceScriptProcessor) {
            console.log("Open303: ScriptProcessorNode fallback forced by config");
        }

        // Strategy 2: Fallback to ScriptProcessor
        return this.initLegacy(audioContext, tryThreaded);
    }

    private async tryInitWorklet(
        audioContext: AudioContext,
        workletUrl: string,
        variant: typeof VARIANT_THREADED | typeof VARIANT_SINGLE
    ): Promise<boolean> {
        try {
            console.log(`Open303: Attempting to load AudioWorklet with ${variant} WASM...`);

            // Load the appropriate WASM file
            const wasmFilename = `./jc303-${variant}.wasm`;
            const wasmResponse = await fetch(wasmFilename);
            if (!wasmResponse.ok) {
                throw new Error(`WASM file not found: ${wasmFilename} (${wasmResponse.status})`);
            }
            const wasmBytes = await wasmResponse.arrayBuffer();

            await audioContext.audioWorklet.addModule(workletUrl);

            this.workletNode = new AudioWorkletNode(audioContext, 'open303-processor', {
                outputChannelCount: [2]
            });

            // Initialize the Worklet with the WASM binary and variant info
            this.workletNode.port.postMessage({
                type: 'init-wasm',
                data: {
                    wasmBytes,
                    sampleRate: audioContext.sampleRate,
                    variant,
                    isThreaded: variant === 'threaded'
                }
            });

            // Wait for ready confirmation with timeout
            const ready = await new Promise<boolean>((resolve) => {
                const timeout = setTimeout(() => resolve(false), 5000);
                const handler = (e: MessageEvent) => {
                    if (e.data.type === 'ready') {
                        clearTimeout(timeout);
                        this.workletNode!.port.removeEventListener('message', handler);
                        resolve(true);
                    } else if (e.data.type === 'error') {
                        clearTimeout(timeout);
                        this.workletNode!.port.removeEventListener('message', handler);
                        console.error("Open303 Worklet Error:", e.data.error);
                        resolve(false);
                    }
                };
                this.workletNode!.port.addEventListener('message', handler);
            });

            if (!ready) {
                throw new Error(`Worklet initialization timeout or error (${variant})`);
            }

            this.workletNode.connect(this.gainNode);
            this.useWorklet = true;
            this.isThreaded = variant === VARIANT_THREADED;
            this.isReady = true;
            this.applyAllParameters();
            console.log(`Open303: AudioWorklet initialized successfully with ${variant} WASM.`);
            return true;

        } catch (e) {
            console.warn(`Open303: Worklet initialization failed for ${variant} variant:`, e);
            // Clean up if partially initialized
            if (this.workletNode) {
                this.workletNode.disconnect();
                this.workletNode = null;
            }
            return false;
        }
    }

    private async initLegacy(audioContext: AudioContext, preferThreaded: boolean): Promise<boolean> {
        // Try variants in order of preference
        const variants = preferThreaded 
            ? [VARIANT_THREADED, VARIANT_SINGLE] 
            : [VARIANT_SINGLE, VARIANT_THREADED];
        
        for (const variant of variants) {
            const success = await this.tryInitLegacyVariant(audioContext, variant);
            if (success) return true;
        }
        
        console.error("Open303: All initialization strategies failed.");
        return false;
    }

    private async tryInitLegacyVariant(
        audioContext: AudioContext, 
        variant: typeof VARIANT_THREADED | typeof VARIANT_SINGLE
    ): Promise<boolean> {
        try {
            console.log(`Open303: Attempting Legacy Init with ${variant} WASM...`);
            
            const jsFilename = `./jc303-${variant}.js`;
            
            // Load the JS shim for this variant
            if (typeof window.JC303Module === 'undefined') {
                await new Promise<void>((resolve, reject) => {
                    const script = document.createElement('script');
                    script.src = jsFilename;
                    script.onload = () => resolve();
                    script.onerror = () => reject(new Error(`${jsFilename} not found`));
                    document.head.appendChild(script);
                });
            }

            if (!window.JC303Module) throw new Error("JC303Module not available");

            this.wasmModule = await window.JC303Module();

            // Memory View Shim
            if (typeof this.wasmModule.HEAPF32 === 'undefined' && this.wasmModule.memory) {
                Object.defineProperty(this.wasmModule, 'HEAPF32', {
                    configurable: true,
                    get: function () { return new Float32Array(this.memory.buffer); }
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
            this.isThreaded = variant === VARIANT_THREADED;
            this.applyAllParameters();
            console.log(`Open303: Legacy Engine initialized with ${variant} WASM.`);
            return true;

        } catch (e) {
            console.warn(`Open303: Legacy initialization failed for ${variant} variant:`, e);
            // Clean up if partially initialized
            if (this.processorNode) {
                this.processorNode.disconnect();
                this.processorNode = null;
            }
            this.wasmModule = null;
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
