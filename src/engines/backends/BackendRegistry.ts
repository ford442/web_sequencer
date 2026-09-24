/**
 * Ordered oscillator backend selection (#1034, collapsed in #1294).
 *
 * One place decides which backend is active, in one documented order:
 *   WebGPU → WASM OSC (AssemblyScript) → Pyodide → WAV PCM → pure JS
 *
 * This is now the *only* fallback order in the codebase. The realtime note
 * path enters the chain at the backend `engineCatalog` names for the selected
 * waveform family (`renderLoopFrom`) instead of running its own per-prefix
 * ladder, so "which engine am I hearing?" has exactly one answer.
 *
 * Every step down that chain is recorded: telemetry resolution, the engine
 * degradation store (drives the banner) and the EngineHUD all read from the
 * same `BackendResolution`. There is no silent fallback path.
 */

import {
    BACKEND_FALLBACK_ORDER,
    BACKEND_LABELS,
    type GenerateRequest,
    type LoopRender,
    type OscillatorBackend,
    type OscillatorBackendId,
} from './OscillatorBackend';
import type { WaveShape } from '../../utils/waveformParser';
import { engineTelemetry, logWaveformSubstitution } from '../../utils/engineTelemetry';
import { engineDegradationStore } from '../../stores/engineDegradationStore';
import { PyodideBackend } from './adapters';
import type { PyodideLike } from '../../utils/pyodideBuffers';

export const OSCILLATOR_SUBSYSTEM = 'oscillators';

export interface BackendAttempt {
    id: OscillatorBackendId;
    supported: boolean;
    ready: boolean;
    /** Why this backend was skipped (undefined when it was selected). */
    reason?: string;
}

export interface BackendResolution {
    /** Backend actually selected. Never null — `js` is the terminal fallback. */
    active: OscillatorBackendId;
    /** Highest-preference backend in the registry, i.e. what we wanted. */
    requested: OscillatorBackendId;
    /** True when `active` is not `requested`. */
    degraded: boolean;
    /** Ordered record of what was tried and why it was skipped. */
    attempts: BackendAttempt[];
    /** Combined reason string for the HUD / banner (undefined when not degraded). */
    reason?: string;
    ts: number;
}

export class BackendRegistry {
    private backends = new Map<OscillatorBackendId, OscillatorBackend>();
    private lastResolution: BackendResolution | null = null;

    register(backend: OscillatorBackend): void {
        this.backends.set(backend.id, backend);
    }

    get(id: OscillatorBackendId): OscillatorBackend | undefined {
        return this.backends.get(id);
    }

    /** Registered backends in fallback-preference order. */
    ordered(): OscillatorBackend[] {
        return this.orderedFrom(BACKEND_FALLBACK_ORDER[0]);
    }

    /**
     * Registered backends from `startId` down the single fallback order.
     *
     * This is how the realtime note path asks for a *family* (wam, wgsl,
     * pyodide, wav) without re-implementing the chain: selecting `wav-saw`
     * enters at `wav` and can only ever drop to `js`, never climb back up to
     * WebGPU behind the user's back. An unknown/unregistered `startId` yields
     * the terminal `js` step only.
     */
    orderedFrom(startId: OscillatorBackendId): OscillatorBackend[] {
        const from = BACKEND_FALLBACK_ORDER.indexOf(startId);
        const slice = from >= 0 ? BACKEND_FALLBACK_ORDER.slice(from) : ['js' as const];
        const out: OscillatorBackend[] = [];
        for (const id of slice) {
            const b = this.backends.get(id);
            if (b) out.push(b);
        }
        return out;
    }

    /** Initialize every registered backend, preference order, failures tolerated. */
    async initAll(ctx: AudioContext): Promise<void> {
        for (const backend of this.ordered()) {
            try {
                const result = await backend.init(ctx);
                if (!result.ok) {
                    console.warn(
                        `[BackendRegistry] ${backend.id} unavailable: ${result.reason ?? 'unknown'}`,
                    );
                }
            } catch (e) {
                console.warn(`[BackendRegistry] ${backend.id} init threw`, e);
                try {
                    engineTelemetry.recordError(OSCILLATOR_SUBSYSTEM, e);
                } catch {
                    /* telemetry must never break audio init */
                }
            }
        }
    }

