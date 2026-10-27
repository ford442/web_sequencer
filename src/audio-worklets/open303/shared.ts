// src/audio-worklets/open303/shared.ts
// Small pieces shared across the open303-processor.ts split.

import { nowMs } from '../../shared/rt/time';

/** DSP engine families this processor can route a block to. */
export type EngineFamily = 'open303' | 'jc303' | 'highfid';

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
