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
    /** Bus gain for harmony voices (0-1) */
    busGain?: number;
    /** Bus compressor threshold in dB (-60 to 0) */
    busCompressorThreshold?: number;
    /** Bus EQ lowshelf gain in dB (-24 to +24) */
    busEqGain?: number;
    /** Bus stereo widener amount (0-1) */
    busWidener?: number;
    /** Dedicated attack time for harmony voices (seconds) */
    harmonyAttack?: number;
    /** Dedicated release time for harmony voices (seconds) */
    harmonyRelease?: number;
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
    octave: [12, -12],         // +Octave, -Octave (no 0 - base is always added separately)
    fifth: [7, -7],            // +Fifth, -Fourth (no 0 - base is always added separately)
    third: [4, 3, -3, -4],     // Major 3rd, Minor 3rd, -Minor 3rd, -Major 3rd
    cluster: [2, -2, 1, -1],   // Dense cluster around root
    custom: [4, 7, 12]         // Default custom (major triad extensions)
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
        formantSpread: 3,
        busGain: 0.85,
        busCompressorThreshold: -18,
        busEqGain: -3.0,
        busWidener: 0.0,
        harmonyAttack: 0.1,
        harmonyRelease: 0.3
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
        
        // Get base intervals for the harmony type (excludes base voice at 0)
        let intervals = harmonyType === 'custom' 
            ? (customIntervals || HARMONY_INTERVALS.custom)
            : HARMONY_INTERVALS[harmonyType];
        
        // Ensure we have enough intervals for the requested voices (minus base voice)
        const neededHarmonyVoices = voiceCount - 1; // -1 because base voice is separate
        
        if (intervals.length > neededHarmonyVoices) {
            intervals = intervals.slice(0, neededHarmonyVoices);
        } else if (intervals.length < neededHarmonyVoices) {
            // Extend with calculated intervals for more voices
            const extended = [...intervals];
            while (extended.length < neededHarmonyVoices) {
                // Add voice an octave above/below previous
                const lastInterval = extended[extended.length - 1];
                const nextInterval = lastInterval > 0 ? lastInterval + 12 : lastInterval - 12;
                extended.push(nextInterval);
            }
            intervals = extended;
        }

        // Get panning and gain distributions for full voice count
        const pans = VOICE_PANNING[voiceCount];
        const gains = VOICE_GAINS[voiceCount];

        // Generate voice parameters
        const voices: HarmonyVoiceParams[] = [];

        // 1. Base voice (index 0) - always at pitch offset 0
        voices.push({
            index: 0,
            pitchOffset: 0,
            detuneCents: Math.round(((Math.random() - 0.5) * detuneSpread * 0.5) * 10) / 10, // Subtle detune for base
            formantShift: 0, // Base voice has no formant shift
            pan: pans[0], // Usually slightly left or center
            gain: gains[0]
        });

        // 2. Harmony voices (indices 1+)
        for (let i = 1; i < voiceCount; i++) {
            const intervalIndex = i - 1; // Offset because base voice is separate
            const interval = intervals[intervalIndex];
            
            // Calculate detune with some randomness for natural variation
            const detuneBase = (Math.random() - 0.5) * detuneSpread;
            const detuneCents = detuneBase + (i % 2 === 0 ? detuneSpread / 3 : -detuneSpread / 3);

            // Calculate formant shift - spread across harmony voices
            const formantBase = ((i - 1) / Math.max(1, voiceCount - 2)) * formantSpread;
            const formantShift = formantBase - (formantSpread / 2);

            voices.push({
                index: i,
                pitchOffset: interval,
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
        formantSpread: 2,
        busGain: 0.85,
        busCompressorThreshold: -12,
        busEqGain: -2.0,
        busWidener: 0.1,
        harmonyAttack: 0.1,
        harmonyRelease: 0.3
    }),
    
    /** Classic vocal harmony (major third) */
    classic: (): HarmonizerConfig => ({
        voiceCount: 2,
        harmonyType: 'third',
        detuneSpread: 12,
        formantSpread: 4,
        busGain: 0.85,
        busCompressorThreshold: -18,
        busEqGain: -3.0,
        busWidener: 0.3,
        harmonyAttack: 0.2,
        harmonyRelease: 0.4
    }),
    
    /** Rich choir sound with 4 voices */
    choir: (): HarmonizerConfig => ({
        voiceCount: 4,
        harmonyType: 'cluster',
        detuneSpread: 25,
        formantSpread: 6,
        busGain: 0.85,
        busCompressorThreshold: -24,
        busEqGain: -5.0,
        busWidener: 0.6,
        harmonyAttack: 0.4,
        harmonyRelease: 0.8
    }),
    
    /** Power chord style (root + fifth) */
    power: (): HarmonizerConfig => ({
        voiceCount: 2,
        harmonyType: 'fifth',
        detuneSpread: 10,
        formantSpread: 3,
        busGain: 0.85,
        busCompressorThreshold: -15,
        busEqGain: -1.0,
        busWidener: 0.2,
        harmonyAttack: 0.05,
        harmonyRelease: 0.2
    }),
    
    /** Wide ambient spread */
    ambient: (): HarmonizerConfig => ({
        voiceCount: 3,
        harmonyType: 'custom',
        detuneSpread: 35,
        formantSpread: 8,
        customIntervals: [0, 7, 12],
        busGain: 0.85,
        busCompressorThreshold: -20,
        busEqGain: -4.0,
        busWidener: 0.9,
        harmonyAttack: 0.8,
        harmonyRelease: 1.5
    })
};

export default Harmonizer;
