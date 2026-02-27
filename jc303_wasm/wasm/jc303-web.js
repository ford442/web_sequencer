/**
 * JC-303 Web Audio API Wrapper
 * 
 * This JavaScript module provides a high-level API for using the JC-303
 * WASM synthesizer in a browser environment with the Web Audio API.
 * 
 * Usage:
 * 1. Load jc303.js (Emscripten-generated) before this file
 * 2. Create instance: const synth = new JC303();
 * 3. Initialize: await synth.init();
 * 4. Play notes: synth.noteOn(60, 100);
 * 
 * Licensed under GPL-3.0
 */

class JC303 {
    constructor() {
        this.audioContext = null;
        this.wasmModule = null;
        this.processorNode = null;
        this.gainNode = null;
        this.isReady = false;
        this.isPlaying = false;
        
        // Parameter cache
        this.parameters = {
            waveform: 1.0,
            tuning: 0.5,
            cutoff: 0.0,
            resonance: 0.92,
            envmod: 0.0,
            decay: 0.29,
            accent: 0.78,
            volume: 0.75,
            modEnabled: false,
            normalDecay: 0.3,
            accentDecay: 0.03,
            feedbackFilter: 0.63,
            softAttack: 0.26,
            slideTime: 0.33,
            squareDriver: 0.25
        };
        
        // Active notes for tracking
        this.activeNotes = new Set();
    }
    
    /**
     * Initialize the synthesizer
     * @param {AudioContext} audioContext - Optional existing AudioContext
     * @returns {Promise<boolean>} - True if initialization succeeded
     */
    async init(audioContext = null) {
        try {
            // Check if JC303Module is available (loaded from jc303.js)
            if (typeof JC303Module === 'undefined') {
                throw new Error('JC303Module not found. Make sure jc303.js is loaded before jc303-web.js');
            }
            
            // Create or use provided AudioContext
            if (audioContext) {
                this.audioContext = audioContext;
            } else {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }
            
            // Load the WASM module (JC303Module is defined in the Emscripten-generated jc303.js)
            this.wasmModule = await JC303Module();

            // Ensure HEAPF32 exists on the returned module even if not exported by the build
            // (some builds don't include HEAP views in EXPORTED_RUNTIME_METHODS). Provide
            // a getter that returns a fresh view over the WebAssembly memory buffer so
            // callers can use `module.HEAPF32.buffer` as expected.
            if (typeof this.wasmModule.HEAPF32 === 'undefined' && this.wasmModule.memory) {
                Object.defineProperty(this.wasmModule, 'HEAPF32', {
                    configurable: true,
                    get: function() { return new Float32Array(this.memory.buffer); }
                });
            }
            
            // Initialize the synthesizer
            const bufferSize = 256;
            const success = this.wasmModule.ccall('jc303_init', 'number', ['number','number'], [this.audioContext.sampleRate, bufferSize]);
            
            if (!success) {
                throw new Error('Failed to initialize WASM synthesizer');
            }
            
            // Apply cached parameters
            this.applyAllParameters();
            
            // Create a ScriptProcessor node for audio generation
            // Note: ScriptProcessorNode is deprecated but widely supported
            // AudioWorklet version is available for modern browsers
            this.createScriptProcessor();
            
            // Create gain node for master volume
            this.gainNode = this.audioContext.createGain();
            this.gainNode.gain.value = 1.0;
            
            // Connect nodes
            this.processorNode.connect(this.gainNode);
            this.gainNode.connect(this.audioContext.destination);
            
            this.isReady = true;
            return true;
            
        } catch (error) {
            console.error('JC-303 initialization error:', error);
            return false;
        }
    }
    
    /**
     * Get the path to the WASM files (can be overridden)
     */
    getWasmPath() {
        // Default path - can be overridden by setting JC303.wasmPath
        return window.JC303WasmPath || './';
    }
    
    /**
     * Create ScriptProcessor node for audio generation
     */
    createScriptProcessor() {
        const bufferSize = 256;
        this.processorNode = this.audioContext.createScriptProcessor(bufferSize, 0, 2);
        
        this.processorNode.onaudioprocess = (event) => {
            if (!this.isReady) return;
            
            const outputBuffer = event.outputBuffer;
            const numSamples = outputBuffer.length;
            
            // Generate samples using WASM; call the exported C function directly via ccall
            const bufferPtr = this.wasmModule.ccall('jc303_process', 'number', ['number'], [numSamples]);

            if (bufferPtr) {
                // Get the WASM memory view
                const wasmBuffer = new Float32Array(
                    this.wasmModule.HEAPF32.buffer,
                    bufferPtr,
                    numSamples
                );

                // Copy to output channels
                for (let channel = 0; channel < outputBuffer.numberOfChannels; channel++) {
                    const channelData = outputBuffer.getChannelData(channel);
                    channelData.set(wasmBuffer);
                }
            }
        };
    }
    
    /**
     * Resume audio context (required after user gesture)
     */
    async resume() {
        if (this.audioContext && this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }
    }
    
