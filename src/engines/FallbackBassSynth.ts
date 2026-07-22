/**
 * FallbackBassSynth - Simple TB-303-style bass synth
 * 
 * Used when the JC-303 WASM fails to load due to stack overflow.
 * Provides similar sound characteristics using standard Web Audio API.
 */

type BassOscillatorNode = OscillatorNode & { envGain?: GainNode };

function createStubBiquadFilter(): BiquadFilterNode {
    return {
        type: 'lowpass',
        frequency: {
            value: 1000,
            cancelScheduledValues: () => {},
            setValueAtTime: () => {},
            setTargetAtTime: () => {},
        },
        Q: { value: 10 },
        connect: () => {},
        disconnect: () => {},
    } as unknown as BiquadFilterNode;
}

function createStubOscillator(): BassOscillatorNode {
    return {
        type: 'sawtooth',
        frequency: { value: 440, setTargetAtTime: () => {} },
        start: () => {},
        stop: () => {},
        connect: () => {},
        disconnect: () => {},
    } as unknown as BassOscillatorNode;
}

function createStubGain(): GainNode {
    return {
        gain: {
            value: 0,
            setTargetAtTime: () => {},
            cancelScheduledValues: () => {},
        },
        connect: () => {},
        disconnect: () => {},
    } as unknown as GainNode;
}

export class FallbackBassSynth {
    private audioContext: AudioContext;
    private outputNode: GainNode;
    private filterNode: BiquadFilterNode;
    private currentOscillator: BassOscillatorNode | null = null;
    private currentNote: number = -1;
    // private filterEnvAmount: number = 0; // Reserved for future filter envelope
    private isSlide: boolean = false;
    
    // Parameters (0-1 range, matching Open303 interface)
    private params = {
        waveform: 1.0,      // 0 = saw, 1 = square
        cutoff: 0.3,        // Filter cutoff (0-1)
        resonance: 0.5,     // Filter resonance (0-1)
        decay: 0.3,         // Envelope decay (0-1)
        envMod: 0.5,        // Envelope amount (0-1)
        accent: 0.5,        // Accent amount (0-1)
        volume: 0.75        // Output volume (0-1)
    };

    constructor(audioContext: AudioContext) {
        this.audioContext = audioContext;
        
        // Create filter
        this.filterNode = typeof audioContext.createBiquadFilter === 'function'
            ? audioContext.createBiquadFilter()
            : createStubBiquadFilter();
        this.filterNode.type = 'lowpass';
        this.filterNode.frequency.value = 1000;
        this.filterNode.Q.value = 10;
        
        // Create output
        this.outputNode = audioContext.createGain();
        this.outputNode.gain.value = 0.5;
        
        // Connect
        this.filterNode.connect(this.outputNode);
    }

    connect(destination: AudioNode): void {
        this.outputNode.connect(destination);
    }

    disconnect(): void {
        this.outputNode.disconnect();
    }

    setWaveform(value: number): void {
        this.params.waveform = value;
        if (this.currentOscillator) {
            this.currentOscillator.type = value > 0.5 ? 'square' : 'sawtooth';
        }
    }

    setCutoff(value: number): void {
        this.params.cutoff = value;
        // Map 0-1 to 100-5000 Hz
        this.filterNode.frequency.value = 100 + value * 4900;
    }

    setResonance(value: number): void {
        this.params.resonance = value;
        // Map 0-1 to Q of 0-20
        this.filterNode.Q.value = value * 20;
    }

    setDecay(value: number): void {
        this.params.decay = value;
    }

    setEnvMod(value: number): void {
        this.params.envMod = value;
    }

    setAccent(value: number): void {
        this.params.accent = value;
    }

    setVolume(value: number): void {
        this.params.volume = value;
        this.outputNode.gain.value = value * 0.5;
    }

    noteOn(midiNote: number, velocity: number = 100): void {
        const now = this.audioContext.currentTime;
        const freq = 440 * Math.pow(2, (midiNote - 69) / 12);
        
        // Determine if this is an accented note
        const isAccent = velocity > 100;
        const accentBoost = isAccent ? this.params.accent : 0;
        
        // Release previous note
        if (this.currentOscillator) {
            if (this.isSlide) {
                // Slide mode - don't cut off, just change frequency
                this.currentOscillator.frequency.setTargetAtTime(freq, now, 0.06);
            } else {
                // Normal mode - quick release then new note
                this.releaseNote(now);
            }
        }
        
        if (!this.isSlide || !this.currentOscillator) {
            // Create new oscillator
            const osc: BassOscillatorNode = typeof this.audioContext.createOscillator === 'function'
                ? (this.audioContext.createOscillator() as BassOscillatorNode)
                : createStubOscillator();
            osc.type = this.params.waveform > 0.5 ? 'square' : 'sawtooth';
            osc.frequency.value = freq;
            
            // Create envelope gain
            const envGain = typeof this.audioContext.createGain === 'function'
                ? this.audioContext.createGain()
                : createStubGain();
            envGain.gain.value = 0;
            
            // Connect
            osc.connect(envGain);
            envGain.connect(this.filterNode);
            
            // Start
            osc.start(now);
            
            // Attack
            const attackTime = 0.005;
            const initialLevel = 0.3 + accentBoost * 0.4;
            envGain.gain.setTargetAtTime(initialLevel, now, attackTime);
            
            // Decay
            const decayTime = 0.1 + this.params.decay * 0.5;
            envGain.gain.setTargetAtTime(0.1, now + attackTime, decayTime * 0.3);
            
            // Filter envelope
            const baseFreq = 100 + this.params.cutoff * 4900;
            const envAmount = this.params.envMod * 3000;
            const peakFreq = Math.min(20000, baseFreq + envAmount * (1 + accentBoost));
            
            this.filterNode.frequency.cancelScheduledValues(now);
            this.filterNode.frequency.setValueAtTime(baseFreq, now);
            this.filterNode.frequency.setTargetAtTime(peakFreq, now, attackTime);
            this.filterNode.frequency.setTargetAtTime(baseFreq, now + attackTime, decayTime * 0.4);
            
            this.currentOscillator = osc;
            this.currentNote = midiNote;
            
            // Store envelope gain for release
            osc.envGain = envGain;
        }
    }

    noteOff(midiNote: number): void {
        if (this.currentNote === midiNote) {
            this.releaseNote(this.audioContext.currentTime);
        }
    }

    private releaseNote(time: number): void {
        if (!this.currentOscillator) return;
        
        const osc = this.currentOscillator;
        const envGain = osc.envGain;
        
        if (envGain) {
            // Quick release
            envGain.gain.cancelScheduledValues(time);
            envGain.gain.setTargetAtTime(0, time, 0.05);
        }
        
        // Stop after release
        const stopTime = time + 0.1;
        try {
            osc.stop(stopTime);
        } catch (e) {
            // Ignore if already stopped
        }
        
        // Cleanup
        setTimeout(() => {
            try {
                osc.disconnect();
                envGain?.disconnect();
            } catch (e) {
                // Ignore cleanup errors
            }
        }, 200);
        
        this.currentOscillator = null;
        this.currentNote = -1;
    }

    allNotesOff(): void {
        this.releaseNote(this.audioContext.currentTime);
    }

    cleanup(): void {
        this.allNotesOff();
        this.outputNode.disconnect();
    }
}

export default FallbackBassSynth;
