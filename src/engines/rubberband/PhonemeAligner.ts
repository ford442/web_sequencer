/**
 * PhonemeAligner - Phoneme-aware time stretching for natural vocal articulation
 *
 * Part of RUBBERBAND_ENHANCEMENT_PLAN Section 3.
 *
 * English TTS uses onnxruntime-web CTC forced alignment when the wav2vec2
 * model is available (download-on-demand). Heuristic G2P + uniform splits
 * remain the fallback. Optional remote MFA is still supported via
 * alignerServiceUrl but is not configured in engineLifecycle.
 *
 * @see RUBBERBAND_ENHANCEMENT_PLAN.md Section 3
 */

import type { PhonemeData } from '../../types';
import { CtcForcedAligner } from './alignment/ctcForcedAligner';
import {
    categorizePhoneme as categorizeArpabet,
    estimatePhonemesForWord as g2pWordFallback,
    g2pText,
    isArpabetVowel,
} from './alignment/g2p';
import type { AlignPassOptions } from './alignment/types';
import {
    ALIGNMENT_BOUNDARY_TOLERANCE_MS,
    type AlignmentResult,
    type PhonemeSegment,
} from './alignment/types';

/** Remote alignment service response shape. */
interface AlignmentServicePhoneme {
    phoneme: string;
    start: number;
    end: number;
}

interface AlignmentServiceResponse {
    phonemes: AlignmentServicePhoneme[];
}

export type { AlignmentResult, PhonemeSegment, AlignPassOptions };
export { ALIGNMENT_BOUNDARY_TOLERANCE_MS };

/** Configuration for phoneme alignment */
export interface PhonemeAlignerConfig {
    /** URL of the alignment service (e.g. MFA backend) */
    alignerServiceUrl?: string;
    /** Use local G2P + heuristic when CTC is unavailable (default true) */
    useLocalAlignment?: boolean;
    /** Language code for alignment (default: 'en-us') */
    language?: string;
    /**
     * Try wav2vec2 CTC first. Default false so unit tests stay fetch-free;
     * live SingingVoice enables this.
     */
    enableCtcAlignment?: boolean;
    /** Injected CTC backend (tests). */
    ctcAligner?: CtcForcedAligner;
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
    private ctcAligner: CtcForcedAligner | null = null;
    
    constructor(config: PhonemeAlignerConfig = {}) {
        this.config = {
            alignerServiceUrl: config.alignerServiceUrl,
            useLocalAlignment: config.useLocalAlignment ?? true,
            language: config.language ?? 'en-us',
            enableCtcAlignment: config.enableCtcAlignment ?? false,
            ctcAligner: config.ctcAligner,
        };
        
        if (config.alignerServiceUrl) {
            this.alignerServiceUrl = config.alignerServiceUrl;
        }
        if (config.ctcAligner) {
            this.ctcAligner = config.ctcAligner;
        } else if (config.enableCtcAlignment) {
            this.ctcAligner = new CtcForcedAligner();
        }
    }
    
