/**
 * JC-303 Audio Worklet Processor
 * 
 * This AudioWorkletProcessor uses the JC-303 WASM module to generate
 * TB-303 synthesizer audio in real-time within a Web Audio context.
 * 
 * Licensed under GPL-3.0
 */

// Import the WASM module (will be inlined in jc303_worklet.js)
import JC303WorkletModule from './jc303_worklet.js';

class JC303Processor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        
        this.wasmReady = false;
        this.wasmModule = null;
        this.outputBufferPtr = null;
        
        // Cached WASM memory view for performance
        this.cachedMemoryBuffer = null;
        this.cachedMemoryView = null;
        
        // Queue for MIDI events and parameter changes
        this.messageQueue = [];
        
        // Initialize the WASM module
        this.initWasm();
        
        // Handle messages from the main thread
        this.port.onmessage = (event) => {
            this.handleMessage(event.data);
        };
    }
    
    async initWasm() {
        try {
            this.wasmModule = await JC303WorkletModule();
            
            // Initialize the synthesizer with the AudioWorklet sample rate
            const success = this.wasmModule.init(sampleRate, 128);
            
            if (success) {
                this.wasmReady = true;
                this.port.postMessage({ type: 'ready' });
            } else {
                this.port.postMessage({ type: 'error', message: 'Failed to initialize WASM module' });
            }
        } catch (error) {
            this.port.postMessage({ type: 'error', message: error.toString() });
        }
    }
    
    handleMessage(data) {
        if (!this.wasmReady) {
            // Queue the message for later processing
            this.messageQueue.push(data);
            return;
        }
        
        this.processMessage(data);
    }
    
    processMessage(data) {
        if (!this.wasmModule) return;
        
        switch (data.type) {
            case 'noteOn':
                this.wasmModule.noteOn(data.note, data.velocity);
                break;
                
            case 'noteOff':
                this.wasmModule.noteOff(data.note);
                break;
                
            case 'allNotesOff':
                this.wasmModule.allNotesOff();
                break;
                
            case 'setParameter':
                this.setParameter(data.param, data.value);
                break;
                
            case 'setModEnabled':
                this.wasmModule.setModEnabled(data.enabled ? 1 : 0);
                break;
        }
    }
    
    setParameter(param, value) {
        if (!this.wasmModule) return;
        
        switch (param) {
            case 'waveform':
                this.wasmModule.setWaveform(value);
                break;
            case 'tuning':
                this.wasmModule.setTuning(value);
                break;
            case 'cutoff':
                this.wasmModule.setCutoff(value);
                break;
            case 'resonance':
                this.wasmModule.setResonance(value);
                break;
            case 'envmod':
                this.wasmModule.setEnvMod(value);
                break;
            case 'decay':
                this.wasmModule.setDecay(value);
                break;
            case 'accent':
                this.wasmModule.setAccent(value);
                break;
            case 'volume':
                this.wasmModule.setVolume(value);
                break;
            case 'normalDecay':
                this.wasmModule.setNormalDecay(value);
                break;
            case 'accentDecay':
                this.wasmModule.setAccentDecay(value);
                break;
            case 'feedbackFilter':
                this.wasmModule.setFeedbackFilter(value);
                break;
            case 'softAttack':
                this.wasmModule.setSoftAttack(value);
                break;
            case 'slideTime':
                this.wasmModule.setSlideTime(value);
                break;
            case 'squareDriver':
                this.wasmModule.setSquareDriver(value);
                break;
            case 'pitchBend':
                this.wasmModule.setPitchBend(value);
                break;
        }
    }
    
    process(inputs, outputs, parameters) {
        const output = outputs[0];
        const channel = output[0];
        
        if (!this.wasmReady || !channel) {
            return true;
        }
        
        // Process any queued messages
        while (this.messageQueue.length > 0) {
            this.processMessage(this.messageQueue.shift());
        }
        
        // Generate audio samples
        const numSamples = channel.length;
        const bufferPtr = this.wasmModule.process(numSamples);
        
        if (bufferPtr) {
            // Check if WASM memory buffer has changed (can happen on memory growth)
            // Only recreate the view when necessary for better performance
            const currentBuffer = this.wasmModule.HEAPF32.buffer;
            if (this.cachedMemoryBuffer !== currentBuffer) {
                this.cachedMemoryBuffer = currentBuffer;
                this.cachedMemoryView = null; // Force recreation
            }
            
            // Create or reuse memory view
            if (!this.cachedMemoryView || this.cachedMemoryView.length !== numSamples) {
                this.cachedMemoryView = new Float32Array(
                    currentBuffer,
                    bufferPtr,
                    numSamples
                );
            }
            
            channel.set(this.cachedMemoryView);
            
            // Copy to all output channels (mono to stereo)
            for (let ch = 1; ch < output.length; ch++) {
                output[ch].set(channel);
            }
        }
        
        return true;
    }
}

registerProcessor('jc303-processor', JC303Processor);
