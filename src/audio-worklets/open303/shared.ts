// src/audio-worklets/open303/shared.ts
// Small pieces shared across the open303-processor.ts split.

import { nowMs } from '../../shared/rt/time';

/**
 * Open303Param id of each setter Open303Oscillator.setParam names. Every 303
 * engine (open303, jc303, high-fid) shares these ids, so a PARAM_SET record
 * (#1497) carries one as its target; the worklet's legacy `param` message
 * names the setter as `jc303_<setter>`.
 */
export const OPEN303_PARAM_IDS: Readonly<Record<string, number>> = {
    setWaveform: 0,   // OPEN303_WAVEFORM
    setTuning: 1,     // OPEN303_TUNING
    setCutoff: 2,     // OPEN303_CUTOFF
    setResonance: 3,  // OPEN303_RESONANCE
    setEnvMod: 4,     // OPEN303_ENV_MOD
    setDecay: 5,      // OPEN303_DECAY
    setAccent: 6,     // OPEN303_ACCENT
    setVolume: 7,     // OPEN303_VOLUME
    setFilterMode: 8, // OPEN303_FILTER_MODE
};

/** DSP engine families this processor can route a block to. */
export type EngineFamily = 'open303' | 'jc303' | 'highfid';

/**
 * Families the main thread may *request* in `set-303-model`. `openrb338`
 * (optional GPL module, #1537) is not a render target yet: the worklet maps
 * it to stock open303 until the module is bundled.
 */
export type RequestedEngineFamily = EngineFamily | 'openrb338';

// Synth state (using const object instead of enum for erasableSyntaxOnly compatibility)
export const SynthState = {
    UNINITIALIZED: 'uninitialized',
    INITIALIZING: 'initializing',
    READY: 'ready',
    FAILED: 'failed',
    FALLBACK: 'fallback'
} as const;

export type SynthStateType = typeof SynthState[keyof typeof SynthState];

/** performance.now() where the scope has it, else Date.now() (see shared/rt/time). */
export const getTime = nowMs;
