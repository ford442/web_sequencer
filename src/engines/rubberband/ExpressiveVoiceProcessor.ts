/**
 * ExpressiveVoiceProcessor - Vibrato, dynamics, and breath modulation for natural singing
 * 
 * Part of RUBBERBAND_ENHANCEMENT_PLAN Section 5: Expressiveness Layer
 * 
 * Applies musical expression effects as post-processing:
 * - Vibrato: LFO-based pitch modulation (5-7 Hz for natural singing) via delay line
 * - Tremolo: Amplitude modulation for dynamic expression
 * - Breath noise: Adds realistic breathiness to vocals using pre-generated noise
 * 
 * @see RUBBERBAND_ENHANCEMENT_PLAN.md Section 5
 */

/** Configuration for vibrato effect */
export interface VibratoConfig {
    /** Vibrato rate in Hz (typical: 5-7 Hz for natural singing) */
    rate: number;
    /** Vibrato depth as a factor (0.0 - 1.0, typical: 0.02 - 0.05) */
    depth: number;
    /** Whether vibrato is enabled */
    enabled: boolean;
    /** Delay before vibrato starts (in seconds, for held notes) */
    delay?: number;
    /** Ramp time to full vibrato depth (in seconds) */
    rampTime?: number;
}

/** Configuration for tremolo effect */
export interface TremoloConfig {
    /** Tremolo rate in Hz */
    rate: number;
    /** Tremolo depth as a factor (0.0 - 1.0) */
    depth: number;
    /** Whether tremolo is enabled */
    enabled: boolean;
}

/** Configuration for breath noise */
export interface BreathConfig {
    /** Breathiness amount (0.0 - 1.0) */
    amount: number;
    /** High-pass filter cutoff for breath noise (Hz) - NOT IMPLEMENTED in basic version */
    filterCutoff: number;
    /** Whether breath noise is enabled */
    enabled: boolean;
}

/** Configuration for amplitude envelope */
export interface EnvelopeConfig {
    /** Attack time in seconds */
    attack: number;
    /** Decay time in seconds */
    decay: number;
    /** Sustain level (0.0 - 1.0) */
    sustain: number;
    /** Release time in seconds */
    release: number;
}

/** Full configuration for expressive voice processing */
export interface ExpressiveConfig {
    vibrato: VibratoConfig;
    tremolo: TremoloConfig;
    breath: BreathConfig;
    envelope: EnvelopeConfig;
    /** Sample rate for processing */
    sampleRate: number;
}

/** Default expressive configuration for natural singing */
export const DEFAULT_EXPRESSIVE_CONFIG: ExpressiveConfig = {
    vibrato: {
        rate: 5.5,
        depth: 0.03,
        enabled: true,
        delay: 0.2,
        rampTime: 0.15
    },
    tremolo: {
        rate: 5.0,
        depth: 0.1,
        enabled: false
    },
    breath: {
        amount: 0.05,
        filterCutoff: 2000,
        enabled: true
    },
    envelope: {
        attack: 0.05,
        decay: 0.1,
        sustain: 1.0,
        release: 0.1
    },
    sampleRate: 44100
};

/**
 * Simple delay line for vibrato implementation.
 * Uses circular buffer for efficient sample delay.
 */
class DelayLine {
    private buffer: Float32Array;
    private writeIndex: number = 0;
    private size: number;
    
    constructor(maxDelaySamples: number) {
        // Ensure size is power of 2 for bitwise masking optimization if needed,
        // but simple modulo is fine for now.
        this.size = maxDelaySamples;
        this.buffer = new Float32Array(maxDelaySamples);
    }
    
    write(sample: number): void {
        this.buffer[this.writeIndex] = sample;
        this.writeIndex = (this.writeIndex + 1) % this.size;
    }
    
    read(delaySamples: number): number {
        // Linear interpolation for fractional delays
        const intDelay = Math.floor(delaySamples);
        const frac = delaySamples - intDelay;
        
        // Calculate read index: writeIndex - delay - 1
        // We add this.size multiple times to ensure positivity before modulo
        let index1 = (this.writeIndex - intDelay - 1);
        if (index1 < 0) index1 += this.size;

        let index2 = index1 - 1;
        if (index2 < 0) index2 += this.size;
        
        return this.buffer[index1] * (1 - frac) + this.buffer[index2] * frac;
    }
    
    clear(): void {
        this.buffer.fill(0);
        this.writeIndex = 0;
    }
}

