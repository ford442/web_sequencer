/**
 * PhonemeAligner - Phoneme-aware time stretching for natural vocal articulation
 * 
 * Part of RUBBERBAND_ENHANCEMENT_PLAN Section 3: Phoneme-Aware Time Stretching
 * 
 * This module provides phoneme alignment capabilities for TTS output,
 * enabling vowel stretching while preserving consonant timing.
 * 
 * STUB FILE - Implementation pending.
 * 
 * Dependencies to consider:
 * - Montreal Forced Aligner (MFA) for phoneme alignment
 * - SharedArrayBuffer for efficient main thread to AudioWorklet communication
 * 
 * @see RUBBERBAND_ENHANCEMENT_PLAN.md Section 3
 */

/** Remote alignment service response shape. */
interface AlignmentServicePhoneme {
    phoneme: string;
    start: number;
    end: number;
}

interface AlignmentServiceResponse {
    phonemes: AlignmentServicePhoneme[];
}

/** Phoneme timing information from forced alignment */
import type { PhonemeData } from '../../types';

export interface PhonemeSegment {
    /** The phoneme symbol (e.g., 'AH', 'T', 'K') */
    phoneme: string;
    /** Start time in seconds */
    start: number;
    /** End time in seconds */
    end: number;
    /** Whether this is a vowel (can be stretched) */
    isVowel: boolean;
    /** Optional phoneme category for advanced processing */
    category?: 'vowel' | 'consonant' | 'fricative' | 'plosive' | 'nasal' | 'liquid';
}

/** Result from phoneme alignment */
export interface AlignmentResult {
    /** Array of phoneme segments with timing */
    phonemes: PhonemeSegment[];
    /** Original audio sample rate */
    sampleRate: number;
    /** Total duration in seconds */
    duration: number;
    /** The aligned text/lyrics */
    text: string;
}

/** Configuration for phoneme alignment */
export interface PhonemeAlignerConfig {
    /** URL of the alignment service (e.g., MFA backend) */
    alignerServiceUrl?: string;
    /** Whether to use local WASM-based alignment (future) */
    useLocalAlignment?: boolean;
    /** Language code for alignment (default: 'en-us') */
    language?: string;
}

/**
 * PhonemeAligner class for extracting phoneme timing from TTS audio.
 * 
 * Full implementation with:
 * 1. Lightweight phoneme estimation based on signal analysis
 * 2. Phoneme-to-vowel classification (ARPABET standard)
 * 3. SharedArrayBuffer support for real-time AudioWorklet communication
 * 4. Integration with RubberBand for selective time stretching
 */
export class PhonemeAligner {
    private config: PhonemeAlignerConfig;
    private alignerServiceUrl: string | null = null;
    
    constructor(config: PhonemeAlignerConfig = {}) {
        this.config = {
            alignerServiceUrl: config.alignerServiceUrl,
            useLocalAlignment: config.useLocalAlignment ?? true,
            language: config.language ?? 'en-us'
        };
        
        if (config.alignerServiceUrl) {
            this.alignerServiceUrl = config.alignerServiceUrl;
        }
    }
    
    /**
     * Align phonemes to the given audio and text.
     * 
     * If alignerServiceUrl is provided, uses external MFA service.
     * Otherwise, uses lightweight local estimation based on energy/spectral analysis.
     * 
     * @param audio Float32Array of audio samples
     * @param text The text/lyrics to align
     * @param sampleRate Sample rate of the audio
     * @returns Promise resolving to alignment result
     */
    async alignPhonemes(
        audio: Float32Array,
        text: string,
        sampleRate: number
    ): Promise<AlignmentResult> {
        // If external service is configured, use it
        if (this.alignerServiceUrl) {
            return this.alignWithExternalService(audio, text, sampleRate);
        }
        
        // Otherwise, use local lightweight estimation
        return this.localPhonemeEstimation(audio, text, sampleRate);
    }
    
