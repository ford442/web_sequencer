/**
 * FormantShifter - Independent formant control for vocal character modification
 * 
 * Part of RUBBERBAND_ENHANCEMENT_PLAN Section 4: Formant Shifting for Vocal Character
 * 
 * Enables separation of pitch and formant control for:
 * - Gender modification (male to female voice and vice versa)
 * - Age adjustment (child-like or mature voice)
 * - Timbre control for stylized effects
 * 
 * STUB FILE - Implementation pending.
 * 
 * Approach:
 * 1. Use Rubber Band with OptionFormantShifted (formants shift with pitch)
 * 2. Apply corrective formant filtering to shift formants independently
 * 3. Use biquad filters to boost/cut formant frequency regions
 * 
 * Alternative: Compile a lightweight formant shifter (e.g., soundtouch-js) to WASM
 * 
 * @see RUBBERBAND_ENHANCEMENT_PLAN.md Section 4
 */

/** Standard formant frequency bands for vowels */
export interface FormantFrequencies {
    /** First formant (F1) - typically 200-900 Hz */
    f1: number;
    /** Second formant (F2) - typically 600-2800 Hz */
    f2: number;
    /** Third formant (F3) - typically 1800-3500 Hz */
    f3: number;
    /** Fourth formant (F4) - typically 3000-4500 Hz (optional) */
    f4?: number;
}

/** Formant specification for a vowel type */
export interface VowelFormants {
    /** Vowel symbol (e.g., 'AH', 'EE', 'OO') */
    vowel: string;
    /** Formant frequencies */
    frequencies: FormantFrequencies;
    /** Bandwidths for each formant */
    bandwidths: FormantFrequencies;
}

/** Voice character presets */
export type VoiceCharacter = 'default' | 'male' | 'female' | 'child' | 'deep' | 'bright';

/** Configuration for formant shifting */
export interface FormantShifterConfig {
    /** Base formant frequencies for the source voice */
    sourceFormants?: FormantFrequencies;
    /** Audio context for creating filter nodes */
    audioContext: AudioContext;
}

/** Formant shift specification */
export interface FormantShift {
    /** Shift amount for F1 in semitones */
    f1Shift: number;
    /** Shift amount for F2 in semitones */
    f2Shift: number;
    /** Shift amount for F3 in semitones */
    f3Shift: number;
    /** Shift amount for F4 in semitones (optional) */
    f4Shift?: number;
}

/**
 * Average formant frequencies for different voice types (approximate)
 */
export const VOICE_FORMANTS: Record<VoiceCharacter, FormantFrequencies> = {
    default: { f1: 500, f2: 1500, f3: 2500 },
    male:    { f1: 400, f2: 1200, f3: 2400 },
    female:  { f1: 600, f2: 1800, f3: 2800 },
    child:   { f1: 700, f2: 2100, f3: 3100 },
    deep:    { f1: 350, f2: 1000, f3: 2200 },
    bright:  { f1: 550, f2: 1900, f3: 2900 }
};

/**
 * FormantShifter class for independent formant control.
 * 
 * Full implementation with:
 * 1. Biquad filter chain for formant modification
 * 2. Voice character presets (male, female, child, etc.)
 * 3. Integration with Rubber Band's OptionFormantShifted mode
 * 4. Real-time formant adjustment via Web Audio API
 */
export class FormantShifter {
    private audioContext: AudioContext;
    private filterNodes: BiquadFilterNode[] = [];
    private sourceFormants: FormantFrequencies;
    private currentShift: FormantShift | null = null;
    
    // LFO components
    private lfo: OscillatorNode | null = null;
    private lfoGain: GainNode | null = null;
    private lfoRate: number = 0;
    private lfoDepth: number = 0;
    private lfoShape: number[] | null = null;
    private customWave: PeriodicWave | null = null;

    // Envelope components
    private envNode: ConstantSourceNode | null = null;
    private envGain: GainNode | null = null;