    /**
     * Apply all cached parameters to the WASM module
     */
    applyAllParameters() {
        if (!this.wasmModule) return;
        
        this.wasmModule.ccall('jc303_setWaveform', 'void', ['number'], [this.parameters.waveform]);
        this.wasmModule.ccall('jc303_setTuning', 'void', ['number'], [this.parameters.tuning]);
        this.wasmModule.ccall('jc303_setCutoff', 'void', ['number'], [this.parameters.cutoff]);
        this.wasmModule.ccall('jc303_setResonance', 'void', ['number'], [this.parameters.resonance]);
        this.wasmModule.ccall('jc303_setEnvMod', 'void', ['number'], [this.parameters.envmod]);
        this.wasmModule.ccall('jc303_setDecay', 'void', ['number'], [this.parameters.decay]);
        this.wasmModule.ccall('jc303_setAccent', 'void', ['number'], [this.parameters.accent]);
        this.wasmModule.ccall('jc303_setVolume', 'void', ['number'], [this.parameters.volume]);
        this.wasmModule.ccall('jc303_setModEnabled', 'void', ['number'], [this.parameters.modEnabled ? 1 : 0]);
        
        if (this.parameters.modEnabled) {
            this.wasmModule.ccall('jc303_setNormalDecay', 'void', ['number'], [this.parameters.normalDecay]);
            this.wasmModule.ccall('jc303_setAccentDecay', 'void', ['number'], [this.parameters.accentDecay]);
            this.wasmModule.ccall('jc303_setFeedbackFilter', 'void', ['number'], [this.parameters.feedbackFilter]);
            this.wasmModule.ccall('jc303_setSoftAttack', 'void', ['number'], [this.parameters.softAttack]);
            this.wasmModule.ccall('jc303_setSlideTime', 'void', ['number'], [this.parameters.slideTime]);
            this.wasmModule.ccall('jc303_setSquareDriver', 'void', ['number'], [this.parameters.squareDriver]);
        }
    }
    
    // ==================== MIDI Control ====================
    
    /**
     * Trigger a note on
     * @param {number} note - MIDI note number (0-127)
     * @param {number} velocity - MIDI velocity (1-127, or 100+ for accent)
     */
    noteOn(note, velocity = 100) {
        if (!this.isReady) return;
        
        this.resume();
        this.wasmModule.ccall('jc303_noteOn', 'void', ['number','number'], [note, velocity]);
        this.activeNotes.add(note);
    }
    
    /**
     * Trigger a note off
     * @param {number} note - MIDI note number (0-127)
     */
    noteOff(note) {
        if (!this.isReady) return;
        
        this.wasmModule.ccall('jc303_noteOff', 'void', ['number'], [note]);
        this.activeNotes.delete(note);
    }
    
    /**
     * Turn off all notes
     */
    allNotesOff() {
        if (!this.isReady) return;
        
        this.wasmModule.ccall('jc303_allNotesOff', 'void', [], []);
        this.activeNotes.clear();
    }
    
    // ==================== Parameter Control ====================
    
    /**
     * Set waveform blend (0 = saw, 1 = square)
     */
    setWaveform(value) {
        this.parameters.waveform = Math.max(0, Math.min(1, value));
        if (this.wasmModule) this.wasmModule.ccall('jc303_setWaveform', 'void', ['number'], [this.parameters.waveform]);
    }
    
    /**
     * Set tuning (0-1, maps to 400-480 Hz for A4)
     */
    setTuning(value) {
        this.parameters.tuning = Math.max(0, Math.min(1, value));
        if (this.wasmModule) this.wasmModule.ccall('jc303_setTuning', 'void', ['number'], [this.parameters.tuning]);
    }
    
    /**
     * Set filter cutoff (0-1)
     */
    setCutoff(value) {
        this.parameters.cutoff = Math.max(0, Math.min(1, value));
        if (this.wasmModule) this.wasmModule.ccall('jc303_setCutoff', 'void', ['number'], [this.parameters.cutoff]);
    }
    
    /**
     * Set filter resonance (0-1)
     */
    setResonance(value) {
        this.parameters.resonance = Math.max(0, Math.min(1, value));
        if (this.wasmModule) this.wasmModule.ccall('jc303_setResonance', 'void', ['number'], [this.parameters.resonance]);
    }
    
    /**
     * Set envelope modulation depth (0-1)
     */
    setEnvMod(value) {
        this.parameters.envmod = Math.max(0, Math.min(1, value));
        if (this.wasmModule) this.wasmModule.ccall('jc303_setEnvMod', 'void', ['number'], [this.parameters.envmod]);
    }
    
    /**
     * Set decay time (0-1)
     */
    setDecay(value) {
        this.parameters.decay = Math.max(0, Math.min(1, value));
        if (this.wasmModule) this.wasmModule.ccall('jc303_setDecay', 'void', ['number'], [this.parameters.decay]);
    }
    