/**
 * ExpressiveVoiceProcessor class for adding musical expression to vocals.
 * Designed to run in AudioWorklet.
 */
export class ExpressiveVoiceProcessor {
    private config: ExpressiveConfig;
    private delayLine: DelayLine;

    // LFO States
    private vibratoPhase: number = 0;
    private tremoloPhase: number = 0;

    // Noise Generation
    private noiseBuffer: Float32Array;
    private noiseIndex: number = 0;

    // Time tracking
    private sampleIndex: number = 0;
    private currentTime: number = 0;
    
    // Envelope states
    private envelopePhase: 'idle' | 'attack' | 'decay' | 'sustain' | 'release' = 'idle';
    private envelopeValue: number = 0;
    private scheduledNoteOffTime: number = Infinity;

    constructor(config: Partial<ExpressiveConfig> = {}) {
        this.config = { ...DEFAULT_EXPRESSIVE_CONFIG, ...config };
        
        // Initialize Delay Line
        // Max delay for vibrato: 20ms should be plenty for standard vibrato
        const maxDelaySamples = Math.ceil(0.02 * this.config.sampleRate);
        this.delayLine = new DelayLine(maxDelaySamples);
        
        // Pre-generate noise for breath effect (1 second loop)
        const noiseSize = this.config.sampleRate;
        this.noiseBuffer = new Float32Array(noiseSize);
        // Simple white noise generation - in production, we might want pink noise
        // or filtered noise, but white noise + low gain works for breathiness.
        for (let i = 0; i < noiseSize; i++) {
            this.noiseBuffer[i] = Math.random() * 2 - 1;
        }
    }
    
    /**
     * Set the current global time of the audio context (used for scheduling)
     */
    setCurrentTime(time: number): void {
        this.currentTime = time;
    }

    /**
     * Process a buffer of audio samples in-place or to a new buffer.
     * 
     * @param input Input buffer
     * @param output Output buffer (can be same as input)
     */
    process(input: Float32Array, output: Float32Array): void {
        const len = input.length;
        const sampleRate = this.config.sampleRate;
        
        // Destructure config for faster access
        const vib = this.config.vibrato;
        const trem = this.config.tremolo;
        const breath = this.config.breath;
        const env = this.config.envelope;
        
        // Constants for this block
        const dt = 1.0 / sampleRate;
        const vibIncrement = vib.rate * dt * 2 * Math.PI;
        const tremIncrement = trem.rate * dt * 2 * Math.PI;
        
        // Max delay for vibrato calculation (10ms typical)
        const maxVibDelayMs = 10;
        const maxVibDelaySamples = (maxVibDelayMs * sampleRate) / 1000;

        for (let i = 0; i < len; i++) {
            let sample = input[i];
            const sampleTimeLocal = this.sampleIndex * dt;
            const sampleTimeGlobal = this.currentTime + (i * dt);

            // Check scheduled NoteOff
            if (this.envelopePhase !== 'release' && this.envelopePhase !== 'idle') {
                if (sampleTimeGlobal >= this.scheduledNoteOffTime) {
                    this.envelopePhase = 'release';
                }
            }

            // 1. Vibrato (Pitch Modulation via Delay)
            if (vib.enabled && vib.depth > 0) {
                // Update Phase
                this.vibratoPhase += vibIncrement;
                if (this.vibratoPhase > 2 * Math.PI) this.vibratoPhase -= 2 * Math.PI;

                // Calculate Envelope (Delay/Ramp)
                let envelope = 1.0;
                const delay = vib.delay || 0;
                const ramp = vib.rampTime || 0.1;

                if (sampleTimeLocal < delay) {
                    envelope = 0.0;
                } else if (sampleTimeLocal < delay + ramp) {
                    envelope = (sampleTimeLocal - delay) / ramp;
                }

                // LFO (-1 to 1)
                const lfo = Math.sin(this.vibratoPhase);

                // Modulate Delay
                // Base delay is needed so we can modulate +/-
                // We use half the max delay as the center point
                // Depth controls the swing amplitude

                // A simplified approach for "Pitch" vibrato via delay:
                // Varying delay length changes pitch (Doppler effect).
                // d(delay)/dt determines pitch shift.

                // However, for SingingVoice, we typically want "Vibrato" as pitch oscillation.
                // Using a modulated delay line is a standard way to achieve this without resampling the whole buffer again.
                // delay(t) = avg_delay + depth * sin(w*t)

                const modDelay = (1.0 + vib.depth * envelope * lfo) * (maxVibDelaySamples * 0.5);

                this.delayLine.write(sample);
                sample = this.delayLine.read(modDelay);
            }

            // 2. Tremolo (AM)
            if (trem.enabled && trem.depth > 0) {
                this.tremoloPhase += tremIncrement;
                if (this.tremoloPhase > 2 * Math.PI) this.tremoloPhase -= 2 * Math.PI;

                const tremLfo = Math.sin(this.tremoloPhase);
                // standard tremolo: 1 - depth/2 * (1 + sin)
                const mod = 1.0 - (trem.depth * 0.5 * (1.0 + tremLfo));
                sample *= mod;
            }

            // 3. Breath Noise
            if (breath.enabled && breath.amount > 0) {
                const noiseSample = this.noiseBuffer[this.noiseIndex];
                this.noiseIndex = (this.noiseIndex + 1) % this.noiseBuffer.length;

                // Simple mixing
                sample += noiseSample * breath.amount * 0.1; // Scale down noise significantly
            }

            // 4. Amplitude Envelope
            if (this.envelopePhase === 'attack') {
                if (env.attack > 0) {
                    this.envelopeValue += dt / env.attack;
                    if (this.envelopeValue >= 1.0) {
                        this.envelopeValue = 1.0;
                        this.envelopePhase = 'decay';
                    }
                } else {
                    this.envelopeValue = 1.0;
                    this.envelopePhase = 'decay';
                }
            } else if (this.envelopePhase === 'decay') {
                if (env.decay > 0) {
                    // Decay from 1.0 down to sustain level
                    this.envelopeValue -= (1.0 - env.sustain) * (dt / env.decay);
                    if (this.envelopeValue <= env.sustain) {
                        this.envelopeValue = env.sustain;
                        this.envelopePhase = 'sustain';
                    }
                } else {
                    this.envelopeValue = env.sustain;
                    this.envelopePhase = 'sustain';
                }
            } else if (this.envelopePhase === 'release') {
                if (env.release > 0) {
                    this.envelopeValue -= dt / env.release;
                    if (this.envelopeValue <= 0.0) {
                        this.envelopeValue = 0.0;
                        this.envelopePhase = 'idle';
                    }
                } else {
                    this.envelopeValue = 0.0;
                    this.envelopePhase = 'idle';
                }
            } else if (this.envelopePhase === 'idle') {
                this.envelopeValue = 0.0;
            } else if (this.envelopePhase === 'sustain') {
                this.envelopeValue = env.sustain;
            }

            sample *= this.envelopeValue;

            output[i] = sample;
            this.sampleIndex++;
        }
    }

