import { RingBuffer } from '../utils/ringBuffer';

/**
 * SingingVoice - High-fidelity vocal synthesis engine
 * 
 * Part of the RUBBERBAND_ENHANCEMENT_PLAN implementation.
 * Integrates Supertonic TTS with Rubber Band for singing synthesis.
 * 
 * Key features:
 * - Multi-resolution pitch caching (Section 2): Pre-render at multiple base pitches
 * - Formant preservation: Avoids "chipmunk effect"
 * - Latency compensation for MIDI sync (Section 9)
 */

/** Reference pitch levels for multi-resolution caching */
export interface PitchCache {
    /** Low register: C3 (~130.8 Hz) */
    low: Float32Array | null;
    /** Mid register: C4 (~261.6 Hz) */
    mid: Float32Array | null;
    /** High register: C5 (~523.3 Hz) */
    high: Float32Array | null;
}

/** Reference frequencies for pitch cache (in Hz) */
export const REFERENCE_FREQUENCIES = {
    low: 130.81,   // C3
    mid: 261.63,   // C4
    high: 523.25   // C5
};

/** Configuration for SingingVoice initialization */
export interface SingingVoiceConfig {
    /** Use high quality (Finer engine) - higher CPU, better quality */
    useHighQuality?: boolean;
    /** Preserve formants to avoid chipmunk effect (default: true) */
    preserveFormants?: boolean;
    /** Number of audio channels (default: 1 for mono voice) */
    channels?: number;
    /** Buffer size for ring buffers (default: 16384) */
    bufferSize?: number;
}

/**
 * Utility to convert MIDI note number to frequency in Hz.
 * @param midiNote MIDI note number (0-127)
 * @returns Frequency in Hz
 */
export function midiToFreq(midiNote: number): number {
    return 440 * Math.pow(2, (midiNote - 69) / 12);
}

/**
 * Utility to convert frequency to MIDI note number.
 * @param freq Frequency in Hz
 * @returns MIDI note number (may be fractional)
 */
export function freqToMidi(freq: number): number {
    return 69 + 12 * Math.log2(freq / 440);
}

export class SingingVoice {
    private audioContext: AudioContext;
    private workletNode: AudioWorkletNode | null = null;
    private inputRingBuffer: RingBuffer;
    private outputRingBuffer: RingBuffer;
    private config: SingingVoiceConfig;
    
    /** Latency of the Rubber Band processor in samples */
    private processorLatency: number = 0;
    
    /** Cache for pre-rendered TTS at different base pitches (Section 2) */
    private pitchCache: PitchCache = {
        low: null,
        mid: null,
        high: null
    };

    constructor(audioContext: AudioContext, config: SingingVoiceConfig = {}) {
        this.audioContext = audioContext;
        this.config = {
            useHighQuality: config.useHighQuality ?? false,
            preserveFormants: config.preserveFormants ?? true,
            channels: config.channels ?? 1,
            bufferSize: config.bufferSize ?? 16384
        };
        
        this.inputRingBuffer = new RingBuffer(this.config.bufferSize!);
        this.outputRingBuffer = new RingBuffer(this.config.bufferSize!);
    }

    async init(): Promise<void> {
        await this.audioContext.audioWorklet.addModule('/rubberband-processor.js');
        this.workletNode = new AudioWorkletNode(this.audioContext, 'rubberband-processor');

        this.workletNode.port.postMessage({
            type: 'init',
            data: {
                inputSab: this.inputRingBuffer.sab,
                outputSab: this.outputRingBuffer.sab,
                config: {
                    useHighQuality: this.config.useHighQuality,
                    preserveFormants: this.config.preserveFormants,
                    channels: this.config.channels
                }
            }
        });

        return new Promise<void>(resolve => {
            this.workletNode!.port.onmessage = (event) => {
                if (event.data.type === 'ready') {
                    // Store latency for synchronization (Section 9)
                    this.processorLatency = event.data.latency ?? 0;
                    resolve();
                } else if (event.data.type === 'latency') {
                    this.processorLatency = event.data.latency;
                }
            };
        });
    }

    getSourceNode(): AudioNode {
        return this.workletNode!;
    }
    
    /**
     * Get the latency of the Rubber Band processor in seconds.
     * Useful for MIDI sync compensation (Section 9).
     */
    getLatencySeconds(): number {
        return this.processorLatency / this.audioContext.sampleRate;
    }
    
    /**
     * Get the latency of the Rubber Band processor in samples.
     */
    getLatencySamples(): number {
        return this.processorLatency;
    }

    /**
     * Process raw audio through the Rubber Band stretcher.
     * @param input Float32Array of audio samples
     */
    process(input: Float32Array): void {
        const chunkSize = 4096;
        let processed = 0;
        while (processed < input.length) {
            const chunk = input.subarray(processed, processed + chunkSize);
            const pushed = this.inputRingBuffer.push(chunk);
            if (pushed === 0) {
                // Buffer is full, wait and retry.
                // In a real application, a more sophisticated back-pressure mechanism
                // might be needed, but for now, a simple loop is a start.
                // This is a placeholder for a more robust solution.
                console.warn("Ring buffer full, dropping audio data.");
                break;
            }
            processed += pushed;
        }
    }