    // Envelope Follower components
    private followerWaveshaper: WaveShaperNode | null = null;
    private followerFilter: BiquadFilterNode | null = null;
    private followerGain: GainNode | null = null;
    private followerDepth: number = 0;

    // Sidechain Ducking components
    private sidechainNode: ConstantSourceNode | null = null;
    private sidechainGain: GainNode | null = null;

    constructor(config: FormantShifterConfig) {
        this.audioContext = config.audioContext;
        this.sourceFormants = config.sourceFormants ?? VOICE_FORMANTS.default;
    }
    
    /**
     * Create a filter chain for formant shifting.
     * 
     * @param shift Formant shift specification
     * @returns Array of connected BiquadFilterNodes
     */
    createFilterChain(shift: FormantShift): BiquadFilterNode[] {
        // Clean up existing filters
        this.disconnect();
        
        const filters: BiquadFilterNode[] = [];
        
        // Create filters for each formant
        const formants = [
            { freq: this.sourceFormants.f1, shift: shift.f1Shift },
            { freq: this.sourceFormants.f2, shift: shift.f2Shift },
            { freq: this.sourceFormants.f3, shift: shift.f3Shift }
        ];
        
        if (this.sourceFormants.f4 && shift.f4Shift !== undefined) {
            formants.push({ freq: this.sourceFormants.f4, shift: shift.f4Shift });
        }
        
        for (const { freq, shift: semitonesShift } of formants) {
            // Convert semitone shift to frequency multiplier
            const freqMultiplier = Math.pow(2, semitonesShift / 12);
            const targetFreq = freq * freqMultiplier;
            
            // Create peaking filter for this formant
            const filter = this.audioContext.createBiquadFilter();
            filter.type = 'peaking';
            filter.frequency.value = targetFreq;
            
            // Q value determines bandwidth - higher Q = narrower peak
            // Typical formant Q: 4-10 for natural voice
            filter.Q.value = 6;
            
            // Gain adjustment based on shift amount
            // More shift = more gain to emphasize the new formant position
            filter.gain.value = Math.abs(semitonesShift) * 2; // dB gain
            
            filters.push(filter);
        }
        
        // Add compensatory filters at original frequencies to reduce them
        for (const { freq } of formants) {
            const compensateFilter = this.audioContext.createBiquadFilter();
            compensateFilter.type = 'peaking';
            compensateFilter.frequency.value = freq;
            compensateFilter.Q.value = 6;
            compensateFilter.gain.value = -3; // Reduce original formant
            filters.push(compensateFilter);
        }
        
        // Connect filters in series
        for (let i = 0; i < filters.length - 1; i++) {
            filters[i].connect(filters[i + 1]);
        }
        
        // Create LFO if createOscillator is available (tests might use mock AudioContext)
        if (typeof this.audioContext.createOscillator === 'function') {
            this.lfo = this.audioContext.createOscillator();
            if (this.lfoShape && this.lfoShape.length > 0) {
                const periodicWave = this.createPeriodicWaveFromShape(this.lfoShape);
                if (periodicWave) {
                    this.lfo.setPeriodicWave(periodicWave);
                } else {
                    this.lfo.type = 'sine';
                }
            } else {
                this.lfo.type = 'sine';
            }
            this.lfo.frequency.value = this.lfoRate;

            this.lfoGain = this.audioContext.createGain();
            this.lfoGain.gain.value = this.lfoDepth * 1200; // Map depth (0-1) to cents (up to 1 octave)

            this.lfo.connect(this.lfoGain);

            // Connect LFO to the detune param of the peaking filters
            // Only connect to the boosting filters (the first half of the array), not the compensatory ones
            for (let i = 0; i < formants.length; i++) {
                this.lfoGain.connect(filters[i].detune);
            }

            this.lfo.start();
        }

        // Create Envelope components
        if (typeof this.audioContext.createConstantSource === 'function') {
            this.envNode = this.audioContext.createConstantSource();
            this.envGain = this.audioContext.createGain();
            this.envGain.gain.value = 0; // Idle state

            this.envNode.connect(this.envGain);

            for (let i = 0; i < formants.length; i++) {
                this.envGain.connect(filters[i].detune);
            }

            this.envNode.start();
        }

        // Create Sidechain components
        if (typeof this.audioContext.createConstantSource === 'function') {
            this.sidechainNode = this.audioContext.createConstantSource();
            this.sidechainGain = this.audioContext.createGain();
            this.sidechainGain.gain.value = 0; // Idle state

            this.sidechainNode.connect(this.sidechainGain);

            for (let i = 0; i < formants.length; i++) {
                this.sidechainGain.connect(filters[i].detune);
            }

            this.sidechainNode.start();
        }

        // Create Envelope Follower components
        if (typeof this.audioContext.createWaveShaper === 'function') {
            this.followerWaveshaper = this.audioContext.createWaveShaper();
        }
        // Create a simple absolute value curve
        const curve = new Float32Array(4096);
        for (let i = 0; i < 4096; i++) {
            const x = (i * 2) / 4096 - 1;
            curve[i] = Math.abs(x);
        }
        if (this.followerWaveshaper) this.followerWaveshaper.curve = curve;

        if (typeof this.audioContext.createBiquadFilter === 'function') {
            this.followerFilter = this.audioContext.createBiquadFilter();
        }
        if (this.followerFilter) this.followerFilter.type = 'lowpass';
        if (this.followerFilter) this.followerFilter.frequency.value = 10; // 10 Hz smoothing

        if (typeof this.audioContext.createGain === 'function') {
            this.followerGain = this.audioContext.createGain();
        }
        if (this.followerGain) this.followerGain.gain.value = this.followerDepth * 100; // Map semitones to cents

        if (this.followerWaveshaper && this.followerFilter) this.followerWaveshaper.connect(this.followerFilter);
        if (this.followerFilter && this.followerGain) this.followerFilter.connect(this.followerGain);

        for (let i = 0; i < formants.length; i++) {
            if (this.followerGain) this.followerGain.connect(filters[i].detune);
        }

        this.filterNodes = filters;
        this.currentShift = shift;
        return filters;
    }
    
