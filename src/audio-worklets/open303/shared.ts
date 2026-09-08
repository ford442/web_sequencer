// src/audio-worklets/open303/shared.ts
// Small pieces shared across the open303-processor.ts split.

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

/** Safe performance.now() wrapper for contexts where performance is not defined. */
export function getTime(): number {
    if (typeof performance !== 'undefined' && performance.now) {
        return performance.now();
    }
    return Date.now();
}