    /**
     * Trigger Note On envelope phase
     */
    noteOn(): void {
        this.envelopePhase = 'attack';
        this.scheduledNoteOffTime = Infinity;
        // We do not reset this.envelopeValue to 0 if it's currently releasing
        // to avoid clicking on rapid retriggers. We just start climbing from current.
    }

    /**
     * Trigger Note Off envelope phase
     * @param targetTime Optional global time to trigger release
     */
    noteOff(targetTime?: number): void {
        if (targetTime !== undefined && targetTime > this.currentTime) {
            this.scheduledNoteOffTime = targetTime;
        } else {
            this.envelopePhase = 'release';
        }
    }
    
    /**
     * Update configuration parameters dynamically.
     */
    updateConfig(newConfig: Partial<ExpressiveConfig>): void {
        // Deep merge logic simplified for specific nested objects
        if (newConfig.vibrato) {
            this.config.vibrato = { ...this.config.vibrato, ...newConfig.vibrato };
        }
        if (newConfig.tremolo) {
            this.config.tremolo = { ...this.config.tremolo, ...newConfig.tremolo };
        }
        if (newConfig.breath) {
            this.config.breath = { ...this.config.breath, ...newConfig.breath };
        }
        if (newConfig.envelope) {
            this.config.envelope = { ...this.config.envelope, ...newConfig.envelope };
        }
        if (newConfig.sampleRate) {
            this.config.sampleRate = newConfig.sampleRate;
        }
    }
    
    /**
     * Get the current amplitude envelope value (0-1).
     * Useful for envelope followers that want to modulate other parameters.
     */
    getCurrentEnvelopeValue(): number {
        return this.envelopeValue;
    }

    /**
     * Reset internal state (phases, etc.)
     */
    reset(): void {
        this.vibratoPhase = 0;
        this.tremoloPhase = 0;
        this.noiseIndex = 0;
        this.sampleIndex = 0;
        this.delayLine.clear();
    }
}