    /**
     * Create a filter chain for a specific voice character preset.
     * 
     * @param targetCharacter Target voice character (male, female, child, etc.)
     * @param sourceCharacter Source voice character (default: 'default')
     * @returns Array of connected BiquadFilterNodes
     */
    createCharacterFilterChain(
        targetCharacter: VoiceCharacter,
        sourceCharacter: VoiceCharacter = 'default'
    ): BiquadFilterNode[] {
        const shift = this.calculateCharacterShift(sourceCharacter, targetCharacter);
        return this.createFilterChain(shift);
    }
    
    /**
     * Set a custom LFO shape from an array of normalized values.
     * @param shape Array of normalized values (0.0 to 1.0)
     */
    setCustomLfoShape(shape: number[] | undefined): void {
        if (!shape || shape.length === 0) {
            this.customWave = null;
            if (this.lfo) {
                this.lfo.type = 'sine';
            }
            return;
        }

        // To convert the drawn shape (time domain) into a PeriodicWave (frequency domain),
        // we'd need to perform a Discrete Fourier Transform (DFT).
        // For a simpler approach that gives an approximation without heavy math,
        // we can just use the first few harmonics or a simple mapping,
        // but for a true custom wave we must calculate real/imaginary coefficients.

        const N = shape.length;
        // We'll calculate the first 32 harmonics for performance
        const maxHarmonics = Math.min(32, Math.floor(N / 2));

        const real = new Float32Array(maxHarmonics + 1);
        const imag = new Float32Array(maxHarmonics + 1);

        // Convert normalized [0, 1] to bipolar [-1, 1]
        const bipolarShape = shape.map(v => v * 2 - 1);

        for (let k = 1; k <= maxHarmonics; k++) {
            let sumReal = 0;
            let sumImag = 0;
            for (let n = 0; n < N; n++) {
                const angle = (2 * Math.PI * k * n) / N;
                sumReal += bipolarShape[n] * Math.cos(angle);
                sumImag += bipolarShape[n] * Math.sin(angle); // Negated for standard DFT if needed, but this works for synthesis
            }
            // Normalize by N and multiply by 2 (standard synthesis coefficient scaling)
            real[k] = (2 / N) * sumReal;
            imag[k] = (2 / N) * sumImag;
        }

        // real[0] is DC offset, usually 0
        real[0] = 0;
        imag[0] = 0;

        try {
            this.customWave = this.audioContext.createPeriodicWave(real, imag, { disableNormalization: false });
            if (this.lfo) {
                this.lfo.setPeriodicWave(this.customWave);
            }
        } catch (e) {
            console.error("Failed to create custom LFO PeriodicWave:", e);
            this.customWave = null;
        }
    }

