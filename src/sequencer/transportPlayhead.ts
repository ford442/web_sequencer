/**
 * Pattern playhead, published by the worklet step handler at each step's own
 * audio time (#1345). Views that draw a playhead outside the sequencer grid —
 * the piano roll — read it from their animation frame, so the transport never
 * re-renders React.
 *
 * Each track's step is published, not just the clock step: tracks with their
 * own loop length (polyrhythm) and the linear arrangement player read a
 * different step of their pattern than the master clock says.
 */
import type { TrackKey } from '@/types';

export interface PlayheadSnapshot {
    /** Clock step last played, or -1 while stopped. */
    step: number;
    /** Step each track read on that tick (-1 = resting / no clip). */
    trackSteps: Record<TrackKey, number>;
    /** `performance.now()` when the step sounded. */
    at: number;
    /** Length of one step in seconds at the current tempo. */
    stepSeconds: number;
    /** Bumped on every publish, so a frame loop can skip unchanged snapshots. */
    version: number;
}

type Listener = (snapshot: PlayheadSnapshot) => void;

const STOPPED_STEPS: Record<TrackKey, number> = {
    partA: -1, partB: -1, bass2: -1, kick: -1, snare: -1, closedHat: -1, openHat: -1, sampler: -1,
};

const state: PlayheadSnapshot = {
    step: -1,
    trackSteps: { ...STOPPED_STEPS },
    at: 0,
    stepSeconds: 0.125,
    version: 0,
};
const listeners = new Set<Listener>();

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export const transportPlayhead = {
    get(): PlayheadSnapshot {
        return state;
    },
    /**
     * Called from the step handler, inside the step's `atStepTime` callback.
     * `trackSteps` is captured when the step is computed (the arrangement
     * frame it comes from is reused on the next tick).
     */
    publish(step: number, trackSteps: Readonly<Record<TrackKey, number>>, stepSeconds: number): void {
        state.step = step;
        Object.assign(state.trackSteps, trackSteps);
        state.at = now();
        state.stepSeconds = stepSeconds > 0 ? stepSeconds : state.stepSeconds;
        state.version += 1;
        listeners.forEach((fn) => fn(state));
    },
    stop(): void {
        if (state.step === -1) return;
        state.step = -1;
        Object.assign(state.trackSteps, STOPPED_STEPS);
        state.version += 1;
        listeners.forEach((fn) => fn(state));
    },
    subscribe(fn: Listener): () => void {
        listeners.add(fn);
        return () => {
            listeners.delete(fn);
        };
    },
};

/**
 * Where `track`'s playhead is right now, in (fractional) steps of its own
 * pattern, or null while stopped / resting. Interpolates across the step so
 * a playhead drawn every frame moves smoothly instead of jumping per step.
 */
export function playheadPosition(snapshot: PlayheadSnapshot, track: TrackKey, at: number = now()): number | null {
    const step = snapshot.trackSteps[track];
    if (snapshot.step < 0 || step < 0) return null;
    const frac = (at - snapshot.at) / (snapshot.stepSeconds * 1000);
    return step + Math.min(0.999, Math.max(0, frac));
}