    /**
     * Walk the preference chain and pick the first supported+ready backend.
     * When `shape` is given, backends that would have to change wave family to
     * service it are skipped (and the skip is logged) rather than substituting.
     */
    resolve(shape?: WaveShape): BackendResolution {
        const ordered = this.ordered();
        const attempts: BackendAttempt[] = [];
        const requested = ordered[0]?.id ?? 'js';

        let active: OscillatorBackendId | null = null;

        for (const backend of ordered) {
            const supported = backend.isSupported;
            const ready = backend.isReady;

            if (!supported || !ready) {
                attempts.push({
                    id: backend.id,
                    supported,
                    ready,
                    reason: !supported ? 'unsupported in this environment' : 'not initialized',
                });
                continue;
            }
            if (shape && !backend.supportsShape(shape)) {
                attempts.push({
                    id: backend.id,
                    supported,
                    ready,
                    reason: `does not render "${shape}" natively`,
                });
                continue;
            }
            attempts.push({ id: backend.id, supported, ready });
            active = backend.id;
            break;
        }

        // `js` is always registered in practice; guard so resolve() is total.
        const resolvedActive = active ?? 'js';
        const degraded = resolvedActive !== requested;
        const reason = degraded
            ? attempts
                  .filter((a) => a.reason)
                  .map((a) => `${a.id}: ${a.reason}`)
                  .join('; ')
            : undefined;

        const resolution: BackendResolution = {
            active: resolvedActive,
            requested,
            degraded,
            attempts,
            reason,
            ts: Date.now(),
        };
        this.lastResolution = resolution;
        return resolution;
    }

    getLastResolution(): BackendResolution | null {
        return this.lastResolution;
    }

    /**
     * Resolve, then publish the outcome to telemetry + the degradation store.
     * Call this once per selection so a fallback is always user-visible.
     */
    resolveAndPublish(shape?: WaveShape): BackendResolution {
        const resolution = this.resolve(shape);
        publishResolution(resolution);
        return resolution;
    }

    /**
     * Render through the chain: try each usable backend in order, dropping to
     * the next on null/throw. Every drop is logged. Returns the buffer plus the
     * backend that produced it.
     */
    async generate(
        req: GenerateRequest,
    ): Promise<{ samples: Float32Array; backendId: OscillatorBackendId } | null> {
        const ordered = this.ordered();
        const requested = ordered[0]?.id ?? 'js';
        const skipped: string[] = [];

        for (const backend of ordered) {
            if (!backend.isSupported || !backend.isReady) {
                skipped.push(`${backend.id}: ${backend.isSupported ? 'not initialized' : 'unsupported'}`);
                continue;
            }
            if (!backend.supportsShape(req.shape)) {
                skipped.push(`${backend.id}: cannot render "${req.shape}"`);
                continue;
            }
            try {
                const samples = await backend.generate(req);
                if (samples && samples.length > 0) {
                    if (backend.id !== requested) {
                        publishResolution({
                            active: backend.id,
                            requested,
                            degraded: true,
                            attempts: [],
                            reason: skipped.join('; ') || 'higher-preference backend returned no samples',
                            ts: Date.now(),
                        });
                    }
                    return { samples, backendId: backend.id };
                }
                skipped.push(`${backend.id}: returned no samples`);
            } catch (e) {
                skipped.push(`${backend.id}: threw (${e instanceof Error ? e.message : String(e)})`);
                try {
                    engineTelemetry.recordError(OSCILLATOR_SUBSYSTEM, e);
                } catch {
                    /* best-effort */
                }
            }
        }

        console.error(
            `[BackendRegistry] no oscillator backend could render "${req.shape}": ${skipped.join('; ')}`,
        );
        return null;
    }