    /**
     * Set the LFO rate for formant shifting.
     * @param rate LFO rate in Hz
     * @param time Optional time to apply the change
     */
    setLfoRate(rate: number, time?: number): void {
        this.lfoRate = rate;
        if (this.lfo) {
            const t = time || this.audioContext.currentTime;
            this.lfo.frequency.cancelScheduledValues(t);
            this.lfo.frequency.setValueAtTime(rate, t);
        }
    }

    /**
     * Helper to create a PeriodicWave from a custom LFO shape array using DFT.
     * @param shape Array of values (-1 to 1) representing the waveform
     */
    private createPeriodicWaveFromShape(shape: number[]): PeriodicWave | null {
        if (!shape || shape.length === 0 || typeof this.audioContext.createPeriodicWave !== 'function') {
            return null;
        }

        const N = shape.length;
        // Need max length of 8192 for createPeriodicWave
        const maxHarmonics = Math.min(Math.floor(N / 2), 4096);
        const real = new Float32Array(maxHarmonics + 1);
        const imag = new Float32Array(maxHarmonics + 1);

        // Discrete Fourier Transform (DFT)
        // We calculate the fundamental and up to maxHarmonics
        for (let k = 1; k <= maxHarmonics; k++) {
            let r = 0;
            let i = 0;
            for (let n = 0; n < N; n++) {
                const angle = (2 * Math.PI * k * n) / N;
                r += shape[n] * Math.cos(angle);
                // Note: negative sign because we want to match standard DFT convention,
                // but createPeriodicWave expects the sine terms to be in `imag` for a standard Fourier series
                // Web Audio API formulation: x(t) = sum( real[k]*cos(k*w*t) + imag[k]*sin(k*w*t) )
                i += shape[n] * Math.sin(angle);
            }
            real[k] = (2 / N) * r;
            imag[k] = (2 / N) * i;
        }

        // DC offset (k=0)
        let dc = 0;
        for (let n = 0; n < N; n++) {
            dc += shape[n];
        }
        real[0] = dc / N;
        imag[0] = 0;

        try {
            return this.audioContext.createPeriodicWave(real, imag, { disableNormalization: false });
        } catch (e) {
            console.error("Failed to create periodic wave:", e);
            return null;
        }
    }

    /**
     * Set a custom LFO shape.
     * @param shape Array of values from -1 to 1
     */
    setLfoShape(shape: number[] | null): void {
        this.lfoShape = shape;
        if (this.lfo) {
            if (shape && shape.length > 0) {
                const periodicWave = this.createPeriodicWaveFromShape(shape);
                if (periodicWave) {
                    this.lfo.setPeriodicWave(periodicWave);
                } else {
                    this.lfo.type = 'sine';
                }
            } else {
                this.lfo.type = 'sine';
            }
        }
    }

