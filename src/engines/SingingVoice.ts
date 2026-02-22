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
    private scriptProcessorNode: ScriptProcessorNode | null = null;
    private useWorklet: boolean = true;
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
     * @param forceScriptProcessor If true, will use ScriptProcessorNode fallback
     * @param wasmBinary Optional pre-loaded WASM binary to avoid refetching
     */
    async initWorklet(forceScriptProcessor: boolean = false, wasmBinary?: ArrayBuffer): Promise<void> {
        // Clean up existing nodes if reinitializing
        if (this.workletNode || this.scriptProcessorNode) {
            if (this.workletNode) {
                this.workletNode.disconnect();
                this.workletNode = null;
            }
            if (this.scriptProcessorNode) {
                // Clean up event handler to prevent memory leaks
                this.scriptProcessorNode.onaudioprocess = null;
                this.scriptProcessorNode.disconnect();
                this.scriptProcessorNode = null;
            }
        }

        // Try AudioWorklet first (if not forcing fallback)
        if (!forceScriptProcessor && this.audioContext.audioWorklet) {
            try {
                await this.audioContext.audioWorklet.addModule(processorUrl);

                // Fetch the WASM binary on the main thread to bypass worklet restrictions
                // OR use the pre-loaded one if provided (for multi-voice optimization)
                let binary = wasmBinary;
                if (!binary) {
                    const response = await fetch(import.meta.env.BASE_URL + 'rubberband.wasm');
                    if (!response.ok) {
                        throw new Error(`Failed to fetch rubberband.wasm: ${response.statusText}`);
                    }
                    binary = await response.arrayBuffer();
                }

                // Create shared buffers for ring buffers
                const inputBuffer = new SharedArrayBuffer(this.config.bufferSize! * 4);
                const outputBuffer = new SharedArrayBuffer(this.config.bufferSize! * 4);

                this._outputRingBuffer = new RingBuffer(outputBuffer);

                this.workletNode = new AudioWorkletNode(this.audioContext, 'RubberBandProcessor');
                
                // Initialize the worklet with the fetched binary and buffers (flat structure)
                this.workletNode.port.postMessage({
                    type: 'INIT_WASM',
                    inputBuffer,
                    outputBuffer,
                    wasmBinary: binary,
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
                
                this.useWorklet = true;
                console.log('SingingVoice: AudioWorklet initialized successfully');
                return;
            } catch (e) {
                console.warn('SingingVoice: AudioWorklet initialization failed, falling back to ScriptProcessorNode', e);
            }
        }

        // Fallback to ScriptProcessorNode
        console.log('SingingVoice: Initializing ScriptProcessorNode fallback');
        this.scriptProcessorNode = this.audioContext.createScriptProcessor(4096, 1, 1);
        // Note: ScriptProcessorNode has limited functionality - pitch/time shifting won't work
        // This is a basic pass-through for audio continuity
        this.scriptProcessorNode.onaudioprocess = (e) => {
            // Simple pass-through processing
            const input = e.inputBuffer.getChannelData(0);
            const output = e.outputBuffer.getChannelData(0);
            output.set(input);
        };
        this.useWorklet = false;
        console.log('SingingVoice: ScriptProcessorNode fallback initialized (limited functionality)');
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
     * @param time Optional time to apply the change (default: now)
     */
    setPitch(ratio: number, time?: number): void {
        if (this.useWorklet && this.workletNode) {
            this.workletNode.parameters.get('pitchScale')!.setValueAtTime(ratio, time || this.audioContext.currentTime);
        }
        // ScriptProcessorNode fallback doesn't support pitch shifting
    }

    /**
     * Set pitch from MIDI note number relative to base note.
     * @param targetMidiNote Target MIDI note for pitch shifting
     * @param baseMidiNote Base MIDI note (default: C4 = 60)
     * @param time Optional time to apply the change (default: now)
     */
    setPitchFromMidi(targetMidiNote: number, baseMidiNote: number = 60, time?: number): void {
        const targetFreq = midiToFreq(targetMidiNote);
        const baseFreq = midiToFreq(baseMidiNote);
        
        // Calculate pitch ratio, clamped to optimal range for best quality
        let pitchRatio = targetFreq / baseFreq;
        pitchRatio = Math.max(PITCH_RATIO_LIMITS.MIN, Math.min(PITCH_RATIO_LIMITS.MAX, pitchRatio));
        
        this.setPitch(pitchRatio, time);
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
     * Load audio buffer into the worklet without triggering playback.
     * Useful for pre-loading or glitch effects where multiple triggers share the same buffer.
     * @param audio Float32Array of mono audio samples
     */
    loadBuffer(audio: Float32Array): void {
        if (!this.workletNode) {
            throw new Error('SingingVoice not initialized. Call initWorklet() first.');
        }

        this.workletNode.port.postMessage({
            type: 'loadBuffer',
            data: { buffer: audio.buffer.slice(0) } // Copy buffer
        });
    }

    /**
     * Trigger playback of the currently loaded buffer.
     * @param startSample Optional start sample index
     * @param endSample Optional end sample index
     * @param pitch Optional pitch override (default 1.0)
     */
    play(startSample?: number, endSample?: number, pitch: number = 1.0): void {
        if (!this.workletNode) {
            throw new Error('SingingVoice not initialized. Call initWorklet() first.');
        }

        this.workletNode.port.postMessage({
            type: 'noteOn',
            data: {
                pitch,
                startSample,
                endSample
            }
        });
    }

    /**
     * Process audio through the Rubber Band worklet.
     * @param audio Float32Array of mono audio samples
     * @param startSample Optional start sample index for slicing
     * @param endSample Optional end sample index for slicing
     * @returns Promise that resolves when processing is complete
     */
    async process(audio: Float32Array, startSample?: number, endSample?: number): Promise<void> {
        this.loadBuffer(audio);
        this.play(startSample, endSample);
    }

    /**
     * Trigger a specific phoneme slice based on index.
     *
     * @param audio Audio buffer
     * @param sliceIndex Index of the phoneme to play (e.g. from MIDI note)
     * @param alignment Alignment result containing phoneme timings
     * @param pitch Optional pitch override (default 1.0)
     */
    async triggerSlice(audio: Float32Array, sliceIndex: number, alignment: AlignmentResult, pitch: number = 1.0): Promise<void> {
        if (sliceIndex < 0 || sliceIndex >= alignment.phonemes.length) {
            console.warn(`Slice index ${sliceIndex} out of bounds (max ${alignment.phonemes.length - 1})`);
            return;
        }

        const phoneme = alignment.phonemes[sliceIndex];
        const startSample = Math.floor(phoneme.start * alignment.sampleRate);
        const endSample = Math.floor(phoneme.end * alignment.sampleRate);

        this.setPitch(pitch);
        this.setTimeRatio(1.0); // Reset time stretch for slice playback usually

        await this.process(audio, startSample, endSample);
    }

    /**
     * Set the time stretch ratio.
     * @param timeRatio Time multiplier (e.g., 2.0 = twice as long, 0.5 = half as long)
     * @param time Optional time to apply the change (default: now)
     */
    setTimeRatio(timeRatio: number, time?: number): void {
        if (this.useWorklet && this.workletNode) {
            this.workletNode.parameters.get('timeRatio')!.setValueAtTime(timeRatio, time || this.audioContext.currentTime);
        }
        // ScriptProcessorNode fallback doesn't support time stretching
    }

    /**
     * Get the underlying AudioWorkletNode or ScriptProcessorNode.
     * @returns The audio node
     */
    getSourceNode(): AudioWorkletNode | ScriptProcessorNode {
        if (this.useWorklet && this.workletNode) {
            return this.workletNode;
        }
        if (this.scriptProcessorNode) {
            return this.scriptProcessorNode;
        }
        throw new Error('SingingVoice not initialized. Call initWorklet() first.');
    }

    /**
     * Connect the worklet to an audio destination.
     * @param destination AudioNode to connect to
     */
    connect(destination: AudioNode): void {
        const node = this.useWorklet ? this.workletNode : this.scriptProcessorNode;
        if (node) {
            node.connect(destination);
        }
    }

    /**
     * Disconnect the worklet.
     * @param destination Optional specific destination to disconnect from
     */
    disconnect(destination?: AudioNode): void {
        const node = this.useWorklet ? this.workletNode : this.scriptProcessorNode;
        if (node) {
            if (destination) {
                node.disconnect(destination);
            } else {
                node.disconnect();
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
     * Set the current alignment result manually.
     * Useful for multi-bank setups where alignment is pre-calculated/cached.
     *
     * @param alignment The alignment result to use
     */
    setAlignment(alignment: AlignmentResult | null): void {
        this.lastAlignment = alignment;
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
        const node = this.useWorklet ? this.workletNode : this.scriptProcessorNode;
        if (!node) {
            throw new Error('Voice not initialized. Call initWorklet() first.');
        }
        
        if (this.formantShifter && this.config.enableFormantShifting) {
            // Route through formant shifter
            this.formantShifter.connect(node, destination);
        } else {
            // Direct connection
            node.connect(destination);
        }
    }
    
    /**
     * Disconnect the output.
     */
    disconnectOutput(): void {
        const node = this.useWorklet ? this.workletNode : this.scriptProcessorNode;
        if (node) {
            node.disconnect();
        }
        if (this.formantShifter) {
            this.formantShifter.disconnect();
        }
    }

    /**
     * Set formant shift in semitones.
     * @param semitones Formant shift in semitones (e.g., -12 to 12)
     * @param time Optional time to apply the change (default: now)
     */
    setFormantShift(semitones: number, time?: number): void {
        if (this.workletNode) {
            this.workletNode.parameters.get('formantScale')?.setValueAtTime(semitones / 12, time || this.audioContext.currentTime);
        }
    }

    /**
     * Set vibrato depth percentage.
     * @param percent Vibrato depth (0-100)
     * @param time Optional time to apply the change (default: now)
     */
    setVibratoDepth(percent: number, time?: number): void {
        if (this.workletNode) {
            this.workletNode.parameters.get('vibratoDepth')?.setValueAtTime(percent / 100, time || this.audioContext.currentTime);
        }
    }

    /**
     * Set breath intensity.
     * @param intensity Breath intensity (0-1)
     * @param time Optional time to apply the change (default: now)
     */
    setBreathIntensity(intensity: number, time?: number): void {
        if (this.workletNode) {
            this.workletNode.parameters.get('breathIntensity')?.setValueAtTime(intensity, time || this.audioContext.currentTime);
        }
    }
}