    /**
     * Align phonemes to the given audio and text.
     *
     * Order: optional remote service → CTC (English) → local heuristic.
     */
    async alignPhonemes(
        audio: Float32Array,
        text: string,
        sampleRate: number,
        options: AlignPassOptions = {},
    ): Promise<AlignmentResult> {
        if (this.alignerServiceUrl) {
            try {
                return await this.alignWithExternalService(audio, text, sampleRate);
            } catch (error) {
                console.warn('PhonemeAligner: remote alignment failed, falling back', error);
            }
        }

        const lang = (this.config.language ?? 'en-us').toLowerCase();
        const english = lang.startsWith('en');
        if (this.ctcAligner && english) {
            try {
                const ctc = await this.ctcAligner.align(audio, text, sampleRate, options);
                if (ctc && ctc.phonemes.length > 0) {
                    return ctc;
                }
            } catch (error) {
                console.warn('PhonemeAligner: CTC alignment failed, using heuristic', error);
            }
        }
        
        return this.localPhonemeEstimation(audio, text, sampleRate, options);
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
        const phonemes = new Array<PhonemeSegment>(result.phonemes.length);
        for (let i = 0; i < result.phonemes.length; i++) {
            const p = result.phonemes[i];
            phonemes[i] = {
                phoneme: p.phoneme,
                start: p.start,
                end: p.end,
                isVowel: PhonemeAligner.isVowelPhoneme(p.phoneme),
                category: this.categorizePhoneme(p.phoneme)
            };
        }

        return {
            phonemes,
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
        sampleRate: number,
        options: AlignPassOptions = {},
    ): Promise<AlignmentResult> {
        const duration = audio.length / sampleRate;
        
        const estimatedPhonemes = g2pText(text);
        const phonemeSegments: PhonemeSegment[] = new Array<PhonemeSegment>(estimatedPhonemes.length);
        
        if (options.durationPriors && options.durationPriors.length === estimatedPhonemes.length && estimatedPhonemes.length > 0) {
            const total = options.durationPriors.reduce((a, b) => a + Math.max(1e-6, b), 0);
            let t = 0;
            for (let i = 0; i < estimatedPhonemes.length; i++) {
                const w = Math.max(1e-6, options.durationPriors[i]);
                const next = i === estimatedPhonemes.length - 1 ? duration : t + duration * (w / total);
                const phoneme = estimatedPhonemes[i];
                phonemeSegments[i] = {
                    phoneme,
                    start: t,
                    end: next,
                    isVowel: PhonemeAligner.isVowelPhoneme(phoneme),
                    category: this.categorizePhoneme(phoneme),
                };
                t = next;
            }
        } else {
            const segments = PhonemeAligner.detectSegmentBoundaries(audio, sampleRate, estimatedPhonemes.length);
            for (let i = 0; i < estimatedPhonemes.length; i++) {
                const phoneme = estimatedPhonemes[i];
                const segment = segments[i] || { start: duration * 0.9, end: duration };
                phonemeSegments[i] = {
                    phoneme,
                    start: segment.start,
                    end: segment.end,
                    isVowel: PhonemeAligner.isVowelPhoneme(phoneme),
                    category: this.categorizePhoneme(phoneme)
                };
            }
        }
        
        return Promise.resolve({
            phonemes: phonemeSegments,
            sampleRate,
            duration,
            text
        });
    }
    
    private estimatePhonemesForWord(word: string): string[] {
        return g2pWordFallback(word);
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
        return categorizeArpabet(phoneme);
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
        // 1 int for count + 10 floats per phoneme (start, end, isVowel, stretchRatio, volume, pitchBend, vibDepth, vibRate, grainJitter, grainSize)
        const bufferSize = (1 + phonemes.length * 10) * 4; // 4 bytes per float32
        const sharedBuffer = new SharedArrayBuffer(bufferSize);
        const view = new Float32Array(sharedBuffer);
        
        view[0] = phonemes.length;
        
        for (let i = 0; i < phonemes.length; i++) {
            const p = phonemes[i];
            const baseIndex = 1 + i * 10;
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
            let grainSize = -1.0;   // -1 means use global

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
                if (userP.grainSize !== undefined) grainSize = userP.grainSize;
            }
            view[baseIndex + 4] = volume;
            view[baseIndex + 5] = pitchBend;
            view[baseIndex + 6] = vibDepth;
            view[baseIndex + 7] = vibRate;
            view[baseIndex + 8] = grainJitter;
            view[baseIndex + 9] = grainSize;
        }
        
        return sharedBuffer;
    }
    
    /**
     * Check if a phoneme is a vowel.
     * Basic classification - can be extended for more accuracy.
     */
    static isVowelPhoneme(phoneme: string): boolean {
        return isArpabetVowel(phoneme);
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
