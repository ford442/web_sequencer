/**
 * Harmonizer - Creates layered vocal harmonies with formant variation and detune
 * 
 * Generates 2-4 voice configurations for rich, choir-like vocal textures.
 * Each voice has independent pitch, detune, and formant shift for natural
 * ensemble effects.
 */

import type { SamplerBankParams } from '../types';

/** Harmony type presets for common musical intervals */
export type HarmonyType = 'octave' | 'fifth' | 'third' | 'cluster' | 'custom';

/** Configuration for the harmonizer */
export interface HarmonizerConfig {
    /** Number of harmony voices (2-4) */
    voiceCount: 2 | 3 | 4;
    /** Type of harmony to generate */
    harmonyType: HarmonyType;
    /** Detune spread in cents (0-50) */
    detuneSpread: number;
    /** Formant spread in semitones (0-12) */
    formantSpread: number;
    /** Custom intervals for 'custom' type (in semitones) */
    customIntervals?: number[];
}

/** Generated voice parameters for a single harmony voice */
export interface HarmonyVoiceParams {
    /** Voice index (0 = base, 1+ = harmonies) */
    index: number;
    /** Pitch offset in semitones */
    pitchOffset: number;
    /** Detune in cents */
    detuneCents: number;
    /** Formant shift in semitones */
    formantShift: number;
    /** Pan position (-1 to 1) */
    pan: number;
    /** Volume gain (0-1) */
    gain: number;
}

/** Complete harmonized sampler configuration */
export interface HarmonizedSamplerConfig {
    /** Base voice configuration */
    baseConfig: SamplerBankParams;
    /** Array of voice parameters including base */
    voices: HarmonyVoiceParams[];
    /** Whether harmonize is currently active */
    isActive: boolean;
}

/** Default harmony intervals for each type (in semitones) */
const HARMONY_INTERVALS: Record<HarmonyType, number[]> = {
    octave: [0, 12],           // Root + Octave
    fifth: [0, 7],             // Root + Perfect Fifth
    third: [0, 4],             // Root + Major Third
    cluster: [-2, 0, 2, 4],    // Tight cluster around root
    custom: [0, 4, 7]          // Default custom (major triad)
};

/** Voice panning distribution for stereo spread */
const VOICE_PANNING: Record<number, number[]> = {
    2: [-0.3, 0.3],
    3: [-0.5, 0, 0.5],
    4: [-0.6, -0.2, 0.2, 0.6]
};

/** Voice gain distribution (center voices slightly louder) */
const VOICE_GAINS: Record<number, number[]> = {
    2: [0.85, 0.85],
    3: [0.8, 0.9, 0.8],
    4: [0.75, 0.85, 0.85, 0.75]
};

/**
 * Harmonizer class for creating layered vocal harmonies
 */
export class Harmonizer {
    private config: HarmonizerConfig;
    private isActive: boolean = false;

    constructor(config: HarmonizerConfig = {
        voiceCount: 2,
        harmonyType: 'third',
        detuneSpread: 15,
        formantSpread: 3
    }) {
        this.config = { ...config };
    }

    /**
     * Update harmonizer configuration
     */
    setConfig(config: Partial<HarmonizerConfig>): void {
        this.config = { ...this.config, ...config };
    }

    /**
     * Get current configuration
     */
    getConfig(): HarmonizerConfig {
        return { ...this.config };
    }

    /**
     * Activate/deactivate harmonize effect
     */
    setActive(active: boolean): void {
        this.isActive = active;
    }

    /**
     * Check if harmonize is active
     */
    getIsActive(): boolean {
        return this.isActive;
    }

