/**
 * AudioWorklet module registry: one `addModule` per (context, url).
 *
 * A second engine instance, a patch-bay node placed twice, or an engine
 * re-init used to re-fetch and re-evaluate the module (and Firefox throws on a
 * second `registerProcessor` of the same name). Every caller now asks here;
 * the first call loads, later calls share its promise.
 *
 *  - same (context, url)     → same promise, `addModule` runs once
 *  - rejected load           → dropped from the map, so the next call re-fetches
 *  - context `close()`d      → its map is dropped (statechange, or state on entry)
 *  - works for OfflineAudioContext too (offline renders and tests share it)
 *
 * A failure rejects with {@link WorkletLoadError} and is reported to
 * engineDegradationStore once per (context, url). Callers keep their own
 * fallbacks and stop wording their own reports.
 */

import { engineDegradationStore } from '../../stores/engineDegradationStore';

export class WorkletLoadError extends Error {
    readonly url: string;
    readonly processorName: string;
    readonly cause: unknown;

    constructor(url: string, processorName: string, cause: unknown) {
        // The message stays the cause's, so callers that surface `err.message`
        // (masterPcf / pcfInsert reasons) read exactly what they did before.
        super(cause instanceof Error ? cause.message : String(cause));
        this.name = 'WorkletLoadError';
        this.url = url;
        this.processorName = processorName;
        this.cause = cause;
    }
}

const modules = new WeakMap<BaseAudioContext, Map<string, Promise<void>>>();
const reported = new WeakMap<BaseAudioContext, Set<string>>();

function moduleMapFor(context: BaseAudioContext): Map<string, Promise<void>> {
    let map = modules.get(context);
    if (!map) {
        map = new Map();
        modules.set(context, map);
        if (typeof context.addEventListener === 'function') {
            context.addEventListener('statechange', () => {
                if (context.state === 'closed') modules.delete(context);
            });
        }
    }
    return map;
}

function reportOnce(context: BaseAudioContext, error: WorkletLoadError): void {
    let seen = reported.get(context);
    if (!seen) {
        seen = new Set();
        reported.set(context, seen);
    }
    if (seen.has(error.url)) return;
    seen.add(error.url);
    const reason = error.cause instanceof Error ? error.cause.message : String(error.cause);
    try {
        engineDegradationStore.report({
            id: `worklet-${error.processorName}`,
            subsystem: error.processorName,
            category: 'worklet',
            message: `${error.processorName}: AudioWorklet module failed to load`,
            reason,
            status: 'active',
            activeBackend: 'fallback',
            requestedBackend: 'audio-worklet',
            retryable: true,
        });
    } catch (err) {
        console.warn('[audioRuntime] degradation report failed', err);
    }
}

/**
 * Load `url` into `context.audioWorklet` once. `processorName` names the
 * processor the module registers (used for the error and the report).
 */
export function loadWorkletModule(
    context: BaseAudioContext,
    url: string,
    processorName: string,
): Promise<void> {
    if (context.state === 'closed') modules.delete(context);
    const map = moduleMapFor(context);
    const existing = map.get(url);
    if (existing) return existing;

    const load = (async () => {
        const worklet = context.audioWorklet as AudioWorklet | undefined;
        if (!worklet || typeof worklet.addModule !== 'function') {
            throw new Error('AudioWorklet is not available on this context');
        }
        await worklet.addModule(url);
    })().catch((cause: unknown) => {
        if (modules.get(context)?.get(url) === load) modules.get(context)?.delete(url);
        const error = cause instanceof WorkletLoadError ? cause : new WorkletLoadError(url, processorName, cause);
        reportOnce(context, error);
        throw error;
    });
    map.set(url, load);
    return load;
}
