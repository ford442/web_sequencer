/**
 * Main-thread readiness probe for the voice module — the StartOverlay's
 * "NATIVE MODULE" line.
 *
 * main.tsx used to `import()` the pthread hyphon_native.js and instantiate it,
 * which spun up a pthread pool on the page only so main() could start the
 * Pyodide bootstrap. Pyodide is its own on-demand module now
 * (src/pyodide/pythonEngineStore.ts), so nothing on the main thread needs a
 * hyphon_native instance — the voices get theirs from the AudioWorklet session
 * (#1229). This probe only fetches the profile the first voice will select and
 * validates it, and the bytes land in the HTTP / service-worker cache for the
 * worklet's own fetch.
 *
 * It always settles: a missing, corrupt or unreachable (10 s) artifact is a
 * degradation report and the overlay's JS FALLBACK state — the voices run their
 * JS / Web Audio fallbacks — not a start button that never enables.
 */
import { HYPHON_NATIVE_ARTIFACTS } from '../audio-worklets/hyphonNativeImports';
import { logEngineFallback, resolvePublicAsset } from '../utils/engineTelemetry';
import { detectHyphonNativeEnvironment, selectHyphonNativeThreading } from './hyphonNativeVariant';

export const HYPHON_NATIVE_READY_EVENT = 'hyphon-native-ready';
/** The probe finished without a usable module: the engines run their JS fallbacks. */
export const HYPHON_NATIVE_FAILED_EVENT = 'hyphon-native-failed';

/** How long the overlay waits on the fetch before it reports the module missing. */
export const HYPHON_NATIVE_PROBE_TIMEOUT_MS = 10_000;

/**
 * `pending` while the probe runs; `ready` once the wasm is reachable and valid;
 * `failed` when it is not — each voice then runs its documented JS / Web Audio
 * fallback (the failure is already a degradation report), so the transport is
 * still startable.
 */
export type HyphonNativeStatus = 'pending' | 'ready' | 'failed';

let probing: Promise<boolean> | null = null;
let failed = false;

export function isHyphonNativeReady(): boolean {
    return globalThis.hyphonNativeReady === true;
}

export function getHyphonNativeStatus(): HyphonNativeStatus {
    return isHyphonNativeReady() ? 'ready' : failed ? 'failed' : 'pending';
}

export function probeHyphonNative(): Promise<boolean> {
    probing ??= (async () => {
        const { threading, reason } = selectHyphonNativeThreading(undefined, detectHyphonNativeEnvironment());
        const file = HYPHON_NATIVE_ARTIFACTS[threading].wasm;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), HYPHON_NATIVE_PROBE_TIMEOUT_MS);
        try {
            const res = await fetch(resolvePublicAsset(file), { signal: controller.signal });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            if (!WebAssembly.validate(await res.arrayBuffer())) throw new Error('not a valid wasm module');
            globalThis.hyphonNativeReady = true;
            window.dispatchEvent(new CustomEvent(HYPHON_NATIVE_READY_EVENT, { detail: { file, reason } }));
            return true;
        } catch (err) {
            logEngineFallback('hyphon-native', threading, `${file} unavailable`, err);
            failed = true;
            window.dispatchEvent(new CustomEvent(HYPHON_NATIVE_FAILED_EVENT, { detail: { file, reason } }));
            return false;
        } finally {
            clearTimeout(timer);
        }
    })();
    return probing;
}

/** Test hook: forget the cached probe. */
export function resetHyphonNativeProbeForTests(): void {
    probing = null;
    failed = false;
    globalThis.hyphonNativeReady = undefined;
}
