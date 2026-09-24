// HUD "Apply (re-init engine)" bridge. The HUD is a side-effecting DOM module
// with no React tree, so the live engine hook registers its re-init routine
// here and the HUD calls `reinitAudioEngineFromGesture` from a click handler.

import { createAudioContext, type AudioContextCreation } from './audioContextFactory';

export type AudioEngineReinitHandler = (created: AudioContextCreation) => Promise<void>;

let handler: AudioEngineReinitHandler | null = null;

/** Register the running engine's re-init routine. Returns an unregister fn. */
export function setAudioEngineReinitHandler(next: AudioEngineReinitHandler): () => void {
    handler = next;
    return () => {
        if (handler === next) handler = null;
    };
}

/** True once an engine is running and can be rebuilt in place. */
export function canReinitAudioEngine(): boolean {
    return handler !== null;
}

/**
 * Rebuild the audio engine with the stored sample-rate / latency /
 * render-size / output-device prefs, without a page reload.
 *
 * MUST be called synchronously from a user-gesture handler. The new
 * AudioContext is constructed and `resume()`d in the gesture's own call
 * stack — before any await, dynamic import or chunk fetch — the same rule as
 * StartOverlay, so audio still starts on a throttled network. Only after
 * that does the old engine get torn down and the new one populated.
 */
export function reinitAudioEngineFromGesture(): Promise<boolean> {
    const run = handler;
    if (!run) return Promise.resolve(false);

    let created: AudioContextCreation;
    try {
        created = createAudioContext();
    } catch (e) {
        return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
    const resumed = created.context.state === 'suspended'
        ? created.context.resume()
        : Promise.resolve();

    return resumed
        .catch((e: unknown) => {
            console.warn('[audioEngineReinit] resume() rejected; continuing', e);
        })
        .then(() => run(created))
        .then(() => true);
}
