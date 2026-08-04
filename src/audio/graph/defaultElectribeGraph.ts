import type { AudioGraphConfig } from './types';

/**
 * Classic Electribe master routing topology.
 *
 * Two intentional entry points:
 * - masterFxInput (saturation): synths, sampler, Open303, reverb/delay returns
 * - masterDryInput (master gain): drums, ambiance, sustain, choir — bypasses FX chain
 */
export const CLASSIC_ELECTRIBE_GRAPH: AudioGraphConfig = {
    id: 'classic-electribe',
    name: 'Classic Electribe',
    nodes: [
        // --- Master FX chain (series) ---
        {
            id: 'masterSaturation',
            factory: 'waveShaper',
            role: 'masterFxInput',
            config: { drive: 0, oversample: '4x' },
        },
        {
            id: 'bassSidechainEQ',
            factory: 'biquadFilter',
            config: { type: 'peaking', frequency: 250, Q: 1.0, gain: 0 },
        },
        {
            id: 'sidechainGain',
            factory: 'biquadFilter',
            config: { type: 'lowshelf', frequency: 250, gain: 0 },
        },
        {
            id: 'masterCompressor',
            factory: 'dynamicsCompressor',
            config: { threshold: -15, knee: 30, ratio: 4, attack: 0.03, release: 0.25 },
        },
        {
            id: 'masterGain',
            factory: 'gain',
            role: 'masterDryInput',
            config: { gain: 0.8 },
        },
        {
            id: 'masterPanner',
            factory: 'stereoPanner',
            role: 'masterOutput',
            config: { pan: 0 },
        },
        {
            // True-peak limiter + BS.1770 meter. Last insert before the
            // destination so it protects (and measures) everything upstream,
            // including the choir buses that bypass the master FX chain.
            // Compiled only when the host supplies a worklet node — otherwise
            // the chain bridges straight to `destination`.
            id: 'masterLimiter',
            factory: 'masterLimiter',
            role: 'masterLimiter',
        },
        { id: 'destination', factory: 'destination' },
        {
            id: 'masterAnalyser',
            factory: 'analyser',
            config: { fftSize: 1024, smoothingTimeConstant: 0.6 },
        },

        // --- Per-track monitor buses ---
        {
            id: 'synthABus',
            factory: 'trackMonitor',
            role: 'trackBus',
            config: { busGain: 1, analyserFftSize: 256, analyserSmoothing: 0.55 },
        },
        {
            id: 'synthBBus',
            factory: 'trackMonitor',
            role: 'trackBus',
            config: { busGain: 1, analyserFftSize: 256, analyserSmoothing: 0.55 },
        },
        {
            id: 'samplerBus',
            factory: 'trackMonitor',
            role: 'trackBus',
            config: { busGain: 1, analyserFftSize: 256, analyserSmoothing: 0.55 },
        },

        // --- Parallel aux returns ---
        {
            id: 'reverbRoom',
            factory: 'convolver',
            role: 'auxReturn',
            config: { reverbPreset: 'room' },
        },
        {
            id: 'reverbPlate',
            factory: 'convolver',
            role: 'auxReturn',
            config: { reverbPreset: 'plate' },
        },
        {
            id: 'reverbHall',
            factory: 'convolver',
            role: 'auxReturn',
            config: { reverbPreset: 'hall' },
        },
        {
            id: 'delay',
            factory: 'delay',
            config: { maxDelayTime: 2.0, delayTime: 0.375 },
        },
        { id: 'delayFeedback', factory: 'gain', config: { gain: 0.4 } },

        // --- Choir widening (bypass master FX) ---
        {
            id: 'choirLeftGain',
            factory: 'gain',
            role: 'choirBus',
            config: { gain: 0 },
        },
        {
            id: 'choirLeftPanner',
            factory: 'stereoPanner',
            config: { pan: -0.6 },
        },
        {
            id: 'choirRightGain',
            factory: 'gain',
            role: 'choirBus',
            config: { gain: 0 },
        },
        {
            id: 'choirRightPanner',
            factory: 'stereoPanner',
            config: { pan: 0.6 },
        },
    ],
    edges: [
        // Master FX chain (in-series)
        { from: 'masterSaturation', to: 'bassSidechainEQ' },
        { from: 'bassSidechainEQ', to: 'sidechainGain' },
        { from: 'sidechainGain', to: 'masterCompressor' },
        { from: 'masterCompressor', to: 'masterGain' },
        { from: 'masterGain', to: 'masterPanner' },
        { from: 'masterPanner', to: 'masterLimiter' },
        { from: 'masterLimiter', to: 'destination' },

        // Passive master analyser tap (read-only)
        { from: 'masterGain', to: 'masterAnalyser' },

        // Track buses → master FX input
        { from: 'synthABus', to: 'masterSaturation' },
        { from: 'synthBBus', to: 'masterSaturation' },
        { from: 'samplerBus', to: 'masterSaturation' },

        // Reverb returns → master FX input
        { from: 'reverbRoom', to: 'masterSaturation' },
        { from: 'reverbPlate', to: 'masterSaturation' },
        { from: 'reverbHall', to: 'masterSaturation' },

        // Global delay with feedback loop
        { from: 'delay', to: 'delayFeedback' },
        { from: 'delayFeedback', to: 'delay' },
        { from: 'delay', to: 'masterSaturation' },

        // Choir buses → master dry input (post-compressor)
        { from: 'choirLeftGain', to: 'choirLeftPanner' },
        { from: 'choirLeftPanner', to: 'masterGain' },
        { from: 'choirRightGain', to: 'choirRightPanner' },
        { from: 'choirRightPanner', to: 'masterGain' },
    ],
};

/** Ordered master-chain node ids when the limiter stage is compiled in. */
export const MASTER_CHAIN_ORDER_WITH_LIMITER: readonly string[] = [
    'masterSaturation',
    'bassSidechainEQ',
    'sidechainGain',
    'masterCompressor',
    'masterGain',
    'masterPanner',
    'masterLimiter',
    'destination',
];

/** Ordered master-chain node ids for test assertions. */
export const MASTER_CHAIN_ORDER: readonly string[] = [
    'masterSaturation',
    'bassSidechainEQ',
    'sidechainGain',
    'masterCompressor',
    'masterGain',
    'masterPanner',
    'destination',
];

/** Expected compile-time connection order for the in-series master chain. */
export const MASTER_CHAIN_CONNECTIONS: readonly [string, string][] = [
    ['masterSaturation', 'bassSidechainEQ'],
    ['bassSidechainEQ', 'sidechainGain'],
    ['sidechainGain', 'masterCompressor'],
    ['masterCompressor', 'masterGain'],
    ['masterGain', 'masterPanner'],
    ['masterPanner', 'destination'],
];