    /**
     * Generate harmony voice parameters based on current config
     * @returns Array of voice parameters (including base voice at index 0)
     */
    generateVoices(): HarmonyVoiceParams[] {
        const { voiceCount, harmonyType, detuneSpread, formantSpread, customIntervals } = this.config;
        
        // Get base intervals for the harmony type
        let intervals = harmonyType === 'custom' 
            ? (customIntervals || HARMONY_INTERVALS.custom)
            : HARMONY_INTERVALS[harmonyType];
        
        // Adjust intervals based on voice count
        if (intervals.length > voiceCount) {
            intervals = intervals.slice(0, voiceCount);
        } else if (intervals.length < voiceCount) {
            // Extend with calculated intervals for more voices
            const extended = [...intervals];
            while (extended.length < voiceCount) {
                // Add voice an octave above previous
                const lastInterval = extended[extended.length - 1];
                extended.push(lastInterval + 12);
            }
            intervals = extended;
        }

        // Get panning and gain distributions
        const pans = VOICE_PANNING[voiceCount];
        const gains = VOICE_GAINS[voiceCount];

        // Generate voice parameters
        const voices: HarmonyVoiceParams[] = [];

        for (let i = 0; i < voiceCount; i++) {
            // Calculate detune with some randomness for natural variation
            const detuneBase = (Math.random() - 0.5) * detuneSpread;
            const detuneCents = i === 0 
                ? detuneBase // Base voice: random detune
                : detuneBase + (i % 2 === 0 ? detuneSpread / 2 : -detuneSpread / 2);

            // Calculate formant shift - spread across voices
            const formantBase = (i / (voiceCount - 1 || 1)) * formantSpread;
            const formantShift = i === 0 
                ? -formantBase / 2  // Base voice: slightly lower
                : formantBase - (formantSpread / 2);

            voices.push({
                index: i,
                pitchOffset: intervals[i],
                detuneCents: Math.round(detuneCents * 10) / 10,
                formantShift: Math.round(formantShift * 10) / 10,
                pan: pans[i],
                gain: gains[i]
            });
        }

        return voices;
    }

    /**
     * Generate sampler bank configurations for each harmony voice
     * @param baseParams Base sampler parameters to derive from
     * @returns Array of sampler bank params for each voice
     */
    generateSamplerConfigs(baseParams: SamplerBankParams): SamplerBankParams[] {
        if (!this.isActive) {
            return [baseParams];
        }

        const voices = this.generateVoices();
        
        return voices.map(voice => ({
            ...baseParams,
            // Apply pitch offset via playback speed (semitone to ratio)
            playbackSpeed: baseParams.playbackSpeed * Math.pow(2, voice.pitchOffset / 12),
            // Apply fine detune
            fineTune: (baseParams.fineTune || 0) + voice.detuneCents,
            // Apply formant shift
            formantShift: (baseParams.formantShift || 0) + voice.formantShift,
            // Apply pan
            pan: voice.pan,
            // Adjust volume
            volume: baseParams.volume * voice.gain,
            // Mark as harmony voice
            isHarmonyVoice: true,
            harmonyIndex: voice.index
        }));
    }

    /**
     * Toggle harmonize on/off
     */
    toggle(): boolean {
        this.isActive = !this.isActive;
        return this.isActive;
    }

    /**
     * Get a descriptive label for the current harmony setting
     */
    getLabel(): string {
        if (!this.isActive) return 'OFF';
        
        const typeLabels: Record<HarmonyType, string> = {
            octave: 'OCT',
            fifth: '5TH',
            third: '3RD',
            cluster: 'CLU',
            custom: 'CUST'
        };
        
        return `${this.config.voiceCount}V ${typeLabels[this.config.harmonyType]}`;
    }
}

/**
 * Factory function to create a harmonizer with default settings
 */
export function createHarmonizer(
    voiceCount: 2 | 3 | 4 = 2,
    harmonyType: HarmonyType = 'third',
    detuneSpread: number = 15,
    formantSpread: number = 3
): Harmonizer {
    return new Harmonizer({
        voiceCount,
        harmonyType,
        detuneSpread,
        formantSpread
    });
}

/**
 * Quick harmonize presets for common use cases
 */
export const HARMONIZE_PRESETS = {
    /** Subtle doubling with slight detune */
    subtle: (): HarmonizerConfig => ({
        voiceCount: 2,
        harmonyType: 'octave',
        detuneSpread: 8,
        formantSpread: 2
    }),
    
    /** Classic vocal harmony (major third) */
    classic: (): HarmonizerConfig => ({
        voiceCount: 2,
        harmonyType: 'third',
        detuneSpread: 12,
        formantSpread: 4
    }),
    
    /** Rich choir sound with 4 voices */
    choir: (): HarmonizerConfig => ({
        voiceCount: 4,
        harmonyType: 'cluster',
        detuneSpread: 25,
        formantSpread: 6
    }),
    
    /** Power chord style (root + fifth) */
    power: (): HarmonizerConfig => ({
        voiceCount: 2,
        harmonyType: 'fifth',
        detuneSpread: 10,
        formantSpread: 3
    }),
    
    /** Wide ambient spread */
    ambient: (): HarmonizerConfig => ({
        voiceCount: 3,
        harmonyType: 'custom',
        detuneSpread: 35,
        formantSpread: 8,
        customIntervals: [0, 7, 12]
    })
};

export default Harmonizer;
