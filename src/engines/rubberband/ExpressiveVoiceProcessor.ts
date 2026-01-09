/**
 * ExpressiveVoiceProcessor - Vibrato, dynamics, and breath modulation for natural singing
 * 
 * Part of RUBBERBAND_ENHANCEMENT_PLAN Section 5: Expressiveness Layer
 * 
 * Applies musical expression effects as post-processing:
 * - Vibrato: LFO-based pitch modulation (5-7 Hz for natural singing)
 * - Tremolo: Amplitude modulation for dynamic expression
 * - Breath noise: Adds realistic breathiness to vocals
 * 
 * STUB FILE - Implementation pending.
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
    /** High-pass filter cutoff for breath noise (Hz) */
    filterCutoff: number;
    /** Whether breath noise is enabled */
    enabled: boolean;
}

/** Full configuration for expressive voice processing */
export interface ExpressiveConfig {
    vibrato: VibratoConfig;
    tremolo: TremoloConfig;
    breath: BreathConfig;
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
    sampleRate: 48000
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
        
        const index1 = (this.writeIndex - intDelay - 1 + this.size) % this.size;
        const index2 = (index1 - 1 + this.size) % this.size;
        
        return this.buffer[index1] * (1 - frac) + this.buffer[index2] * frac;
    }
    
    clear(): void {
        this.buffer.fill(0);
        this.writeIndex = 0;
    }
}

/**
 * ExpressiveVoiceProcessor class for adding musical expression to vocals.
 * 
 * STUB - Partial implementation for reference.
 * Full implementation should run in an AudioWorklet for real-time processing.
 */
export class ExpressiveVoiceProcessor {
    private config: ExpressiveConfig;
    private delayLine: DelayLine;
    private lfoPhase: number = 0;
    private noiseBuffer: Float32Array;
    private noiseIndex: number = 0;
    private sampleIndex: number = 0;
    
    constructor(config: Partial<ExpressiveConfig> = {}) {
        this.config = { ...DEFAULT_EXPRESSIVE_CONFIG, ...config };
        
        // Max delay for vibrato (10ms at sample rate)
        const maxDelay = Math.ceil(0.01 * this.config.sampleRate);
        this.delayLine = new DelayLine(maxDelay);
        
        // Pre-generate noise for breath effect
        // Note: Math.random() is used here as a stub. Production implementation
        // should use a proper PRNG with seeding (e.g., xorshift128) for consistent
        // and higher-quality noise generation suitable for audio applications.
        this.noiseBuffer = new Float32Array(this.config.sampleRate);
        for (let i = 0; i < this.noiseBuffer.length; i++) {
            this.noiseBuffer[i] = Math.random() * 2 - 1;
        }
    }
    
    /**
     * Process a single audio sample with expressive effects.
     * 
     * @param input Input sample
     * @returns Processed sample with expression
     */
    processSample(input: number): number {
        let output = input;
        
        // Calculate current time in seconds
        const time = this.sampleIndex / this.config.sampleRate;
        
        // Apply vibrato (using delay-based pitch modulation)
        if (this.config.vibrato.enabled) {
            output = this.applyVibrato(output, time);
        }
        
        // Apply tremolo
        if (this.config.tremolo.enabled) {
            output = this.applyTremolo(output);
        }
        
        // Add breath noise
        if (this.config.breath.enabled) {
            output = this.addBreathNoise(output);
        }
        
        this.sampleIndex++;
        return output;
    }
    
    /**
     * Apply vibrato using a delay line with LFO modulation.
     */
    private applyVibrato(input: number, time: number): number {
        const { rate, depth, delay = 0, rampTime = 0.1 } = this.config.vibrato;
        
        // Calculate vibrato envelope (delayed onset with ramp)
        let envelope = 1.0;
        if (time < delay) {
            envelope = 0;
        } else if (time < delay + rampTime) {
            envelope = (time - delay) / rampTime;
        }
        
        // LFO for pitch modulation
        const lfo = Math.sin(2 * Math.PI * rate * time);
        
        // Convert depth to delay samples (depth * lfo * maxDelayMs)
        const maxDelayMs = 10;
        const delaySamples = (1 + depth * envelope * lfo) * maxDelayMs * this.config.sampleRate / 1000;
        
        // Write to delay line and read with modulated delay
        this.delayLine.write(input);
        return this.delayLine.read(delaySamples);
    }
    
    /**
     * Apply tremolo (amplitude modulation).
     */
    private applyTremolo(input: number): number {
        const { rate, depth } = this.config.tremolo;
        
        // Update LFO phase
        this.lfoPhase += (2 * Math.PI * rate) / this.config.sampleRate;
        if (this.lfoPhase > 2 * Math.PI) {
            this.lfoPhase -= 2 * Math.PI;
        }
        
        // Apply amplitude modulation
        const modulation = 1 - depth * 0.5 * (1 + Math.sin(this.lfoPhase));
        return input * modulation;
    }
    
    /**
     * Add breath noise for realistic vocal sound.
     */
    private addBreathNoise(input: number): number {
        const { amount } = this.config.breath;
        
        // Get noise sample (simple high-pass filtered noise)
        const noise = this.noiseBuffer[this.noiseIndex];
        this.noiseIndex = (this.noiseIndex + 1) % this.noiseBuffer.length;
        
        // Mix noise with input (envelope-following would be better)
        return input + noise * amount * Math.abs(input);
    }
    
    /**
     * Process a buffer of audio samples.
     * 
     * @param input Input buffer
     * @returns Processed buffer
     */
    processBuffer(input: Float32Array): Float32Array {
        const output = new Float32Array(input.length);
        for (let i = 0; i < input.length; i++) {
            output[i] = this.processSample(input[i]);
        }
        return output;
    }
    
    /**
     * Update vibrato configuration.
     */
    setVibrato(config: Partial<VibratoConfig>): void {
        this.config.vibrato = { ...this.config.vibrato, ...config };
    }
    
    /**
     * Update tremolo configuration.
     */
    setTremolo(config: Partial<TremoloConfig>): void {
        this.config.tremolo = { ...this.config.tremolo, ...config };
    }
    
    /**
     * Update breath configuration.
     */
    setBreath(config: Partial<BreathConfig>): void {
        this.config.breath = { ...this.config.breath, ...config };
    }
    
    /**
     * Reset processor state (call when starting a new note).
     */
    reset(): void {
        this.delayLine.clear();
        this.lfoPhase = 0;
        this.noiseIndex = 0;
        this.sampleIndex = 0;
    }
}

/**
 * TODO: Future implementation notes
 * 
 * 1. Port to AudioWorkletProcessor for real-time low-latency processing
 * 2. Add envelope follower for amplitude-based modulation depth
 * 3. Implement portamento (pitch glides between notes)
 * 4. Add dynamics processor with compression/expansion
 * 5. Create presets for different singing styles (opera, pop, jazz, etc.)
 * 6. Integrate with MIDI for expression control (mod wheel, aftertouch)
 */
