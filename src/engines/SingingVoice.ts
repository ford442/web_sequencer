import { RingBuffer } from '../utils/ringBuffer';
import processorUrl from '../audio-worklets/rubberband-processor.ts?worker&url';
import { PhonemeAligner, type AlignmentResult } from './rubberband/PhonemeAligner';
import { FormantShifter, type VoiceCharacter } from './rubberband/FormantShifter';

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
 * - Phoneme-aware time stretching (Section 3): Selective vowel/consonant stretching
 * - Formant shifting (Section 4): Independent vocal character control
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

/** * Pitch ratio limits for optimal Rubber Band quality.
 * Shifts outside this range introduce more artifacts.
 */
export const PITCH_RATIO_LIMITS = {
    /** Minimum pitch ratio (one octave down) */
    MIN: 0.5,
    /** Maximum pitch ratio (one octave up) */
    MAX: 2.0
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
    /** Enable phoneme-aware time stretching (Section 3, default: false) */
    enablePhonemeStretching?: boolean;
    /** Enable formant shifting for vocal character (Section 4, default: false) */
    enableFormantShifting?: boolean;
    /** Target voice character for formant shifting (default: 'default') */
    voiceCharacter?: VoiceCharacter;
    /** Phoneme aligner service URL (optional, uses local if not provided) */
    phonemeAlignerUrl?: string;
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
    private inputRingBuffer: RingBuffer | undefined;
    private _outputRingBuffer: RingBuffer | undefined;
    private config: SingingVoiceConfig;
    
    /** Latency of the Rubber Band processor in samples */
    private processorLatency: number = 0;
    
    /** Cache for pre-rendered TTS at different base pitches (Section 2) */
    private pitchCache: PitchCache = {
        low: null,
        mid: null,
        high: null
    };
    
    /** Phoneme aligner for Section 3 implementation */
    private phonemeAligner: PhonemeAligner | null = null;
    
    /** Formant shifter for Section 4 implementation */
    private formantShifter: FormantShifter | null = null;
    
    /** Last alignment result for current audio */
    private lastAlignment: AlignmentResult | null = null;

    constructor(audioContext: AudioContext, config: SingingVoiceConfig = {}) {
        this.audioContext = audioContext;
        this.config = {
            useHighQuality: config.useHighQuality ?? false,
            preserveFormants: config.preserveFormants ?? true,
            channels: config.channels ?? 1,
            bufferSize: config.bufferSize ?? 16384,
            enablePhonemeStretching: config.enablePhonemeStretching ?? false,
            enableFormantShifting: config.enableFormantShifting ?? false,
            voiceCharacter: config.voiceCharacter ?? 'default',
            phonemeAlignerUrl: config.phonemeAlignerUrl
        };
        
        // Initialize phoneme aligner if enabled
        if (this.config.enablePhonemeStretching) {
            this.phonemeAligner = new PhonemeAligner({
                alignerServiceUrl: this.config.phonemeAlignerUrl,
                useLocalAlignment: !this.config.phonemeAlignerUrl
            });
        }
        
        // Initialize formant shifter if enabled
        if (this.config.enableFormantShifting) {
            this.formantShifter = new FormantShifter({
                audioContext: this.audioContext
            });
        }
    }

    /**
     * Initialize the Rubber Band AudioWorklet processor.
     * Must be called before processing audio.
     */
    async initWorklet(): Promise<void> {
        if (this.workletNode) return;

        await this.audioContext.audioWorklet.addModule(processorUrl);

        // Fetch the WASM binary on the main thread to bypass worklet restrictions
        const response = await fetch('/rubberband.wasm');
        if (!response.ok) {
            throw new Error(`Failed to fetch rubberband.wasm: ${response.statusText}`);
        }
        const wasmBinary = await response.arrayBuffer();

        // Create shared buffers for ring buffers
        const inputBuffer = new SharedArrayBuffer(this.config.bufferSize! * 4);
        const outputBuffer = new SharedArrayBuffer(this.config.bufferSize! * 4);

        this.inputRingBuffer = new RingBuffer(inputBuffer);
        this._outputRingBuffer = new RingBuffer(outputBuffer);

        this.workletNode = new AudioWorkletNode(this.audioContext, 'RubberBandProcessor');
        
        // Initialize the worklet with the fetched binary and buffers (flat structure)
        this.workletNode.port.postMessage({
            type: 'INIT_WASM',
            inputBuffer,
            outputBuffer,
            wasmBinary,
            moduleUrl: '/rubberband.js'
        });

        // Wait for ready signal
        await new Promise<void>((resolve) => {
            const handler = (event: MessageEvent) => {
                if (event.data.type === 'READY') {
                    this.workletNode!.port.removeEventListener('message', handler);
                    resolve();
                }
            };
            this.workletNode!.port.addEventListener('message', handler);
        });
    }

    /**
     * Get the output ring buffer instance.
     * Useful for visualizing output or analyzing processed audio on the main thread.
     */
    get outputRingBuffer(): RingBuffer | undefined {
        return this._outputRingBuffer;
    }

    /**
     * Set the pitch scale ratio.
     * @param ratio Pitch multiplier (e.g., 2.0 = one octave up, 0.5 = one octave down)
     */
    setPitch(ratio: number): void {
        if (this.workletNode) {
            this.workletNode.parameters.get('pitchScale')!.setValueAtTime(ratio, this.audioContext.currentTime);
        }
    }

    /**
     * Set pitch from MIDI note number relative to base note.
     * @param targetMidiNote Target MIDI note for pitch shifting
     * @param baseMidiNote Base MIDI note (default: C4 = 60)
     */
    setPitchFromMidi(targetMidiNote: number, baseMidiNote: number = 60): void {
        const targetFreq = midiToFreq(targetMidiNote);
        const baseFreq = midiToFreq(baseMidiNote);
        
        // Calculate pitch ratio, clamped to optimal range for best quality
        let pitchRatio = targetFreq / baseFreq;
        pitchRatio = Math.max(PITCH_RATIO_LIMITS.MIN, Math.min(PITCH_RATIO_LIMITS.MAX, pitchRatio));
        
        this.setPitch(pitchRatio);
    }
    
    /**
     * Get the nearest base pitch level for a target frequency.
     * Used for multi-resolution pitch caching (Section 2).
     * * @param targetMidiNote Target MIDI note number
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
     * * @param level The pitch cache level ('low', 'mid', 'high')
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
     * * @param targetMidiNote Target MIDI note for pitch shifting
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
        const pitchRatio = Math.max(
            PITCH_RATIO_LIMITS.MIN, 
            Math.min(PITCH_RATIO_LIMITS.MAX, targetFreq / baseFreq)
        );
        
        this.setPitch(pitchRatio);
        this.process(cachedAudio);
        
        return true;
    }

    /**
     * Process audio through the Rubber Band worklet.
     * @param audio Float32Array of mono audio samples
     * @returns Promise that resolves when processing is complete
     */
    async process(audio: Float32Array): Promise<void> {
        if (!this.workletNode || !this.inputRingBuffer) {
            throw new Error('SingingVoice not initialized. Call initWorklet() first.');
        }

        // Send audio to worklet
        this.workletNode.port.postMessage({
            type: 'loadBuffer',
            data: { buffer: audio.buffer.slice(0) } // Copy buffer
        });

        // Trigger processing
        this.workletNode.port.postMessage({
            type: 'noteOn',
            data: { pitch: 1.0 } // Pitch will be set via parameter
        });
    }

    /**
     * Set the time stretch ratio.
     * @param timeRatio Time multiplier (e.g., 2.0 = twice as long, 0.5 = half as long)
     */
    setTimeRatio(timeRatio: number): void {
        if (this.workletNode) {
            this.workletNode.parameters.get('timeRatio')!.setValueAtTime(timeRatio, this.audioContext.currentTime);
        }
    }

    /**
     * Get the underlying AudioWorkletNode.
     * @returns The AudioWorkletNode
     */
    getSourceNode(): AudioWorkletNode {
        if (!this.workletNode) {
            throw new Error('SingingVoice not initialized. Call initWorklet() first.');
        }
        return this.workletNode;
    }

    /**
     * Connect the worklet to an audio destination.
     * @param destination AudioNode to connect to
     */
    connect(destination: AudioNode): void {
        if (this.workletNode) {
            this.workletNode.connect(destination);
        }
    }

    /**
     * Disconnect the worklet.
     * @param destination Optional specific destination to disconnect from
     */
    disconnect(destination?: AudioNode): void {
        if (this.workletNode) {
            if (destination) {
                this.workletNode.disconnect(destination);
            } else {
                this.workletNode.disconnect();
            }
        }
    }

    /**
     * Get the current processor latency in samples.
     * @returns Latency in samples
     */
    getLatency(): number {
        return this.processorLatency;
    }
    
    /**
     * Get latency in seconds.
     * Useful for MIDI synchronization (Section 9).
     */
    getLatencySeconds(): number {
        return this.processorLatency / this.audioContext.sampleRate;
    }
    
    /**
     * Align phonemes in the given audio (Section 3).
     * Stores the result internally for later use with phoneme-aware stretching.
     * 
     * @param audio Audio samples to align
     * @param text Text/lyrics to align
     * @returns Alignment result with phoneme segments
     */
    async alignPhonemes(audio: Float32Array, text: string): Promise<AlignmentResult | null> {
        if (!this.phonemeAligner) {
            console.warn('PhonemeAligner not enabled. Set enablePhonemeStretching: true in config.');
            return null;
        }
        
        this.lastAlignment = await this.phonemeAligner.alignPhonemes(
            audio,
            text,
            this.audioContext.sampleRate
        );
        
        return this.lastAlignment;
    }
    
    /**
     * Get the last phoneme alignment result.
     */
    getLastAlignment(): AlignmentResult | null {
        return this.lastAlignment;
    }
    
    /**
     * Send phoneme boundaries to AudioWorklet for real-time processing (Section 3).
     * Call this after alignPhonemes() to enable phoneme-aware stretching.
     * 
     * @param targetDuration Optional target duration for stretch calculation
     */
    sendPhonemeDataToWorklet(targetDuration?: number): void {
        if (!this.lastAlignment || !this.phonemeAligner || !this.workletNode) {
            return;
        }
        
        const phonemes = this.lastAlignment.phonemes;
        
        // Calculate stretch ratios if target duration specified
        let ratios: number[] | undefined;
        if (targetDuration !== undefined) {
            ratios = this.phonemeAligner.calculateStretchRatios(phonemes, targetDuration);
        }
        
        // Create shared buffer with phoneme data
        const sharedBuffer = this.phonemeAligner.createSharedPhonemeBuffer(
            phonemes,
            this.audioContext.sampleRate
        );
        
        // Send to worklet
        this.workletNode.port.postMessage({
            type: 'setPhonemeData',
            data: {
                sharedBuffer,
                ratios
            }
        });
    }
    
    /**
     * Set voice character for formant shifting (Section 4).
     * 
     * @param character Target voice character
     * @param sourceCharacter Source voice character (default: 'default')
     */
    setVoiceCharacter(character: VoiceCharacter, sourceCharacter: VoiceCharacter = 'default'): void {
        if (!this.formantShifter) {
            console.warn('FormantShifter not enabled. Set enableFormantShifting: true in config.');
            return;
        }
        
        this.formantShifter.createCharacterFilterChain(character, sourceCharacter);
        this.config.voiceCharacter = character;
    }
    
    /**
     * Get the formant shifter for advanced control.
     * Returns null if formant shifting is not enabled.
     */
    getFormantShifter(): FormantShifter | null {
        return this.formantShifter;
    }
    
    /**
     * Get the phoneme aligner for advanced control.
     * Returns null if phoneme stretching is not enabled.
     */
    getPhonemeAligner(): PhonemeAligner | null {
        return this.phonemeAligner;
    }
    
    /**
     * Connect the output of this voice to an audio destination.
     * If formant shifting is enabled, routes through the formant shifter first.
     * 
     * @param destination Destination audio node
     */
    connectOutput(destination: AudioNode): void {
        if (!this.workletNode) {
            throw new Error('Worklet not initialized. Call initWorklet() first.');
        }
        
        if (this.formantShifter && this.config.enableFormantShifting) {
            // Route through formant shifter
            this.formantShifter.connect(this.workletNode, destination);
        } else {
            // Direct connection
            this.workletNode.connect(destination);
        }
    }
    
    /**
     * Disconnect the output.
     */
    disconnectOutput(): void {
        if (this.workletNode) {
            this.workletNode.disconnect();
        }
        if (this.formantShifter) {
            this.formantShifter.disconnect();
        }
    }
}
