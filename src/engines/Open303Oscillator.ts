// @mode: bridge
// @note-for-ai: This is the TypeScript bridge to the Open303 WASM module (JC-303).
// The heavy DSP logic is in jc303_wasm/wasm/jc303_wasm.cpp. This file handles:
// - WASM loading and initialization
// - Parameter management with 303-specific controls
// - Integration with Web Audio API

export interface Open303Params {
    waveform: number;       // 0 = saw, 1 = square
    tuning: number;         // 0-1 (maps to 400-480 Hz for A4)
    cutoff: number;         // 0-1 (filter cutoff)
    resonance: number;      // 0-1 (filter resonance)
    envMod: number;         // 0-1 (envelope modulation depth)
    decay: number;          // 0-1 (decay time)
    accent: number;         // 0-1 (accent amount)
    volume: number;         // 0-1 (output volume)
    // Devil Fish MOD parameters
    modEnabled: boolean;
    normalDecay: number;    // 0-1 (MOD: normal decay time)
    accentDecay: number;    // 0-1 (MOD: accent decay time)
    feedbackFilter: number; // 0-1 (MOD: feedback filter)
    softAttack: number;     // 0-1 (MOD: soft attack)
    slideTime: number;      // 0-1 (MOD: slide/portamento time)
    squareDriver: number;   // 0-1 (MOD: square wave driver)
}

export const DEFAULT_303_PARAMS: Open303Params = {
    waveform: 1.0,      // Square wave
    tuning: 0.5,        // 440 Hz (centered)
    cutoff: 0.0,        // Minimum cutoff
    resonance: 0.92,    // 92%
    envMod: 0.0,        // No modulation
    decay: 0.29,        // 29%
    accent: 0.78,       // 78%
    volume: 0.75,       // 75%
    modEnabled: false,
    normalDecay: 0.3,
    accentDecay: 0.03,
    feedbackFilter: 0.63,
    softAttack: 0.26,
    slideTime: 0.33,
    squareDriver: 0.25
};

// Declare the global JC303Module that will be loaded from jc303.js
declare global {
    interface Window {
        JC303Module?: () => Promise<any>;
        JC303WasmPath?: string;
    }
}

export class Open303Oscillator {
    private audioContext: AudioContext | null = null;
    private wasmModule: any = null;
    private processorNode: ScriptProcessorNode | null = null;
    private gainNode: GainNode | null = null;
    private outputNode: GainNode | null = null;
    private params: Open303Params = { ...DEFAULT_303_PARAMS };
    private activeNotes: Set<number> = new Set();
    
    isReady: boolean = false;

    /**
     * Initialize the Open303 synthesizer
     * @param audioContext - The Web Audio context to use
     * @returns Promise that resolves when ready
     */
    async init(audioContext: AudioContext): Promise<boolean> {
        try {
            this.audioContext = audioContext;

            // Check if JC303Module is available
            if (typeof window.JC303Module === 'undefined') {
                console.warn('JC303Module not loaded. Loading jc303.js dynamically...');
                await this.loadWasmScript();
            }

            if (typeof window.JC303Module === 'undefined') {
                throw new Error('JC303Module not found after loading');
            }

            // Load the WASM module
            this.wasmModule = await window.JC303Module();

            // Ensure HEAPF32 exists on the returned module
            if (typeof this.wasmModule.HEAPF32 === 'undefined' && this.wasmModule.memory) {
                Object.defineProperty(this.wasmModule, 'HEAPF32', {
                    configurable: true,
                    get: function() { return new Float32Array(this.memory.buffer); }
                });
            }

            // Initialize the synthesizer
            const bufferSize = 256;
            const success = this.wasmModule.ccall(
                'jc303_init', 
                'number', 
                ['number', 'number'], 
                [audioContext.sampleRate, bufferSize]
            );

            if (!success) {
                throw new Error('Failed to initialize WASM synthesizer');
            }

            // Apply default parameters
            this.applyAllParameters();

            // Create audio processing chain
            this.createAudioChain(bufferSize);

            this.isReady = true;
            console.log('Open303 Engine Ready');
            return true;
        } catch (e) {
            console.error('Open303 Init Failed:', e);
            return false;
        }
    }