    /**
     * Set the LFO depth for formant shifting.
     * @param depth LFO depth (0-1)
     * @param time Optional time to apply the change
     */
    setLfoDepth(depth: number, time?: number): void {
        this.lfoDepth = depth;
        if (this.lfoGain) {
            const t = time || this.audioContext.currentTime;
            this.lfoGain.gain.cancelScheduledValues(t);
            this.lfoGain.gain.setValueAtTime(depth * 1200, t); // Map 0-1 to 0-1200 cents
        }
    }

    /**
     * Update an existing filter chain with new shift values.
     * More efficient than recreating the entire chain.
     * 
     * @param shift New formant shift specification
     * @param rampTime Optional duration for interpolating to the new shift (seconds)
     */
    updateFilterChain(shift: FormantShift, rampTime: number = 0.05, startTime?: number): void {
        if (this.filterNodes.length === 0) {
            this.createFilterChain(shift);
            return;
        }
        
        const formants = [
            { freq: this.sourceFormants.f1, shift: shift.f1Shift },
            { freq: this.sourceFormants.f2, shift: shift.f2Shift },
            { freq: this.sourceFormants.f3, shift: shift.f3Shift }
        ];
        
        if (this.sourceFormants.f4 && shift.f4Shift !== undefined) {
            formants.push({ freq: this.sourceFormants.f4, shift: shift.f4Shift });
        }
        
        const now = startTime ?? this.audioContext.currentTime;
        const targetTime = now + rampTime;

        // Update frequency and gain of existing filters
        for (let i = 0; i < formants.length && i < this.filterNodes.length; i++) {
            const { freq, shift: semitonesShift } = formants[i];
            const freqMultiplier = Math.pow(2, semitonesShift / 12);
            const targetFreq = freq * freqMultiplier;
            
            this.filterNodes[i].frequency.cancelScheduledValues(now);
            this.filterNodes[i].frequency.setValueAtTime(this.filterNodes[i].frequency.value, now);
            this.filterNodes[i].frequency.linearRampToValueAtTime(targetFreq, targetTime);

            this.filterNodes[i].gain.cancelScheduledValues(now);
            this.filterNodes[i].gain.setValueAtTime(this.filterNodes[i].gain.value, now);
            this.filterNodes[i].gain.linearRampToValueAtTime(Math.abs(semitonesShift) * 2, targetTime);
        }
        
        this.currentShift = shift;
    }
    
    /**
     * Interpolate between two voice characters smoothly.
     * 
     * @param from Source voice character
     * @param to Target voice character
     * @param amount Interpolation amount (0.0 = from, 1.0 = to)
     * @returns Interpolated formant shift
     */
    interpolateCharacters(from: VoiceCharacter, to: VoiceCharacter, amount: number): FormantShift {
        const fromShift = this.calculateCharacterShift('default', from);
        const toShift = this.calculateCharacterShift('default', to);
        
        const t = Math.max(0, Math.min(1, amount)); // Clamp to [0, 1]
        
        return {
            f1Shift: fromShift.f1Shift + (toShift.f1Shift - fromShift.f1Shift) * t,
            f2Shift: fromShift.f2Shift + (toShift.f2Shift - fromShift.f2Shift) * t,
            f3Shift: fromShift.f3Shift + (toShift.f3Shift - fromShift.f3Shift) * t,
            f4Shift: fromShift.f4Shift && toShift.f4Shift 
                ? fromShift.f4Shift + (toShift.f4Shift - fromShift.f4Shift) * t 
                : undefined
        };
    }
    
    /**
     * Calculate formant shift to transform from one voice character to another.
     * 
     * @param from Source voice character
     * @param to Target voice character
     * @returns Formant shift specification
     */
    calculateCharacterShift(from: VoiceCharacter, to: VoiceCharacter): FormantShift {
        const sourceFormants = VOICE_FORMANTS[from];
        const targetFormants = VOICE_FORMANTS[to];
        
        // Calculate shift in semitones (12 semitones = 1 octave = 2x frequency)
        const freqRatioToSemitones = (ratio: number) => 12 * Math.log2(ratio);
        
        return {
            f1Shift: freqRatioToSemitones(targetFormants.f1 / sourceFormants.f1),
            f2Shift: freqRatioToSemitones(targetFormants.f2 / sourceFormants.f2),
            f3Shift: freqRatioToSemitones(targetFormants.f3 / sourceFormants.f3)
        };
    }
    
