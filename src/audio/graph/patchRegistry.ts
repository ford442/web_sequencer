/**
 * Process-wide handle on the active PatchController.
 *
 * Same shape as the master-loudness registry: the engine publishes the
 * controller during initialisation, and the patch bay UI subscribes. The UI
 * never reaches into the audio graph itself — it only talks to the controller.
 */

import type { PatchController } from './patchController';

type ControllerListener = (controller: PatchController | null) => void;

let current: PatchController | null = null;
const listeners = new Set<ControllerListener>();

/** Publish (or clear) the active controller. Called by the engine lifecycle. */
export function setActivePatchController(controller: PatchController | null): void {
    current = controller;
    for (const listener of listeners) listener(controller);
}

/** The active controller, or `null` when the engine is not running. */
export function getActivePatchController(): PatchController | null {
    return current;
}

/** Subscribe to controller availability. Fires immediately with the current value. */
export function subscribeActivePatchController(listener: ControllerListener): () => void {
    listeners.add(listener);
    listener(current);
    return () => {
        listeners.delete(listener);
    };
}
