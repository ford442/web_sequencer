import { ScaleDefinition, applyMicrotonalTuning } from '../utils/musicTheory';
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
    private config: SingingVoiceConfig;

    /** Latency of the Rubber Band processor in samples */
    private processorLatency: number = 0;

    /** Cache for pre-rendered TTS at different base pitches (Section 2) */
    private pitchCache: PitchCache = {
        low: null,
        mid: null,
        high: null
    };

    /** Voice pitch parameters for sampler playback */
    private rootNote: number = 60;      // Base MIDI note (C4 default)
    private coarseTune: number = 0;     // Coarse tuning in semitones (-24 to +24)
    private fineTune: number = 0;       // Fine tuning in cents (-50 to +50)
    private pitchAttack: number = 0;    // Pitch envelope attack time (0-1)
    private pitchDecay: number = 0;     // Pitch envelope decay time (0-1)

    /** Envelope Baseline Tracker for Phoneme-Aware Velocity */
    private currentAttack: number = 0.05;
    private currentDecay: number = 0.1;

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
     * Set custom LFO shape for formant shifting.
     * @param shape Array of normalized values (0.0 to 1.0)
     */
    setFormantLfoShape(shape: number[] | undefined): void {
        if (this.formantShifter && this.config.enableFormantShifting) {
            this.formantShifter.setCustomLfoShape(shape);
        }
    }

    /**
     * Initialize the Rubber Band AudioWorklet processor.
     * Must be called before processing audio.
     * AudioWorklet is now the only supported path - ScriptProcessorNode fallback removed.
     * @param _forceScriptProcessor Deprecated parameter - no longer used
     * @param wasmBinary Optional pre-loaded WASM binary to avoid refetching
     */
    async initWorklet(_forceScriptProcessor: boolean = false, wasmBinary?: ArrayBuffer): Promise<void> {
        // Clean up existing node if reinitializing
        if (this.workletNode) {
            this.workletNode.disconnect();
            this.workletNode = null;
        }

        // AudioWorklet is the only supported path
        if (!this.audioContext.audioWorklet) {
            throw new Error('AudioWorklet is not supported in this browser. SingingVoice requires AudioWorklet.');
        }

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
            await new Promise<void>((resolve, reject) => {
                let timeoutId: any = 0;
                const handler = (event: MessageEvent) => {
                    try { clearTimeout(timeoutId); } catch (_) {}
                    if (event.data.type === 'READY') {
                        try {
                            if (typeof (this.workletNode!.port as any).removeEventListener === 'function') {
                                (this.workletNode!.port as any).removeEventListener('message', handler);
                            } else {
                                (this.workletNode!.port as any).onmessage = null;
                            }
                        } catch (_) {}
                        resolve();
                    } else if (event.data.type === 'ERROR') {
                        try {
                            if (typeof (this.workletNode!.port as any).removeEventListener === 'function') {
                                (this.workletNode!.port as any).removeEventListener('message', handler);
                            } else {
                                (this.workletNode!.port as any).onmessage = null;
                            }
                        } catch (_) {}
                        reject(new Error(event.data.error || 'Worklet initialization failed'));
                    }
                };
                // Support MessagePort implementations that expose addEventListener or onmessage
                if (typeof (this.workletNode!.port as any).addEventListener === 'function') {
                    (this.workletNode!.port as any).addEventListener('message', handler);
                } else {
                    (this.workletNode!.port as any).onmessage = handler;
                }

                // Timeout after 10 seconds
                timeoutId = setTimeout(() => {
                    try {
                        if (typeof (this.workletNode!.port as any).removeEventListener === 'function') {
                            (this.workletNode!.port as any).removeEventListener('message', handler);
                        } else {
                            (this.workletNode!.port as any).onmessage = null;
                        }
                    } catch (_) {}
                    reject(new Error('Worklet initialization timeout'));
                }, 10000);
            });

            console.log('SingingVoice: AudioWorklet initialized successfully');
        } catch (e) {
            console.error('SingingVoice: AudioWorklet initialization failed:', e);
            this.workletNode = null;
            throw new Error(`AudioWorklet initialization failed: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    /**
     * Get the output ring buffer instance.
     * Useful for visualizing output or analyzing processed audio on the main thread.
     * @deprecated RingBuffer access removed - use standard AudioWorklet output instead
     */
    get outputRingBuffer(): null {
        return null;
    }

    /**
     * Set the pitch scale ratio.
     * @param ratio Pitch multiplier (e.g., 2.0 = one octave up, 0.5 = one octave down)
     * @param time Optional time to apply the change (default: now)
     */
    setPitch(ratio: number, time?: number): void {
        if (this.workletNode) {
            const t = time || this.audioContext.currentTime;
            const param = this.workletNode.parameters.get('pitchScale')!;
            param.cancelScheduledValues(t);
            param.setValueAtTime(ratio, t);
        }
    }

    /**
     * Linearly ramp the pitch scale ratio to the given target.
     * @param ratio Target pitch multiplier
     * @param time Time to reach the target ratio
     */
    linearRampToPitch(ratio: number, time: number): void {
        if (this.workletNode) {
            this.workletNode.parameters.get('pitchScale')!.linearRampToValueAtTime(ratio, time);
        }
    }

    /**
     * Exponentially ramp the pitch scale ratio to the given target.
     * @param ratio Target pitch multiplier
     * @param time Time to reach the target ratio
     */
    exponentialRampToPitch(ratio: number, time: number): void {
        if (this.workletNode) {
            this.workletNode.parameters.get('pitchScale')!.exponentialRampToValueAtTime(ratio, time);
        }
    }

    /**
     * Linearly ramp the pitch from current value to the target MIDI note.
     */
    linearRampPitchFromMidi(targetMidiNote: number, baseMidiNote?: number, time?: number, coarseTune?: number, fineTune?: number, tuning?: ScaleDefinition | null): void {

        const effectiveBaseNote = baseMidiNote ?? this.rootNote;
        const effectiveCoarse = coarseTune ?? this.coarseTune;
        const effectiveFine = fineTune ?? this.fineTune;

        targetMidiNote = applyMicrotonalTuning(targetMidiNote, tuning);

        const totalSemitoneOffset = effectiveCoarse + (effectiveFine / 100);

        const adjustedTargetMidi = targetMidiNote + totalSemitoneOffset;

        const targetFreq = midiToFreq(adjustedTargetMidi);
        const baseFreq = midiToFreq(effectiveBaseNote);

        let pitchRatio = targetFreq / baseFreq;
        pitchRatio = Math.max(PITCH_RATIO_LIMITS.MIN, Math.min(PITCH_RATIO_LIMITS.MAX, pitchRatio));

        this.linearRampToPitch(pitchRatio, time || this.audioContext.currentTime);
    }

    /**
     * Exponentially ramp the pitch from current value to the target MIDI note.
     */
    exponentialRampPitchFromMidi(targetMidiNote: number, baseMidiNote?: number, time?: number, coarseTune?: number, fineTune?: number, tuning?: ScaleDefinition | null): void {

        const effectiveBaseNote = baseMidiNote ?? this.rootNote;
        const effectiveCoarse = coarseTune ?? this.coarseTune;
        const effectiveFine = fineTune ?? this.fineTune;

        targetMidiNote = applyMicrotonalTuning(targetMidiNote, tuning);

        const totalSemitoneOffset = effectiveCoarse + (effectiveFine / 100);

        const adjustedTargetMidi = targetMidiNote + totalSemitoneOffset;

        const targetFreq = midiToFreq(adjustedTargetMidi);
        const baseFreq = midiToFreq(effectiveBaseNote);

        let pitchRatio = targetFreq / baseFreq;
        pitchRatio = Math.max(PITCH_RATIO_LIMITS.MIN, Math.min(PITCH_RATIO_LIMITS.MAX, pitchRatio));

        this.exponentialRampToPitch(pitchRatio, time || this.audioContext.currentTime);
    }

    /**
     * Set pitch from MIDI note number relative to base note.
     * Uses stored rootNote, coarseTune, and fineTune values.
     *
     * @param targetMidiNote Target MIDI note for pitch shifting (can include fractional cents)
     * @param baseMidiNote Base MIDI note (default: uses stored rootNote) - the root note of the sample
     * @param time Optional time to apply the change (default: now)
     * @param coarseTune Optional coarse tuning override (-24 to +24), uses stored if not provided
     * @param fineTune Optional fine tuning override (-50 to +50), uses stored if not provided
     */
    setPitchFromMidi(targetMidiNote: number, baseMidiNote?: number, time?: number, coarseTune?: number, fineTune?: number, tuning?: ScaleDefinition | null): void {
        // Use stored values as defaults
        const effectiveBaseNote = baseMidiNote ?? this.rootNote;
        const effectiveCoarse = coarseTune ?? this.coarseTune;
        const effectiveFine = fineTune ?? this.fineTune;

        targetMidiNote = applyMicrotonalTuning(targetMidiNote, tuning);

        // Apply coarse and fine tuning offsets
        const totalSemitoneOffset = effectiveCoarse + (effectiveFine / 100);
        const adjustedTargetMidi = targetMidiNote + totalSemitoneOffset;

        const targetFreq = midiToFreq(adjustedTargetMidi);
        const baseFreq = midiToFreq(effectiveBaseNote);

        // Calculate pitch ratio, clamped to optimal range for best quality
        let pitchRatio = targetFreq / baseFreq;
        pitchRatio = Math.max(PITCH_RATIO_LIMITS.MIN, Math.min(PITCH_RATIO_LIMITS.MAX, pitchRatio));

        this.setPitch(pitchRatio, time);
    }

    /**
     * Get the current configuration.
     * Useful for checking quality settings and other parameters.
     */
    getConfig(): SingingVoiceConfig {
        return { ...this.config };
    }

    /**
     * Update configuration at runtime.
     * Note: Some settings may require re-initialization to take effect.
     */
    setConfig(updates: Partial<SingingVoiceConfig>): void {
        this.config = { ...this.config, ...updates };
    }

    /**
     * Get the nearest base pitch level for a target frequency.
     * Used for multi-resolution pitch caching (Section 2).
     * * @param targetMidiNote Target MIDI note number
     * @returns The cache key ('low', 'mid', or 'high') for the nearest base pitch
     */
    getNearestBasePitch(targetMidiNote: number, tuning?: ScaleDefinition | null): keyof PitchCache {
        targetMidiNote = applyMicrotonalTuning(targetMidiNote, tuning);
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
    processWithOptimalPitch(targetMidiNote: number, tuning?: ScaleDefinition | null): boolean {
        targetMidiNote = applyMicrotonalTuning(targetMidiNote, tuning);
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
     * @param reverse Optional reverse playback (default false)
     */
    play(startSample?: number, endSample?: number, pitch: number = 1.0, reverse: boolean = false): void {
        if (!this.workletNode) {
            throw new Error('SingingVoice not initialized. Call initWorklet() first.');
        }

        this.workletNode.port.postMessage({
            type: 'noteOn',
            data: {
                pitch,
                startSample,
                endSample,
                reverse
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
    async process(audio: Float32Array, startSample?: number, endSample?: number, reverse: boolean = false): Promise<void> {
        this.loadBuffer(audio);
        this.play(startSample, endSample, 1.0, reverse);
    }

    /**
     * Trigger a specific phoneme slice based on index.
     *
     * @param audio Audio buffer
     * @param sliceIndex Index of the phoneme to play (e.g. from MIDI note)
     * @param alignment Alignment result containing phoneme timings
     * @param pitch Optional pitch override (default 1.0)
     */
    async triggerSlice(audio: Float32Array, sliceIndex: number, alignment: AlignmentResult, pitch: number = 1.0, reverse: boolean = false): Promise<void> {
        if (sliceIndex < 0 || sliceIndex >= alignment.phonemes.length) {
            console.warn(`Slice index ${sliceIndex} out of bounds (max ${alignment.phonemes.length - 1})`);
            return;
        }

        const phoneme = alignment.phonemes[sliceIndex];
        const startSample = Math.floor(phoneme.start * alignment.sampleRate);
        const endSample = Math.floor(phoneme.end * alignment.sampleRate);

        // Apply Phoneme-Aware Velocity formatting to amplitude envelope
        let scaledAttack = this.currentAttack;
        let scaledDecay = this.currentDecay;
        const now = this.audioContext.currentTime;

        switch (phoneme.category) {
            case 'plosive':
                scaledAttack = Math.max(0.001, this.currentAttack * 0.1); // Extremely fast attack
                scaledDecay = Math.max(0.001, this.currentDecay * 0.5);   // Faster decay
                break;
            case 'fricative':
                scaledAttack = Math.max(0.001, this.currentAttack * 0.5); // Fast attack
                break;
            case 'liquid':
            case 'nasal':
                scaledAttack = Math.min(2.0, this.currentAttack * 1.2);   // Smoother attack
                break;
            case 'vowel':
                scaledAttack = Math.min(2.0, this.currentAttack * 1.5);   // Smooth attack
                scaledDecay = Math.min(2.0, this.currentDecay * 1.2);     // Longer decay
                break;
            default:
                break;
        }

        if (this.workletNode) {
            this.workletNode.parameters.get('attack')?.setValueAtTime(scaledAttack, this.audioContext.currentTime);
            this.workletNode.parameters.get('decay')?.setValueAtTime(scaledDecay, this.audioContext.currentTime);
        }

        this.setPitch(pitch);
        this.setTimeRatio(1.0); // Reset time stretch for slice playback usually

        await this.process(audio, startSample, endSample, reverse);

        // Reset envelopes immediately after trigger to avoid bleeding onto next normal note processing
        if (this.workletNode) {
            this.workletNode.parameters.get('attack')?.setValueAtTime(this.currentAttack, this.audioContext.currentTime + 0.1);
            this.workletNode.parameters.get('decay')?.setValueAtTime(this.currentDecay, this.audioContext.currentTime + 0.1);
        }
    }

    /**
     * Set the time stretch ratio.
     * @param timeRatio Time multiplier (e.g., 2.0 = twice as long, 0.5 = half as long)
     * @param time Optional time to apply the change (default: now)
     */
    setTimeRatio(timeRatio: number, time?: number): void {
        if (this.workletNode) {
            this.workletNode.parameters.get('timeRatio')!.setValueAtTime(timeRatio, time || this.audioContext.currentTime);
        }
    }

    /**
     * Get the underlying AudioWorkletNode.
     * @returns The AudioWorkletNode
     */
    getSourceNode(): AudioWorkletNode {
        if (this.workletNode) {
            return this.workletNode;
        }
        throw new Error('SingingVoice not initialized. Call initWorklet() first.');
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
        if (!this.workletNode) {
            throw new Error('Voice not initialized. Call initWorklet() first.');
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

    /**
     * Set formant LFO rate in Hz.
     * @param rate LFO rate in Hz
     * @param time Optional time to apply the change (default: now)
     */
    setFormantLfoRate(rate: number, time?: number): void {
        if (this.formantShifter && this.config.enableFormantShifting) {
            this.formantShifter.setLfoRate(rate, time);
        }
    }

    /**
     * Set formant LFO depth.
     * @param depth LFO depth (0-1)
     * @param time Optional time to apply the change (default: now)
     */
    setFormantLfoDepth(depth: number, time?: number): void {
        if (this.formantShifter && this.config.enableFormantShifting) {
            this.formantShifter.setLfoDepth(depth, time);
        }
    }

    /**
     * Set formant shift in semitones.
     * @param semitones Formant shift in semitones (e.g., -12 to 12)
     * @param time Optional time to apply the change (default: now)
     * @param rampTime Optional duration to ramp to the new formant value smoothly
     */
    setFormantShift(semitones: number, time?: number, rampTime: number = 0.05): void {
        if (this.formantShifter && this.config.enableFormantShifting) {
            const shift = {
                f1Shift: semitones,
                f2Shift: semitones,
                f3Shift: semitones,
                f4Shift: semitones
            };
            this.formantShifter.updateFilterChain(shift, rampTime);
        }
    }

    /**
     * Trigger a formant envelope.
     */
    setFormantEnvelope(amount: number, attack: number, decay: number, triggerTime: number) {
        if (this.formantShifter && this.config.enableFormantShifting) {
            this.formantShifter.triggerEnvelope(amount, attack, decay, triggerTime);
        }
    }

    /**
     * Set character morphing amount and target.
     * @param amount Morph amount (0 to 1)
     * @param target Target voice character
     * @param rampTime Optional duration to ramp to the new formant value smoothly
     */
    setCharacterMorph(amount: number, target: VoiceCharacter, rampTime: number = 0.05): void {
        if (this.formantShifter && this.config.enableFormantShifting) {
            const shift = this.formantShifter.interpolateCharacters('default', target, amount);
            this.formantShifter.updateFilterChain(shift, rampTime);
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
     * Set gate depth for rhythmic gating effect.
     * @param percent Gate depth (0-100)
     * @param time Optional time to apply the change
     */
    setGateDepth(percent: number, time?: number): void {
        if (this.workletNode) {
            this.workletNode.parameters.get('gateDepth')?.setValueAtTime(percent / 100, time || this.audioContext.currentTime);
        }
    }

    /**
     * Set gate LFO rate in Hz.
     * @param rate Gate rate in Hz
     * @param time Optional time to apply the change
     */
    setGateRate(rate: number, time?: number): void {
        if (this.workletNode) {
            this.workletNode.parameters.get('gateRate')?.setValueAtTime(rate, time || this.audioContext.currentTime);
        }
    }

    /**
     * Set tremolo rate in Hz.
     * @param rate Tremolo rate in Hz
     * @param time Optional time to apply the change (default: now)
     */
    setTremoloRate(rate: number, time?: number): void {
        if (this.workletNode) {
            this.workletNode.parameters.get('tremoloRate')?.setValueAtTime(rate, time || this.audioContext.currentTime);
        }
    }

    /**
     * Set tremolo depth percentage.
     * @param percent Tremolo depth (0-100)
     * @param time Optional time to apply the change (default: now)
     */
    setTremoloDepth(percent: number, time?: number): void {
        if (this.workletNode) {
            this.workletNode.parameters.get('tremoloDepth')?.setValueAtTime(percent / 100, time || this.audioContext.currentTime);
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

    /**
     * Set spectral freeze/smear amount.
     * @param amount Freeze amount (0-1)
     * @param time Optional time to apply the change (default: now)
     */
    setFreeze(amount: number, time?: number): void {
        if (this.workletNode) {
            this.workletNode.parameters.get('freeze')?.setValueAtTime(amount, time || this.audioContext.currentTime);
        }
    }

    /**
     * Set spectral freeze LFO rate.
     * @param rate LFO rate in Hz
     * @param time Optional time to apply the change (default: now)
     */
    setFreezeLfoRate(rate: number, time?: number): void {
        if (this.workletNode) {
            this.workletNode.parameters.get('freezeLfoRate')?.setValueAtTime(rate, time || this.audioContext.currentTime);
        }
    }

    /**
     * Set spectral freeze LFO depth.
     * @param depth LFO depth (0-1)
     * @param time Optional time to apply the change (default: now)
     */
    setFreezeLfoDepth(depth: number, time?: number): void {
        if (this.workletNode) {
            this.workletNode.parameters.get('freezeLfoDepth')?.setValueAtTime(depth, time || this.audioContext.currentTime);
        }
    }

    /**
     * Set envelope follower depth for freeze amount modulation.
     * @param depth Depth (0-1)
     * @param time Optional time to apply the change (default: now)
     */
    setFreezeEnvDepth(depth: number, time?: number): void {
        if (this.workletNode) {
            this.workletNode.parameters.get('freezeEnvDepth')?.setValueAtTime(depth, time || this.audioContext.currentTime);
        }
    }

    /**
     * Set envelope follower depth for grain size modulation.
     * @param depth Depth (0-1)
     * @param time Optional time to apply the change (default: now)
     */
    setGrainEnvDepth(depth: number, time?: number): void {
        if (this.workletNode) {
            this.workletNode.parameters.get('grainEnvDepth')?.setValueAtTime(depth, time || this.audioContext.currentTime);
        }
    }

    /**
     * Set granular pitch quantization interval in semitones.
     * 0 = off, 1 = chromatic, 3 = minor third, 4 = major third,
     * 5 = fourth, 7 = fifth, 12 = octave.
     * @param semitones Interval size in semitones (0-12)
     * @param time Optional time to apply the change (default: now)
     */
    setGrainPitchQuantize(semitones: number, time?: number): void {
        if (this.workletNode) {
            this.workletNode.parameters.get('grainPitchQuantize')?.setValueAtTime(semitones, time || this.audioContext.currentTime);
        }
    }

    /**
     * Set amplitude envelope attack time.
     * @param attack Attack time in seconds
     * @param time Optional time to apply the change (default: now)
     */
    setAttack(attack: number, time?: number): void {
        this.currentAttack = attack;
        if (this.workletNode) {
            this.workletNode.parameters.get('attack')?.setValueAtTime(attack, time || this.audioContext.currentTime);
        }
    }

    /**
     * Set amplitude envelope decay time.
     * @param decay Decay time in seconds
     * @param time Optional time to apply the change (default: now)
     */
    setDecay(decay: number, time?: number): void {
        this.currentDecay = decay;
        if (this.workletNode) {
            this.workletNode.parameters.get('decay')?.setValueAtTime(decay, time || this.audioContext.currentTime);
        }
    }

    /**
     * Set amplitude envelope sustain level.
     * @param sustain Sustain level (0-1)
     * @param time Optional time to apply the change (default: now)
     */
    setSustain(sustain: number, time?: number): void {
        if (this.workletNode) {
            this.workletNode.parameters.get('sustain')?.setValueAtTime(sustain, time || this.audioContext.currentTime);
        }
    }

    /**
     * Set amplitude envelope release time.
     * @param release Release time in seconds
     * @param time Optional time to apply the change (default: now)
     */
    setRelease(release: number, time?: number): void {
        if (this.workletNode) {
            this.workletNode.parameters.get('release')?.setValueAtTime(release, time || this.audioContext.currentTime);
        }
    }

    /**
     * Trigger release phase of the amplitude envelope.
     * @param time Optional time to trigger the release
     */
    noteOff(time?: number): void {
        if (this.workletNode) {
            this.workletNode.port.postMessage({
                type: 'noteOff',
                data: {
                    time: time || this.audioContext.currentTime
                }
            });
        }
    }

    // === SAMPLER VOICE PARAMETER METHODS ===

    /**
     * Set the root note for sample playback.
     * This is the base MIDI note where the sample plays at its original pitch.
     * @param midiNote Root MIDI note (24-108)
     */
    setRootNote(midiNote: number): void {
        this.rootNote = Math.max(24, Math.min(108, midiNote));
    }

    /**
     * Get the current root note.
     * @returns Current root MIDI note
     */
    getRootNote(): number {
        return this.rootNote;
    }

    /**
     * Set coarse tuning in semitones.
     * @param semitones Coarse tuning (-24 to +24 semitones)
     */
    setCoarseTune(semitones: number): void {
        this.coarseTune = Math.max(-24, Math.min(24, semitones));
    }

    /**
     * Get the current coarse tuning.
     * @returns Coarse tuning in semitones
     */
    getCoarseTune(): number {
        return this.coarseTune;
    }

    /**
     * Set fine tuning in cents.
     * @param cents Fine tuning (-50 to +50 cents)
     */
    setFineTune(cents: number): void {
        this.fineTune = Math.max(-50, Math.min(50, cents));
    }

    /**
     * Get the current fine tuning.
     * @returns Fine tuning in cents
     */
    getFineTune(): number {
        return this.fineTune;
    }

    /**
     * Set pitch envelope attack time.
     * @param attack Attack time (0-1, mapped to 0-2 seconds)
     * @param time Optional time to apply the change (default: now)
     */
    setPitchAttack(attack: number, time?: number): void {
        this.pitchAttack = Math.max(0, Math.min(1, attack));
        // Map 0-1 to 0-2 seconds for the worklet
        const attackSeconds = this.pitchAttack * 2;
        if (this.workletNode) {
            this.workletNode.parameters.get('pitchAttack')?.setValueAtTime(attackSeconds, time || this.audioContext.currentTime);
        }
    }

    /**
     * Get the current pitch envelope attack time.
     * @returns Attack time (0-1)
     */
    getPitchAttack(): number {
        return this.pitchAttack;
    }

    /**
     * Set pitch envelope decay time.
     * @param decay Decay time (0-1, mapped to 0-2 seconds)
     * @param time Optional time to apply the change (default: now)
     */
    setPitchDecay(decay: number, time?: number): void {
        this.pitchDecay = Math.max(0, Math.min(1, decay));
        // Map 0-1 to 0-2 seconds for the worklet
        const decaySeconds = this.pitchDecay * 2;
        if (this.workletNode) {
            this.workletNode.parameters.get('pitchDecay')?.setValueAtTime(decaySeconds, time || this.audioContext.currentTime);
        }
    }

    /**
     * Get the current pitch envelope decay time.
     * @returns Decay time (0-1)
     */
    getPitchDecay(): number {
        return this.pitchDecay;
    }

    /**
     * Calculate total pitch offset including root note, coarse and fine tuning.
     * This combines all pitch parameters into a single semitone offset.
     * @param targetMidiNote The target MIDI note being played
     * @returns Total semitone offset from the base pitch
     */
    calculatePitchOffset(targetMidiNote: number, tuning?: ScaleDefinition | null): number {
        targetMidiNote = applyMicrotonalTuning(targetMidiNote, tuning);
        // Calculate: (target - root) + coarse + fine/100
        const baseOffset = targetMidiNote - this.rootNote;
        const tuningOffset = this.coarseTune + (this.fineTune / 100);
        return baseOffset + tuningOffset;
    }
}
