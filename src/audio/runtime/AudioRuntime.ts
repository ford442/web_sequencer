/**
 * AudioRuntime — the one owner of the live AudioContext.
 *
 * Every engine, effect and panel asks this object for "a running context"
 * instead of constructing or resuming its own:
 *
 *  - {@link AudioRuntime.createLiveContext} builds the context through
 *    `createAudioContext` (synchronous: callers construct inside a user
 *    gesture and must not await before `ensureRunning`) and keeps the
 *    `AudioContextCreation` record the HUD reads.
 *  - {@link AudioRuntime.ensureRunning} is the ONLY `resume()` call in `src/`
 *    on a live context. It records that a gesture happened, shares one promise
 *    between concurrent callers, and never throws (logs + degradation report).
 *  - `subscribe` / `getSnapshot` expose `{ state, gestureSeen, lastResumeError }`
 *    for `useSyncExternalStore` (the suspended-state banner's one source).
 *
 * Worklet modules load through `loadWorkletModule` (./workletRegistry).
 * See docs/audio-engine/audio-runtime.md.
 */

import {
    createAudioContext,
    type AudioContextCreateExtras,
    type AudioContextCreation,
} from '../../hooks/audioEngine/audioContextFactory';
import { engineDegradationStore } from '../../stores/engineDegradationStore';
import type { LatencyMode } from '../../utils/audioLatencyMode';
import type { SampleRatePref } from '../../utils/audioContextPolicy';

export type AudioGesture = 'click' | 'key' | 'touch' | 'programmatic';

export interface AudioRuntimeSnapshot {
    /** State of the live context; 'closed' before one exists. */
    state: AudioContextState;
    /** A user gesture ('click' | 'key' | 'touch') has asked for audio. */
    gestureSeen: boolean;
    lastResumeError: string | null;
}

const RESUME_ISSUE_ID = 'audio-context-resume';

export class AudioRuntime {
    private creation: AudioContextCreation | null = null;
    private snapshot: AudioRuntimeSnapshot = { state: 'closed', gestureSeen: false, lastResumeError: null };
    private readonly listeners = new Set<() => void>();
    private readonly inflight = new WeakMap<BaseAudioContext, Promise<void>>();
    private readonly resumeReported = new WeakSet<BaseAudioContext>();
    private detachState: (() => void) | null = null;

    /** The live context, or null before the engine has created one. */
    get context(): AudioContext | null {
        const ctx = this.creation?.context ?? null;
        return ctx && ctx.state !== 'closed' ? ctx : null;
    }

    /** The factory record for the live context (sampleRate / latency / fallbacks). */
    get contextCreation(): AudioContextCreation | null {
        return this.creation;
    }

    /**
     * Construct the live context (synchronously) and make it the one every
     * caller gets. The previous context is not closed here: its engine owns
     * that teardown.
     */
    createLiveContext(
        latencyHint?: LatencyMode,
        sampleRatePref?: SampleRatePref,
        extras?: AudioContextCreateExtras,
    ): AudioContextCreation {
        const created = createAudioContext(latencyHint, sampleRatePref, extras);
        this.adopt(created);
        return created;
    }

    /** Make an already-built creation record the live one (HUD re-init hands one over). */
    adopt(created: AudioContextCreation): void {
        if (this.creation === created) return;
        this.detachState?.();
        this.creation = created;
        const ctx = created.context;
        const onState = () => this.update({ state: ctx.state });
        if (typeof ctx.addEventListener === 'function') {
            ctx.addEventListener('statechange', onState);
            this.detachState = () => ctx.removeEventListener('statechange', onState);
        } else {
            this.detachState = null;
        }
        this.update({ state: ctx.state });
    }

    /**
     * Resume the live context (or `context`, when a caller holds one the
     * runtime did not create — tests, a capture tap). Call it synchronously
     * from the gesture handler: `resume()` is issued before the first await.
     * Concurrent calls share one promise. Never rejects.
     */
    ensureRunning(gesture: AudioGesture, context?: BaseAudioContext): Promise<void> {
        if (gesture !== 'programmatic' && !this.snapshot.gestureSeen) this.update({ gestureSeen: true });
        const ctx = context ?? this.context;
        if (!ctx || ctx.state !== 'suspended') return Promise.resolve();
        const pending = this.inflight.get(ctx);
        if (pending) return pending;

        let resumed: Promise<void>;
        try {
            resumed = (ctx as AudioContext).resume();
        } catch (err) {
            resumed = Promise.reject(err instanceof Error ? err : new Error(String(err)));
        }
        const done = Promise.resolve(resumed)
            .then(() => {
                if (this.isLive(ctx)) this.update({ state: ctx.state, lastResumeError: null });
            })
            .catch((err: unknown) => this.onResumeFailed(ctx, gesture, err))
            .finally(() => {
                if (this.inflight.get(ctx) === done) this.inflight.delete(ctx);
            });
        this.inflight.set(ctx, done);
        return done;
    }

    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };

    getSnapshot = (): AudioRuntimeSnapshot => this.snapshot;

    private isLive(ctx: BaseAudioContext): boolean {
        return this.creation?.context === ctx;
    }

    private onResumeFailed(ctx: BaseAudioContext, gesture: AudioGesture, err: unknown): void {
        const reason = err instanceof Error ? err.message : String(err);
        console.warn(`[audioRuntime] resume() failed (${gesture})`, err);
        if (this.isLive(ctx)) this.update({ state: ctx.state, lastResumeError: reason });
        if (this.resumeReported.has(ctx)) return;
        this.resumeReported.add(ctx);
        try {
            engineDegradationStore.report({
                id: RESUME_ISSUE_ID,
                subsystem: 'AudioContext',
                category: 'audio',
                message: 'Audio is suspended: click or press a key to start it',
                reason,
                status: 'active',
                activeBackend: 'suspended',
                requestedBackend: 'running',
                retryable: false,
            });
        } catch (reportErr) {
            console.warn('[audioRuntime] degradation report failed', reportErr);
        }
    }

    private update(patch: Partial<AudioRuntimeSnapshot>): void {
        const next = { ...this.snapshot, ...patch };
        if (
            next.state === this.snapshot.state
            && next.gestureSeen === this.snapshot.gestureSeen
            && next.lastResumeError === this.snapshot.lastResumeError
        ) return;
        this.snapshot = next;
        for (const listener of this.listeners) listener();
    }
}

/** The app's one runtime. */
export const audioRuntime = new AudioRuntime();

/** Shorthand for `audioRuntime.ensureRunning`. */
export function ensureRunning(gesture: AudioGesture, context?: BaseAudioContext): Promise<void> {
    return audioRuntime.ensureRunning(gesture, context);
}