    /**
     * Load the jc303.js script dynamically
     */
    private async loadWasmScript(): Promise<void> {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = './jc303.js';
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('Failed to load jc303.js'));
            document.head.appendChild(script);
        });
    }

    /**
     * Create the audio processing chain
     */
    private createAudioChain(bufferSize: number): void {
        if (!this.audioContext) return;

        // Create ScriptProcessor node for audio generation
        this.processorNode = this.audioContext.createScriptProcessor(bufferSize, 0, 2);
        
        this.processorNode.onaudioprocess = (event) => {
            if (!this.isReady || !this.wasmModule) return;

            const outputBuffer = event.outputBuffer;
            const numSamples = outputBuffer.length;

            // Generate samples using WASM
            const bufferPtr = this.wasmModule.ccall('jc303_process', 'number', ['number'], [numSamples]);

            if (bufferPtr) {
                // Get the WASM memory view
                const wasmBuffer = new Float32Array(
                    this.wasmModule.HEAPF32.buffer,
                    bufferPtr,
                    numSamples
                );

                // Copy to output channels (mono to stereo)
                for (let channel = 0; channel < outputBuffer.numberOfChannels; channel++) {
                    const channelData = outputBuffer.getChannelData(channel);
                    channelData.set(wasmBuffer);
                }
            }
        };

        // Create gain node for output level control
        this.gainNode = this.audioContext.createGain();
        this.gainNode.gain.value = 1.0;

        // Create output node for external connection
        this.outputNode = this.audioContext.createGain();
        this.outputNode.gain.value = 1.0;

        // Connect the chain
        this.processorNode.connect(this.gainNode);
        this.gainNode.connect(this.outputNode);
    }

    /**
     * Get the output node for connecting to the audio graph
     */
    getOutputNode(): GainNode | null {
        return this.outputNode;
    }

    /**
     * Connect to a destination node
     */
    connect(destination: AudioNode): void {
        if (this.outputNode) {
            this.outputNode.connect(destination);
        }
    }

    /**
     * Disconnect from all destinations
     */
    disconnect(): void {
        if (this.outputNode) {
            this.outputNode.disconnect();
        }
    }

    /**
     * Apply all cached parameters to the WASM module
     */
    private applyAllParameters(): void {
        if (!this.wasmModule) return;

        this.wasmModule.ccall('jc303_setWaveform', 'void', ['number'], [this.params.waveform]);
        this.wasmModule.ccall('jc303_setTuning', 'void', ['number'], [this.params.tuning]);
        this.wasmModule.ccall('jc303_setCutoff', 'void', ['number'], [this.params.cutoff]);
        this.wasmModule.ccall('jc303_setResonance', 'void', ['number'], [this.params.resonance]);
        this.wasmModule.ccall('jc303_setEnvMod', 'void', ['number'], [this.params.envMod]);
        this.wasmModule.ccall('jc303_setDecay', 'void', ['number'], [this.params.decay]);
        this.wasmModule.ccall('jc303_setAccent', 'void', ['number'], [this.params.accent]);
        this.wasmModule.ccall('jc303_setVolume', 'void', ['number'], [this.params.volume]);
        this.wasmModule.ccall('jc303_setModEnabled', 'void', ['number'], [this.params.modEnabled ? 1 : 0]);

        if (this.params.modEnabled) {
            this.wasmModule.ccall('jc303_setNormalDecay', 'void', ['number'], [this.params.normalDecay]);
            this.wasmModule.ccall('jc303_setAccentDecay', 'void', ['number'], [this.params.accentDecay]);
            this.wasmModule.ccall('jc303_setFeedbackFilter', 'void', ['number'], [this.params.feedbackFilter]);
            this.wasmModule.ccall('jc303_setSoftAttack', 'void', ['number'], [this.params.softAttack]);
            this.wasmModule.ccall('jc303_setSlideTime', 'void', ['number'], [this.params.slideTime]);
            this.wasmModule.ccall('jc303_setSquareDriver', 'void', ['number'], [this.params.squareDriver]);
        }
    }

    // ==================== MIDI/Note Control ====================

    /**
     * Trigger a note on
     * @param midiNote - MIDI note number (0-127)
     * @param velocity - MIDI velocity (1-127)
     */
    noteOn(midiNote: number, velocity: number = 100): void {
        if (!this.isReady || !this.wasmModule) return;

        this.wasmModule.ccall('jc303_noteOn', 'void', ['number', 'number'], [midiNote, velocity]);
        this.activeNotes.add(midiNote);
    }

    /**
     * Trigger a note off
     * @param midiNote - MIDI note number (0-127)
     */
    noteOff(midiNote: number): void {
        if (!this.isReady || !this.wasmModule) return;

        this.wasmModule.ccall('jc303_noteOff', 'void', ['number'], [midiNote]);
        this.activeNotes.delete(midiNote);
    }

    /**
     * Turn off all notes
     */
    allNotesOff(): void {
        if (!this.isReady || !this.wasmModule) return;

        this.wasmModule.ccall('jc303_allNotesOff', 'void', [], []);
        this.activeNotes.clear();
    }

    // ==================== Parameter Control ====================

    /**
     * Set waveform blend (0 = saw, 1 = square)
     */
    setWaveform(value: number): void {
        this.params.waveform = Math.max(0, Math.min(1, value));
        if (this.wasmModule) {
            this.wasmModule.ccall('jc303_setWaveform', 'void', ['number'], [this.params.waveform]);
        }
    }

    /**
     * Set tuning (0-1, maps to 400-480 Hz for A4)
     */
    setTuning(value: number): void {
        this.params.tuning = Math.max(0, Math.min(1, value));
        if (this.wasmModule) {
            this.wasmModule.ccall('jc303_setTuning', 'void', ['number'], [this.params.tuning]);
        }
    }

    /**
     * Set filter cutoff (0-1)
     */
    setCutoff(value: number): void {
        this.params.cutoff = Math.max(0, Math.min(1, value));
        if (this.wasmModule) {
            this.wasmModule.ccall('jc303_setCutoff', 'void', ['number'], [this.params.cutoff]);
        }
    }

    /**
     * Set filter resonance (0-1)
     */
    setResonance(value: number): void {
        this.params.resonance = Math.max(0, Math.min(1, value));
        if (this.wasmModule) {
            this.wasmModule.ccall('jc303_setResonance', 'void', ['number'], [this.params.resonance]);
        }
    }

    /**
     * Set envelope modulation depth (0-1)
     */
    setEnvMod(value: number): void {
        this.params.envMod = Math.max(0, Math.min(1, value));
        if (this.wasmModule) {
            this.wasmModule.ccall('jc303_setEnvMod', 'void', ['number'], [this.params.envMod]);
        }
    }

    /**
     * Set decay time (0-1)
     */
    setDecay(value: number): void {
        this.params.decay = Math.max(0, Math.min(1, value));
        if (this.wasmModule) {
            this.wasmModule.ccall('jc303_setDecay', 'void', ['number'], [this.params.decay]);
        }
    }

    /**
     * Set accent amount (0-1)
     */
    setAccent(value: number): void {
        this.params.accent = Math.max(0, Math.min(1, value));
        if (this.wasmModule) {
            this.wasmModule.ccall('jc303_setAccent', 'void', ['number'], [this.params.accent]);
        }
    }

    /**
     * Set volume (0-1)
     */
    setVolume(value: number): void {
        this.params.volume = Math.max(0, Math.min(1, value));
        if (this.wasmModule) {
            this.wasmModule.ccall('jc303_setVolume', 'void', ['number'], [this.params.volume]);
        }
    }

    /**
     * Enable/disable MOD mode (Devil Fish-style extended parameters)
     */
    setModEnabled(enabled: boolean): void {
        this.params.modEnabled = enabled;
        if (this.wasmModule) {
            this.wasmModule.ccall('jc303_setModEnabled', 'void', ['number'], [enabled ? 1 : 0]);
            if (enabled) {
                // Apply MOD parameters when enabling
                this.wasmModule.ccall('jc303_setNormalDecay', 'void', ['number'], [this.params.normalDecay]);
                this.wasmModule.ccall('jc303_setAccentDecay', 'void', ['number'], [this.params.accentDecay]);
                this.wasmModule.ccall('jc303_setFeedbackFilter', 'void', ['number'], [this.params.feedbackFilter]);
                this.wasmModule.ccall('jc303_setSoftAttack', 'void', ['number'], [this.params.softAttack]);
                this.wasmModule.ccall('jc303_setSlideTime', 'void', ['number'], [this.params.slideTime]);
                this.wasmModule.ccall('jc303_setSquareDriver', 'void', ['number'], [this.params.squareDriver]);
            }
        }
    }

    // MOD parameters (only active when mod is enabled)

    setNormalDecay(value: number): void {
        this.params.normalDecay = Math.max(0, Math.min(1, value));
        if (this.wasmModule && this.params.modEnabled) {
            this.wasmModule.ccall('jc303_setNormalDecay', 'void', ['number'], [this.params.normalDecay]);
        }
    }

    setAccentDecay(value: number): void {
        this.params.accentDecay = Math.max(0, Math.min(1, value));
        if (this.wasmModule && this.params.modEnabled) {
            this.wasmModule.ccall('jc303_setAccentDecay', 'void', ['number'], [this.params.accentDecay]);
        }
    }

    setFeedbackFilter(value: number): void {
        this.params.feedbackFilter = Math.max(0, Math.min(1, value));
        if (this.wasmModule && this.params.modEnabled) {
            this.wasmModule.ccall('jc303_setFeedbackFilter', 'void', ['number'], [this.params.feedbackFilter]);
        }
    }

    setSoftAttack(value: number): void {
        this.params.softAttack = Math.max(0, Math.min(1, value));
        if (this.wasmModule && this.params.modEnabled) {
            this.wasmModule.ccall('jc303_setSoftAttack', 'void', ['number'], [this.params.softAttack]);
        }
    }

    setSlideTime(value: number): void {
        this.params.slideTime = Math.max(0, Math.min(1, value));
        if (this.wasmModule && this.params.modEnabled) {
            this.wasmModule.ccall('jc303_setSlideTime', 'void', ['number'], [this.params.slideTime]);
        }
    }

    setSquareDriver(value: number): void {
        this.params.squareDriver = Math.max(0, Math.min(1, value));
        if (this.wasmModule && this.params.modEnabled) {
            this.wasmModule.ccall('jc303_setSquareDriver', 'void', ['number'], [this.params.squareDriver]);
        }
    }

    /**
     * Set pitch bend in semitones
     */
    setPitchBend(semitones: number): void {
        if (this.wasmModule) {
            this.wasmModule.ccall('jc303_setPitchBend', 'void', ['number'], [semitones]);
        }
    }

    // ==================== Utility ====================

    /**
     * Get current parameters
     */
    getParameters(): Open303Params {
        return { ...this.params };
    }

    /**
     * Set all parameters at once
     */
    setParameters(newParams: Partial<Open303Params>): void {
        if (newParams.waveform !== undefined) this.setWaveform(newParams.waveform);
        if (newParams.tuning !== undefined) this.setTuning(newParams.tuning);
        if (newParams.cutoff !== undefined) this.setCutoff(newParams.cutoff);
        if (newParams.resonance !== undefined) this.setResonance(newParams.resonance);
        if (newParams.envMod !== undefined) this.setEnvMod(newParams.envMod);
        if (newParams.decay !== undefined) this.setDecay(newParams.decay);
        if (newParams.accent !== undefined) this.setAccent(newParams.accent);
        if (newParams.volume !== undefined) this.setVolume(newParams.volume);
        if (newParams.modEnabled !== undefined) this.setModEnabled(newParams.modEnabled);
        if (newParams.normalDecay !== undefined) this.setNormalDecay(newParams.normalDecay);
        if (newParams.accentDecay !== undefined) this.setAccentDecay(newParams.accentDecay);
        if (newParams.feedbackFilter !== undefined) this.setFeedbackFilter(newParams.feedbackFilter);
        if (newParams.softAttack !== undefined) this.setSoftAttack(newParams.softAttack);
        if (newParams.slideTime !== undefined) this.setSlideTime(newParams.slideTime);
        if (newParams.squareDriver !== undefined) this.setSquareDriver(newParams.squareDriver);
    }

    /**
     * Cleanup resources
     */
    destroy(): void {
        this.allNotesOff();

        if (this.processorNode) {
            this.processorNode.disconnect();
            this.processorNode = null;
        }

        if (this.gainNode) {
            this.gainNode.disconnect();
            this.gainNode = null;
        }

        if (this.outputNode) {
            this.outputNode.disconnect();
            this.outputNode = null;
        }

        if (this.wasmModule) {
            this.wasmModule.ccall('jc303_cleanup', 'void', [], []);
            this.wasmModule = null;
        }

        this.isReady = false;
    }
}