    /**
     * Synchronous realtime render, entering the chain at `startId`.
     *
     * Returns the first loopable table the chain produces, or null when it ran
     * out (the caller's terminal step is an `OscillatorNode` of the right wave
     * family). Every step down is published, so the HUD/telemetry always name
     * the engine that actually sounded — there is no silent fall-through.
     */
    renderLoopFrom(
        startId: OscillatorBackendId,
        ctx: BaseAudioContext,
        req: GenerateRequest,
    ): LoopRender | null {
        const chain = this.orderedFrom(startId);
        const skipped: string[] = [];

        for (const backend of chain) {
            if (!backend.isSupported || !backend.isReady) {
                skipped.push(`${backend.id}: ${backend.isSupported ? 'not initialized' : 'unsupported'}`);
                continue;
            }
            if (!backend.supportsShape(req.shape)) {
                skipped.push(`${backend.id}: cannot render "${req.shape}"`);
                continue;
            }
            if (!backend.renderLoop) {
                // `js` has no table — it is the terminal OscillatorNode step.
                skipped.push(`${backend.id}: no realtime table (terminal backend)`);
                continue;
            }
            let render: LoopRender | null = null;
            try {
                render = backend.renderLoop(ctx, req);
            } catch (e) {
                skipped.push(`${backend.id}: threw (${e instanceof Error ? e.message : String(e)})`);
                try {
                    engineTelemetry.recordError(OSCILLATOR_SUBSYSTEM, e);
                } catch {
                    /* best-effort */
                }
                continue;
            }
            if (!render) {
                skipped.push(`${backend.id}: returned no table`);
                continue;
            }
            if (backend.id !== startId) {
                publishResolution({
                    active: backend.id,
                    requested: startId,
                    degraded: true,
                    attempts: [],
                    reason: skipped.join('; ') || 'preferred backend produced no table',
                    ts: Date.now(),
                });
            }
            return render;
        }

        // Falling all the way through is the documented `js` outcome, not a bug
        // — but it still has to be visible.
        publishResolution({
            active: 'js',
            requested: startId,
            degraded: startId !== 'js',
            attempts: [],
            reason: skipped.join('; ') || undefined,
            ts: Date.now(),
        });
        return null;
    }

    disposeAll(): void {
        for (const backend of this.backends.values()) {
            try {
                backend.dispose();
            } catch {
                /* disposal must not throw during teardown */
            }
        }
        this.backends.clear();
        this.lastResolution = null;
    }
}

/**
 * Process-wide handle on the registry the audio engine built, so diagnostic
 * surfaces (EngineHUD, degradation banner) can read the live chain without
 * threading a ref through the React tree.
 */
let activeRegistry: BackendRegistry | null = null;

export function setOscillatorRegistry(registry: BackendRegistry | null): void {
    activeRegistry = registry;
}

export function getOscillatorRegistry(): BackendRegistry | null {
    return activeRegistry;
}

/**
 * Late-bind the Pyodide runtime to its backend.
 *
 * Pyodide loads long after audio init (and may never load at all), so the
 * `pyodide` backend starts unsupported and becomes ready here. Keeping this in
 * the registry rather than on `Voice` is what stops `pyodide-*` from being a
 * second selection story — and it does not put Pyodide on the entry graph
 * (#1257): nothing here imports it, the caller hands over a runtime it already
 * has.
 */
export function attachPyodideOscillator(engine: PyodideLike | null): void {
    const backend = activeRegistry?.get('pyodide');
    if (backend instanceof PyodideBackend) {
        backend.setEngine(engine);
    }
}

/**
 * Publish a resolution to telemetry + degradation store. Split out so tests can
 * exercise it directly, and so `generate()` and `resolve()` report identically.
 */
export function publishResolution(resolution: BackendResolution): void {
    try {
        engineTelemetry.registerResolution(
            OSCILLATOR_SUBSYSTEM,
            resolution.active,
            resolution.reason ?? 'init-decision',
        );

        if (resolution.degraded) {
            engineTelemetry.recordDegradation(
                OSCILLATOR_SUBSYSTEM,
                true,
                resolution.reason ?? 'backend fallback',
            );
            console.warn(
                `[BackendRegistry] oscillator backend fell back ` +
                    `${BACKEND_LABELS[resolution.requested]} → ${BACKEND_LABELS[resolution.active]} ` +
                    `(${resolution.reason ?? 'unknown'})`,
            );
            engineDegradationStore.report({
                id: 'oscillator-backend',
                subsystem: OSCILLATOR_SUBSYSTEM,
                category: resolution.requested === 'webgpu' ? 'gpu' : 'wasm',
                message: `Oscillators running on ${BACKEND_LABELS[resolution.active]} instead of ${BACKEND_LABELS[resolution.requested]}`,
                reason: resolution.reason ?? 'backend unavailable',
                status: 'active',
                activeBackend: resolution.active,
                requestedBackend: resolution.requested,
                retryable: false,
            });
        } else {
            engineDegradationStore.resolve('oscillator-backend');
        }
    } catch (e) {
        console.warn('[BackendRegistry] failed to publish backend resolution', e);
    }
}

/**
 * Report a wave-family substitution made outside the registry (a caller that
 * already holds a concrete engine). Kept here so every substitution in the
 * codebase routes through the same telemetry + HUD path.
 */
export function reportShapeSubstitution(
    backendId: OscillatorBackendId,
    requestedShape: WaveShape,
    substitutedShape: WaveShape,
    reason: string,
): void {
    logWaveformSubstitution(OSCILLATOR_SUBSYSTEM, backendId, requestedShape, substitutedShape, reason);
}