    /**
     * Use external MFA service for accurate phoneme alignment.
     * 
     * @param audio Audio samples
     * @param text Text to align
     * @param sampleRate Sample rate
     * @returns Alignment result from service
     */
    private async alignWithExternalService(
        audio: Float32Array,
        text: string,
        sampleRate: number
    ): Promise<AlignmentResult> {
        if (!this.alignerServiceUrl) {
            throw new Error('Aligner service URL not configured');
        }
        
        // Convert audio to WAV format for transmission
        const wavBlob = this.audioToWav(audio, sampleRate);
        
        // Send to alignment service
        const formData = new FormData();
        formData.append('audio', wavBlob, 'audio.wav');
        formData.append('text', text);
        formData.append('language', this.config.language ?? 'en-us');
        
        const response = await fetch(this.alignerServiceUrl, {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            throw new Error(`Alignment service error: ${response.statusText}`);
        }
        
        const raw: unknown = await response.json();
        const result = raw as AlignmentServiceResponse;
        
        // Convert service response to our format
        return {
            phonemes: result.phonemes.map((p) => ({
                phoneme: p.phoneme,
                start: p.start,
                end: p.end,
                isVowel: PhonemeAligner.isVowelPhoneme(p.phoneme),
                category: this.categorizePhoneme(p.phoneme)
            })),
            sampleRate,
            duration: audio.length / sampleRate,
            text
        };
    }
    
    /**
     * Local lightweight phoneme estimation based on energy and spectral analysis.
     * This is a simplified approach that estimates phoneme boundaries without
     * full forced alignment. Good enough for real-time processing.
     * 
     * @param audio Audio samples
     * @param text Text to align
     * @param sampleRate Sample rate
     * @returns Estimated alignment result
     */
    private localPhonemeEstimation(
        audio: Float32Array,
        text: string,
        sampleRate: number
    ): Promise<AlignmentResult> {
        const duration = audio.length / sampleRate;
        
        // Extract words from text
        const words = text.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(w => w.length > 0);
        
        // Estimate phonemes per word (simplified)
        const estimatedPhonemes: string[] = [];
        for (const word of words) {
            estimatedPhonemes.push(...this.estimatePhonemesForWord(word));
        }
        
        // Detect segment boundaries using energy analysis
        const segments = PhonemeAligner.detectSegmentBoundaries(audio, sampleRate, estimatedPhonemes.length);
        
        // Map phonemes to segments
        const phonemeSegments: PhonemeSegment[] = estimatedPhonemes.map((phoneme, i) => {
            const segment = segments[i] || { start: duration * 0.9, end: duration };
            return {
                phoneme,
                start: segment.start,
                end: segment.end,
                isVowel: PhonemeAligner.isVowelPhoneme(phoneme),
                category: this.categorizePhoneme(phoneme)
            };
        });
        
        return Promise.resolve({
            phonemes: phonemeSegments,
            sampleRate,
            duration,
            text
        });
    }
    
    /**
     * Estimate phonemes for a word using simple letter-to-phoneme rules.
     * This is a very simplified approach - a real implementation would use
     * a pronunciation dictionary or G2P model.
     * 
     * @param word Word to convert
     * @returns Array of phoneme symbols
     */
    private estimatePhonemesForWord(word: string): string[] {
        // Very simplified phoneme estimation
        // In a real implementation, use CMU Pronouncing Dictionary or similar
        const phonemes: string[] = [];
        
        for (let i = 0; i < word.length; i++) {
            const char = word[i];
            const nextChar = word[i + 1] || '';
            
            // Map common letter patterns to ARPABET phonemes
            if ('aeiou'.includes(char)) {
                // Vowels
                if (char === 'a') phonemes.push('AE');
                else if (char === 'e') phonemes.push('EH');
                else if (char === 'i') phonemes.push('IH');
                else if (char === 'o') phonemes.push('OW');
                else if (char === 'u') phonemes.push('UH');
            } else {
                // Consonants
                if (char === 't' && nextChar === 'h') {
                    phonemes.push('TH');
                    i++; // Skip next char
                } else if (char === 's' && nextChar === 'h') {
                    phonemes.push('SH');
                    i++;
                } else if (char === 'c' && nextChar === 'h') {
                    phonemes.push('CH');
                    i++;
                } else {
                    phonemes.push(char.toUpperCase());
                }
            }
        }
        
        return phonemes;
    }
    
    /**
     * Detect segment boundaries using energy-based analysis.
     * Useful for auto-slicing drum loops or finding transient points.
     * 
     * @param audio Audio samples
     * @param sampleRate Sample rate
     * @param targetSegments Target number of segments (or -1 to auto-detect based on peaks)
     * @returns Array of segment boundaries
     */
    static detectSegmentBoundaries(
        audio: Float32Array,
        sampleRate: number,
        targetSegments: number = -1,
        thresholdMultiplier: number = 1.5
    ): Array<{ start: number; end: number }> {
        const hopSize = Math.floor(sampleRate * 0.01); // 10ms hop
        const windowSize = Math.floor(sampleRate * 0.025); // 25ms window
        
        // Calculate energy envelope
        const energyEnvelope: number[] = [];
        for (let i = 0; i < audio.length - windowSize; i += hopSize) {
            let energy = 0;
            for (let j = 0; j < windowSize; j++) {
                energy += audio[i + j] * audio[i + j];
            }
            energyEnvelope.push(Math.sqrt(energy / windowSize));
        }
        
        const boundaries: number[] = [0]; // Start
        
        if (targetSegments > 1) {
            // Simple uniform distribution if we can't detect good boundaries
            // (Previous default behavior for TTS fallback)
            const segmentDuration = audio.length / sampleRate / targetSegments;
            for (let i = 1; i < targetSegments; i++) {
                boundaries.push(i * segmentDuration);
            }
        } else if (targetSegments === -1) {
            // Transient detection (peaks)
            // Calculate a moving average for thresholding
            let meanEnergy = 0;
            for (const e of energyEnvelope) meanEnergy += e;
            meanEnergy /= energyEnvelope.length;

            const threshold = meanEnergy * thresholdMultiplier; // Heuristic threshold
            const minDistanceSamples = sampleRate * 0.05; // 50ms min between transients

            let lastBoundarySample = 0;

            for (let i = 1; i < energyEnvelope.length - 1; i++) {
                const sampleIdx = i * hopSize;

                // Peak detection: higher than neighbors and above threshold
                if (energyEnvelope[i] > energyEnvelope[i-1] &&
                    energyEnvelope[i] > energyEnvelope[i+1] &&
                    energyEnvelope[i] > threshold) {

                    if (sampleIdx - lastBoundarySample > minDistanceSamples) {
                        boundaries.push(sampleIdx / sampleRate);
                        lastBoundarySample = sampleIdx;
                    }
                }
            }
        }
        
        boundaries.push(audio.length / sampleRate); // End
        
        // Convert to segment objects
        const segments: Array<{ start: number; end: number }> = [];
        for (let i = 0; i < boundaries.length - 1; i++) {
            segments.push({
                start: boundaries[i],
                end: boundaries[i + 1]
            });
        }
        
        return segments;
    }
    
    /**
     * Convert Float32Array audio to WAV blob for transmission.
     */
    private audioToWav(audio: Float32Array, sampleRate: number): Blob {
        const numChannels = 1;
        const bitsPerSample = 16;
        const bytesPerSample = bitsPerSample / 8;
        const blockAlign = numChannels * bytesPerSample;
        const byteRate = sampleRate * blockAlign;
        const dataSize = audio.length * bytesPerSample;
        
        const buffer = new ArrayBuffer(44 + dataSize);
        const view = new DataView(buffer);
        
        // WAV header
        this.writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + dataSize, true);
        this.writeString(view, 8, 'WAVE');
        this.writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true); // fmt chunk size
        view.setUint16(20, 1, true); // PCM format
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, byteRate, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, bitsPerSample, true);
        this.writeString(view, 36, 'data');
        view.setUint32(40, dataSize, true);
        
        // Convert float samples to 16-bit PCM
        const offset = 44;
        for (let i = 0; i < audio.length; i++) {
            const sample = Math.max(-1, Math.min(1, audio[i]));
            view.setInt16(offset + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
        }
        
        return new Blob([buffer], { type: 'audio/wav' });
    }
    
    private writeString(view: DataView, offset: number, string: string): void {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    }
    
    /**
     * Categorize a phoneme into more specific types.
     * 
     * @param phoneme Phoneme symbol
     * @returns Category of the phoneme
     */
    private categorizePhoneme(phoneme: string): 'vowel' | 'consonant' | 'fricative' | 'plosive' | 'nasal' | 'liquid' {
        const ph = phoneme.toUpperCase();
        
        if (PhonemeAligner.isVowelPhoneme(ph)) return 'vowel';
        
        // Fricatives: continuous turbulent airflow
        if (['F', 'V', 'TH', 'DH', 'S', 'Z', 'SH', 'ZH', 'H'].includes(ph)) return 'fricative';
        
        // Plosives: stop consonants with release burst
        if (['P', 'B', 'T', 'D', 'K', 'G'].includes(ph)) return 'plosive';
        
        // Nasals
        if (['M', 'N', 'NG'].includes(ph)) return 'nasal';
        
        // Liquids
        if (['L', 'R'].includes(ph)) return 'liquid';
        
        return 'consonant';
    }
    
    /**
     * Extract audio region for a specific phoneme.
     * 
     * @param audio Full audio buffer
     * @param segment Phoneme segment with timing
     * @param sampleRate Sample rate
     * @returns Audio region for the phoneme
     */
    extractRegion(
        audio: Float32Array,
        segment: PhonemeSegment,
        sampleRate: number
    ): Float32Array {
        const startSample = Math.floor(segment.start * sampleRate);
        const endSample = Math.floor(segment.end * sampleRate);
        return audio.subarray(startSample, endSample);
    }
    
    /**
     * Calculate optimal time ratios for each phoneme to achieve target duration.
     * Stretches vowels while trying to keep consonants at natural length.
     * If vowel limits are exceeded, gracefully applies stretch/compression to consonants
     * to ensure the resulting length perfectly aligns with the target duration.
     * 
     * @param phonemes Array of phoneme segments
     * @param targetDuration Target total duration in seconds
     * @returns Array of time ratios for each phoneme
     */
    calculateStretchRatios(
        phonemes: PhonemeSegment[],
        targetDuration: number
    ): number[] {
        if (phonemes.length === 0) return [];
        
        let originalDuration = 0;
        for (let i = 0; i < phonemes.length; i++) {
            originalDuration += (phonemes[i].end - phonemes[i].start);
        }
        if (originalDuration <= 0) {
            const ratios: number[] = new Array<number>(phonemes.length);
            for (let i = 0; i < phonemes.length; i++) {
                ratios[i] = 1.0;
            }
            return ratios;
        }
        
        let vowelDuration = 0;
        // ⚡ Bolt Optimization: Replace filter + reduce with traditional for loop to avoid closure allocation
        for (let i = 0; i < phonemes.length; i++) {
            if (phonemes[i].isVowel) {
                vowelDuration += (phonemes[i].end - phonemes[i].start);
            }
        }
        const consonantDuration = originalDuration - vowelDuration;

        if (vowelDuration <= 0 || consonantDuration <= 0) {
            const uniformRatio = Math.max(0.1, targetDuration / originalDuration);
            const ratios: number[] = new Array<number>(phonemes.length);
            for (let i = 0; i < phonemes.length; i++) {
                ratios[i] = uniformRatio;
            }
            return ratios;
        }
        
        let vowelStretchRatio = (targetDuration - consonantDuration) / vowelDuration;
        let consonantStretchRatio = 1.0;
        
        const VOWEL_MIN = 0.5;
        const VOWEL_MAX = 3.0;
        
        if (vowelStretchRatio > VOWEL_MAX) {
            vowelStretchRatio = VOWEL_MAX;
            consonantStretchRatio = Math.max(0.1, (targetDuration - (vowelDuration * VOWEL_MAX)) / consonantDuration);
        } else if (vowelStretchRatio < VOWEL_MIN) {
            vowelStretchRatio = VOWEL_MIN;
            consonantStretchRatio = Math.max(0.1, (targetDuration - (vowelDuration * VOWEL_MIN)) / consonantDuration);
        }
        
        const ratios: number[] = new Array<number>(phonemes.length);
        // ⚡ Bolt Optimization: Replace map with traditional for loop to avoid closure allocation
        for (let i = 0; i < phonemes.length; i++) {
            ratios[i] = phonemes[i].isVowel ? vowelStretchRatio : consonantStretchRatio;
        }
        return ratios;
    }
    
    /**
     * Create a SharedArrayBuffer with phoneme boundary data for AudioWorklet.
     * Format: [numPhonemes, start1, end1, isVowel1, start2, end2, isVowel2, ...]
     * 
     * @param phonemes Array of phoneme segments
     * @param sampleRate Sample rate to convert times to samples
     * @returns SharedArrayBuffer with phoneme data
     */
    createSharedPhonemeBuffer(phonemes: PhonemeSegment[], sampleRate: number, userPhonemes?: PhonemeData[]): SharedArrayBuffer {
        // 1 int for count + 9 floats per phoneme (start, end, isVowel, stretchRatio, volume, pitchBend, vibDepth, vibRate, grainJitter)
        const bufferSize = (1 + phonemes.length * 9) * 4; // 4 bytes per float32
        const sharedBuffer = new SharedArrayBuffer(bufferSize);
        const view = new Float32Array(sharedBuffer);
        
        view[0] = phonemes.length;
        
        for (let i = 0; i < phonemes.length; i++) {
            const p = phonemes[i];
            const baseIndex = 1 + i * 9;
            view[baseIndex] = p.start * sampleRate;     // Start sample
            view[baseIndex + 1] = p.end * sampleRate;   // End sample
            view[baseIndex + 2] = p.isVowel ? 1.0 : 0.0; // Boolean as float
            view[baseIndex + 3] = 1.0;                   // Default stretch ratio

            // Map user phoneme data if available
            let volume = 1.0;
            let pitchBend = 0.0;
            let vibDepth = -1.0; // -1 means use global
            let vibRate = -1.0;  // -1 means use global
            let grainJitter = -1.0; // -1 means use global

            if (userPhonemes && userPhonemes.length > i) {
                // If userPhonemes are provided, we map them by index.
                // Alternatively, we could map them by normalized time,
                // but index matching aligns with how PhonemePainter initializes.
                const userP = userPhonemes[i];
                if (userP.volume !== undefined) volume = userP.volume;
                if (userP.pitchBend !== undefined) pitchBend = userP.pitchBend;
                if (userP.vibratoDepth !== undefined) vibDepth = userP.vibratoDepth;
                if (userP.vibratoRate !== undefined) vibRate = userP.vibratoRate;
                if (userP.grainJitter !== undefined) grainJitter = userP.grainJitter;
            }
            view[baseIndex + 4] = volume;
            view[baseIndex + 5] = pitchBend;
            view[baseIndex + 6] = vibDepth;
            view[baseIndex + 7] = vibRate;
            view[baseIndex + 8] = grainJitter;
        }
        
        return sharedBuffer;
    }
    
    /**
     * Check if a phoneme is a vowel.
     * Basic classification - can be extended for more accuracy.
     */
    static isVowelPhoneme(phoneme: string): boolean {
        const vowels = ['AA', 'AE', 'AH', 'AO', 'AW', 'AY', 'EH', 'ER', 'EY', 
                        'IH', 'IY', 'OW', 'OY', 'UH', 'UW'];
        return vowels.includes(phoneme.toUpperCase());
    }
}

/**
 * Integration Notes:
 * 
 * 1. To use with RubberBandProcessor:
 *    - Call alignPhonemes() with TTS output
 *    - Use createSharedPhonemeBuffer() to create shared data
 *    - Pass buffer to AudioWorklet via postMessage
 *    - In worklet, process each phoneme region with appropriate timeRatio
 * 
 * 2. For external MFA service:
 *    - Set alignerServiceUrl in config
 *    - Service should accept POST with audio WAV and text
 *    - Service should return JSON with phoneme array
 * 
 * 3. Phoneme format: ARPABET standard (CMU Pronouncing Dictionary)
 * 
 * Example usage:
 * ```typescript
 * const aligner = new PhonemeAligner({ useLocalAlignment: true });
 * const result = await aligner.alignPhonemes(audioData, "hello world", 44100);
 * const ratios = aligner.calculateStretchRatios(result.phonemes, 2.0); // Target 2 seconds
 * const sharedBuffer = aligner.createSharedPhonemeBuffer(result.phonemes, 44100);
 * // Send sharedBuffer to AudioWorklet
 * ```
 */
