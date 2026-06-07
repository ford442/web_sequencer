import type { Pattern, SynthParams, KickParams, SnareParams, SamplerParams, SamplerBankParams, PartSequence, Bass2Params } from '../types';
import type { ScaleDefinition } from '../utils/musicTheory';
import { INITIAL_PATTERN, NUM_STEPS } from '../constants';

// --- CONSTANTS ---
export const DEFAULT_SAMPLER_BANK_PARAMS: SamplerBankParams = {
    sampleName: 'bank_0',
    playbackSpeed: 1.0,
    volume: 1.0,
    filterCutoff: 20000,
    filterResonance: 0,
    drive: 0,
    delaySend: 0,
    mode: 'loop',
    grainSize: 4410,
    freeze: 0,
    freezeLfoRate: 0,
    freezeLfoDepth: 0,
    timeStretchEnvDepth: 0,
    grainPitchShift: 0,
    expressiveness: {
        vibratoRate: 5.5,
        vibratoDepth: 0,
        tremoloDepth: 0,
        breathAmount: 0,
    },
};

export const INITIAL_SAMPLER_PARAMS: SamplerParams = Array.from({ length: 8 }, (_, i) => ({
    ...DEFAULT_SAMPLER_BANK_PARAMS,
    sampleName: `bank_${i}`
}));

export const UPDATED_INITIAL_PATTERN: Pattern = {
    ...INITIAL_PATTERN,
    sampler: Array.from({ length: 8 }, () => ({ steps: Array(NUM_STEPS).fill(null) }))
};

// --- TYPES FOR STORAGE ---
export type TrackKey = 'partA' | 'partB' | 'bass2' | 'kick' | 'snare' | 'closedHat' | 'openHat' | 'sampler';
export type SongSnapshot = {
    pattern: Pattern;
    tempo: number;
    currentScale?: ScaleDefinition | null;
    ambianceUrl: string;
    backgroundImage: string;
    params: {
        synthA: SynthParams;
        synthB: SynthParams;
        bass2: Bass2Params;
        kick: KickParams;
        snare: SnareParams;
        closedHat: any;
        openHat: any;
        sampler: SamplerParams;
    }
};

export const getInitialTrackStorage = (initialPattern: Pattern): Record<TrackKey, (PartSequence | PartSequence[] | null)[]> => {
    const storage: any = {
        partA: Array(8).fill(null),
        partB: Array(8).fill(null),
        bass2: Array(8).fill(null),
        kick: Array(8).fill(null),
        snare: Array(8).fill(null),
        closedHat: Array(8).fill(null),
        openHat: Array(8).fill(null),
        sampler: Array(8).fill(null),
    };

    (Object.keys(storage) as TrackKey[]).forEach(key => {
        storage[key][0] = JSON.parse(JSON.stringify(initialPattern[key]));
    });

    return storage;
};

export const COLOR_LEAD = [0.0, 0.9, 1.0] as [number, number, number];
export const COLOR_BASS = [1.0, 0.2, 0.8] as [number, number, number];
export const COLOR_BASS2 = [1.0, 0.0, 0.4] as [number, number, number];
export const COLOR_KICK = [1.0, 0.6, 0.0] as [number, number, number];
export const COLOR_SNARE = [0.2, 1.0, 0.2] as [number, number, number];
export const COLOR_CH = [0.8, 0.8, 0.0] as [number, number, number];
export const COLOR_OH = [0.9, 0.5, 0.0] as [number, number, number];
export const COLOR_SAMPLER = [0.6, 0.4, 1.0] as [number, number, number];

export const EMPTY_STEPS = Array(32).fill(null);
export const EMPTY_SEQ = { steps: EMPTY_STEPS };
export const EMPTY_SAMPLER_SEQUENCE = Array.from({ length: 8 }, () => ({ steps: EMPTY_STEPS }));
export const EMPTY_PATTERN: Pattern = {
    partA: EMPTY_SEQ,
    partB: EMPTY_SEQ,
    bass2: EMPTY_SEQ,
    kick: EMPTY_SEQ,
    snare: EMPTY_SEQ,
    closedHat: EMPTY_SEQ,
    openHat: EMPTY_SEQ,
    sampler: EMPTY_SAMPLER_SEQUENCE,
};
