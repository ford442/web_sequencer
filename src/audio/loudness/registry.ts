/**
 * Process-wide handle on the active master loudness stage.
 *
 * The stage is created during audio-engine initialisation, long before the
 * meter UI mounts, and the UI must not reach into the audio graph itself. This
 * tiny registry is the one place that connects them: the engine publishes the
 * stage, components subscribe and receive it (immediately if it already exists).
 */

import type { MasterLoudnessStage } from './masterLoudnessStage';

type StageListener = (stage: MasterLoudnessStage | null) => void;

let currentStage: MasterLoudnessStage | null = null;
const listeners = new Set<StageListener>();

/** Publish (or clear) the active stage. Called by the engine lifecycle. */
export function setMasterLoudnessStage(stage: MasterLoudnessStage | null): void {
    currentStage = stage;
    for (const listener of listeners) listener(stage);
}

/** The active stage, or `null` when the engine is not running. */
export function getMasterLoudnessStage(): MasterLoudnessStage | null {
    return currentStage;
}

/** Subscribe to stage availability. Fires immediately with the current value. */
export function subscribeMasterLoudnessStage(listener: StageListener): () => void {
    listeners.add(listener);
    listener(currentStage);
    return () => {
        listeners.delete(listener);
    };
}