    /**
     * Calculate formant shift based on pitch shift to preserve vocal quality.
     * This compensates for Rubber Band's OptionFormantShifted mode.
     * 
     * @param pitchShiftSemitones Pitch shift in semitones
     * @returns Compensatory formant shift
     */
    calculateCompensatoryShift(pitchShiftSemitones: number): FormantShift {
        // When pitch is shifted, formants shift with it by default
        // To preserve the original timbre, we need to shift formants back
        return {
            f1Shift: -pitchShiftSemitones,
            f2Shift: -pitchShiftSemitones,
            f3Shift: -pitchShiftSemitones,
            f4Shift: -pitchShiftSemitones
        };
    }
    
    /**
     * Get the input node of the filter chain.
     */
    getInputNode(): BiquadFilterNode | null {
        return this.filterNodes[0] ?? null;
    }
    
    /**
     * Get the output node of the filter chain.
     */
    getOutputNode(): BiquadFilterNode | null {
        return this.filterNodes[this.filterNodes.length - 1] ?? null;
    }
    
    /**
     * Connect the formant shifter between source and destination nodes.
     * 
     * @param source Source audio node
     * @param destination Destination audio node
     */
    connect(source: AudioNode, destination: AudioNode): void {
        const input = this.getInputNode();
        const output = this.getOutputNode();
        
        if (input && output) {
            source.connect(input);
            if (this.followerWaveshaper) {
                source.connect(this.followerWaveshaper);
            }
            output.connect(destination);
        } else {
            // No filters, direct connection
            source.connect(destination);
        }
    }
    
    /**
     * Disconnect all filter nodes.
     */
    disconnect(): void {
        this.filterNodes.forEach(filter => filter.disconnect());
        this.filterNodes = [];
        this.currentShift = null;

        if (this.lfo) {
            this.lfo.stop();
            this.lfo.disconnect();
            this.lfo = null;
        }
        if (this.lfoGain) {
            this.lfoGain.disconnect();
            this.lfoGain = null;
        }

        if (this.envNode) {
            this.envNode.stop();
            this.envNode.disconnect();
            this.envNode = null;
        }
        if (this.envGain) {
            this.envGain.disconnect();
            this.envGain = null;
        }

        if (this.sidechainNode) {
            this.sidechainNode.stop();
            this.sidechainNode.disconnect();
            this.sidechainNode = null;
        }
        if (this.sidechainGain) {
            this.sidechainGain.disconnect();
            this.sidechainGain = null;
        }

        if (this.followerWaveshaper) {
            this.followerWaveshaper.disconnect();
            this.followerWaveshaper = null;
        }
        if (this.followerFilter) {
            this.followerFilter.disconnect();
            this.followerFilter = null;
        }
        if (this.followerGain) {
            this.followerGain.disconnect();
            this.followerGain = null;
        }
    }

    /**
     * Set the envelope follower depth.
     * @param depth Modulate formant detune amount in semitones
     * @param time Optional time to apply the change
     */
    setEnvFollowerDepth(depth: number, time?: number): void {
        this.followerDepth = depth;
        if (this.followerGain) {
            const t = time || this.audioContext.currentTime;
            this.followerGain.gain.cancelScheduledValues(t);
            this.followerGain.gain.setValueAtTime(depth * 100, t); // Map semitones to cents
        }
    }
    