    /**
     * Set the pitch scale for pitch shifting.
     * @param pitchScale Pitch multiplier (e.g., 2.0 = one octave up, 0.5 = one octave down)
     */
    setPitch(pitchScale: number): void {
        this.workletNode?.port.postMessage({
            type: 'pitch',
            data: { pitchScale }
        });
    }
    
    /**
     * Set pitch based on target MIDI note, using the nearest cached base pitch.
     * This minimizes artifacts by keeping shifts within optimal ±1 octave range.
     * Implements Section 2 of the enhancement plan.
     * 
     * @param targetMidiNote Target MIDI note number
     * @param baseMidiNote Optional base MIDI note of the source audio (default: 60 = C4)
     */
    setPitchFromMidi(targetMidiNote: number, baseMidiNote: number = 60): void {
        const targetFreq = midiToFreq(targetMidiNote);
        const baseFreq = midiToFreq(baseMidiNote);
        
        // Calculate pitch ratio, clamped to ±1 octave for best quality
        let pitchRatio = targetFreq / baseFreq;
        pitchRatio = Math.max(0.5, Math.min(2.0, pitchRatio));
        
        this.setPitch(pitchRatio);
    }
    
    /**
     * Get the nearest base pitch level for a target frequency.
     * Used for multi-resolution pitch caching (Section 2).
     * 
     * @param targetMidiNote Target MIDI note number
     * @returns The cache key ('low', 'mid', or 'high') for the nearest base pitch
     */
    getNearestBasePitch(targetMidiNote: number): keyof PitchCache {
        const freq = midiToFreq(targetMidiNote);
        if (freq < 200) return 'low';
        if (freq < 400) return 'mid';
        return 'high';
    }
    
    /**
     * Get the reference frequency for a cache level.
     * @param level The pitch cache level
     * @returns Frequency in Hz
     */
    getReferenceFrequency(level: keyof PitchCache): number {
        return REFERENCE_FREQUENCIES[level];
    }
    
    /**
     * Set cached audio for a specific pitch level.
     * Call this with pre-rendered TTS audio at different reference pitches.
     * 
     * @param level The pitch cache level ('low', 'mid', 'high')
     * @param audio Float32Array of audio samples rendered at the reference pitch
     */
    setCachedAudio(level: keyof PitchCache, audio: Float32Array): void {
        this.pitchCache[level] = audio;
    }
    
    /**
     * Get cached audio for a specific pitch level.
     * @param level The pitch cache level
     * @returns Cached audio or null if not available
     */
    getCachedAudio(level: keyof PitchCache): Float32Array | null {
        return this.pitchCache[level];
    }
    
    /**
     * Process audio with optimal pitch shifting using cached base pitches.
     * Automatically selects the nearest cached base pitch to minimize artifacts.
     * 
     * @param targetMidiNote Target MIDI note for pitch shifting
     * @returns true if processing succeeded, false if no cached audio available
     */
    processWithOptimalPitch(targetMidiNote: number): boolean {
        const cacheLevel = this.getNearestBasePitch(targetMidiNote);
        const cachedAudio = this.pitchCache[cacheLevel];
        
        if (!cachedAudio) {
            console.warn(`No cached audio for level '${cacheLevel}'. Please render TTS first.`);
            return false;
        }
        
        // Calculate pitch shift from the cached base to the target
        const baseFreq = REFERENCE_FREQUENCIES[cacheLevel];
        const targetFreq = midiToFreq(targetMidiNote);
        const pitchRatio = Math.max(0.5, Math.min(2.0, targetFreq / baseFreq));
        
        this.setPitch(pitchRatio);
        this.process(cachedAudio);
        
        return true;
    }

    /**
     * Set the time stretch ratio.
     * @param timeRatio Time multiplier (e.g., 2.0 = twice as long, 0.5 = half as long)
     */
    setTimeRatio(timeRatio: number): void {
        this.workletNode?.port.postMessage({
            type: 'timeRatio',
            data: { timeRatio }
        });
    }
    
    /**
     * Enable or disable formant preservation.
     * When enabled, prevents the "chipmunk effect" on vocals.
     * Implements Section 4 (Formant Shifting) of the enhancement plan.
     * 
     * @param preserve true to preserve formants, false to shift with pitch
     */
    setFormantPreservation(preserve: boolean): void {
        this.workletNode?.port.postMessage({
            type: 'setFormantPreservation',
            data: { preserve }
        });
    }
    
    /**
     * Set the quality mode.
     * High quality uses the "Finer" engine for better vocal fidelity.
     * Fast mode uses the "Faster" engine for lower CPU usage.
     * 
     * Note: Changing quality mode may require processor reinitialization.
     * 
     * @param highQuality true for high quality, false for fast mode
     */
    setQualityMode(highQuality: boolean): void {
        this.workletNode?.port.postMessage({
            type: 'setQuality',
            data: { highQuality }
        });
    }
    
    /**
     * Clear all cached audio to free memory.
     */
    clearCache(): void {
        this.pitchCache = {
            low: null,
            mid: null,
            high: null
        };
    }
}