    /**
     * Set accent amount (0-1)
     */
    setAccent(value) {
        this.parameters.accent = Math.max(0, Math.min(1, value));
        if (this.wasmModule) this.wasmModule.ccall('jc303_setAccent', 'void', ['number'], [this.parameters.accent]);
    }
    
    /**
     * Set volume (0-1)
     */
    setVolume(value) {
        this.parameters.volume = Math.max(0, Math.min(1, value));
        if (this.wasmModule) this.wasmModule.ccall('jc303_setVolume', 'void', ['number'], [this.parameters.volume]);
    }
    
    /**
     * Enable/disable mod mode (extended Devil Fish-style parameters)
     */
    setModEnabled(enabled) {
        this.parameters.modEnabled = enabled;
        if (this.wasmModule) {
            this.wasmModule.ccall('jc303_setModEnabled', 'void', ['number'], [enabled ? 1 : 0]);
            if (enabled) {
                // Apply mod parameters when enabling
                this.wasmModule.ccall('jc303_setNormalDecay', 'void', ['number'], [this.parameters.normalDecay]);
                this.wasmModule.ccall('jc303_setAccentDecay', 'void', ['number'], [this.parameters.accentDecay]);
                this.wasmModule.ccall('jc303_setFeedbackFilter', 'void', ['number'], [this.parameters.feedbackFilter]);
                this.wasmModule.ccall('jc303_setSoftAttack', 'void', ['number'], [this.parameters.softAttack]);
                this.wasmModule.ccall('jc303_setSlideTime', 'void', ['number'], [this.parameters.slideTime]);
                this.wasmModule.ccall('jc303_setSquareDriver', 'void', ['number'], [this.parameters.squareDriver]);
            }
        }
    }
    
    // MOD parameters (only active when mod is enabled)
    
    setNormalDecay(value) {
        this.parameters.normalDecay = Math.max(0, Math.min(1, value));
        if (this.wasmModule && this.parameters.modEnabled) {
            this.wasmModule.ccall('jc303_setNormalDecay', 'void', ['number'], [this.parameters.normalDecay]);
        }
    }
    
    setAccentDecay(value) {
        this.parameters.accentDecay = Math.max(0, Math.min(1, value));
        if (this.wasmModule && this.parameters.modEnabled) {
            this.wasmModule.ccall('jc303_setAccentDecay', 'void', ['number'], [this.parameters.accentDecay]);
        }
    }
    
    setFeedbackFilter(value) {
        this.parameters.feedbackFilter = Math.max(0, Math.min(1, value));
        if (this.wasmModule && this.parameters.modEnabled) {
            this.wasmModule.ccall('jc303_setFeedbackFilter', 'void', ['number'], [this.parameters.feedbackFilter]);
        }
    }
    
    setSoftAttack(value) {
        this.parameters.softAttack = Math.max(0, Math.min(1, value));
        if (this.wasmModule && this.parameters.modEnabled) {
            this.wasmModule.ccall('jc303_setSoftAttack', 'void', ['number'], [this.parameters.softAttack]);
        }
    }
    
    setSlideTime(value) {
        this.parameters.slideTime = Math.max(0, Math.min(1, value));
        if (this.wasmModule && this.parameters.modEnabled) {
            this.wasmModule.ccall('jc303_setSlideTime', 'void', ['number'], [this.parameters.slideTime]);
        }
    }
    
    setSquareDriver(value) {
        this.parameters.squareDriver = Math.max(0, Math.min(1, value));
        if (this.wasmModule && this.parameters.modEnabled) {
            this.wasmModule.ccall('jc303_setSquareDriver', 'void', ['number'], [this.parameters.squareDriver]);
        }
    }
    
    /**
     * Set pitch bend in semitones
     */
    setPitchBend(semitones) {
        if (this.wasmModule) this.wasmModule.ccall('jc303_setPitchBend', 'void', ['number'], [semitones]);
    }
    
    // ==================== Utility ====================
    
    /**
     * Get current parameters
     */
    getParameters() {
        return { ...this.parameters };
    }
    
    /**
     * Set multiple parameters at once
     */
    setParameters(params) {
        for (const [key, value] of Object.entries(params)) {
            const setter = `set${key.charAt(0).toUpperCase() + key.slice(1)}`;
            if (typeof this[setter] === 'function') {
                this[setter](value);
            }
        }
    }
    
    /**
     * Cleanup resources
     */
    destroy() {
        this.allNotesOff();
        
        if (this.processorNode) {
            this.processorNode.disconnect();
            this.processorNode = null;
        }
        
        if (this.gainNode) {
            this.gainNode.disconnect();
            this.gainNode = null;
        }
        
        if (this.wasmModule) {
            this.wasmModule.ccall('jc303_cleanup', 'void', [], []);
            this.wasmModule = null;
        }
        
        this.isReady = false;
    }
}

// Export for different module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = JC303;
} else if (typeof window !== 'undefined') {
    window.JC303 = JC303;
}