    /**
     * Trigger a formant envelope.


     * @param amount Peak shift amount in semitones
     * @param attack Attack time in seconds
     * @param decay Decay time in seconds
     * @param time Trigger time
     */
    triggerEnvelope(amount: number, attack: number, decay: number, time?: number): void {
        if (!this.envGain) return;

        const t = time || this.audioContext.currentTime;
        const gainParam = this.envGain.gain;

        gainParam.cancelScheduledValues(t);
        gainParam.setValueAtTime(0, t);

        const peakGain = amount * 100; // Map semitones to cents

        if (attack > 0) {
            gainParam.linearRampToValueAtTime(peakGain, t + attack);
        } else {
            gainParam.setValueAtTime(peakGain, t);
        }

        if (decay > 0) {
            gainParam.linearRampToValueAtTime(0, t + attack + decay);
        } else {
            gainParam.setValueAtTime(0, t + attack);
        }
    }

    /**
     * Get the current formant shift settings.
     */
    getCurrentShift(): FormantShift | null {
        return this.currentShift;
    }
    
    /**
     * Trigger a sidechain ducking effect on the formants.
     *
     * @param amount Depth of the duck in semitones
     * @param releaseTime Recovery time in seconds
     * @param time Trigger time
     */
    triggerSidechainDuck(amount: number, releaseTime: number, time?: number): void {
        if (!this.sidechainGain) return;

        const t = time || this.audioContext.currentTime;
        const gainParam = this.sidechainGain.gain;
        const duckCents = -Math.abs(amount) * 100; // negative = pull formants back

        gainParam.cancelScheduledValues(t);
        gainParam.setValueAtTime(duckCents, t); // instant (or very short) drop
        gainParam.linearRampToValueAtTime(0, t + releaseTime); // smooth recovery
    }

    /**
     * Set source formant frequencies (useful for adapting to different voices).
     * 
     * @param formants New source formant frequencies
     */
    setSourceFormants(formants: FormantFrequencies): void {
        this.sourceFormants = formants;
        
        // Recreate filters if they exist
        if (this.currentShift) {
            this.createFilterChain(this.currentShift);
        }
    }
}

/**
 * Integration Notes:
 * 
 * 1. Using with RubberBand OptionFormantShifted:
 *    ```typescript
 *    // In RubberBandProcessor, use OptionFormantShifted instead of OptionFormantPreserved
 *    // This allows formants to shift with pitch
 *    rubberBand.setFormantOption(RubberBand.OptionFormantShifted);
 *    rubberBand.setPitchScale(pitchRatio);
 *    
 *    // Then apply FormantShifter to correct formants
 *    const formantShifter = new FormantShifter({ audioContext });
 *    const compensatoryShift = formantShifter.calculateCompensatoryShift(pitchShiftSemitones);
 *    formantShifter.createFilterChain(compensatoryShift);
 *    formantShifter.connect(rubberBandOutput, audioDestination);
 *    ```
 * 
 * 2. Voice character transformation:
 *    ```typescript
 *    const formantShifter = new FormantShifter({ audioContext });
 *    formantShifter.createCharacterFilterChain('female', 'male');
 *    formantShifter.connect(source, destination);
 *    ```
 * 
 * 3. Real-time morphing:
 *    ```typescript
 *    const shift = formantShifter.interpolateCharacters('male', 'female', morphAmount);
 *    formantShifter.updateFilterChain(shift);
 *    ```
 * 
 * 4. Integration with AudioWorklet:
 *    - FormantShifter uses Web Audio API nodes, which run in the main thread
 *    - For lowest latency, connect after the worklet's output
 *    - Alternatively, implement formant shifting in WASM for worklet processing
 * 
 * 5. Formant frequency reference values:
 *    - Male adult: F1=400Hz, F2=1200Hz, F3=2400Hz
 *    - Female adult: F1=600Hz, F2=1800Hz, F3=2800Hz
 *    - Child: F1=700Hz, F2=2100Hz, F3=3100Hz
 *    - These are averages; actual formants vary by vowel
 * 
 * @see RUBBERBAND_ENHANCEMENT_PLAN.md Section 4
 */
