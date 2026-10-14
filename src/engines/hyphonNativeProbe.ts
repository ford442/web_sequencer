/**
 * Main-thread readiness probe for the voice module — the StartOverlay's
 * "NATIVE MODULE" line.
 *
 * main.tsx used to `import()` the pthread hyphon_native.js and instantiate it,
 * which spun up a pthread pool on the page only so main() could start the
 * Pyodide bootstrap. Pyodide is its own module now (src/pyodide/bootstrap.ts),
 * so nothing on the main thread needs a hyphon_native instance — the voices get
 * theirs from the AudioWorklet session (#1229). This probe only fetches the
 * profile the first voice will select and validates it: a missing or corrupt
 * artifact still shows as MISSING before the user clicks start, and the bytes
 * land in the HTTP / service-worker cache for the worklet's own fetch.
 */
import { HYPHON_NATIVE_ARTIFACTS } from '../audio-worklets/hyphonNativeImports';
import { logEngineFallback, resolvePublicAsset } from '../utils/engineTelemetry';
import { detectHyphonNativeEnvironment, selectHyphonNativeThreading } from './hyphonNativeVariant';

export const HYPHON_NATIVE_READY_EVENT = 'hyphon-native-ready';

let probing: Promise<boolean> | null = null;

export function isHyphonNativeReady(): boolean {
    return globalThis.hyphonNativeReady === true;
}

export function probeHyphonNative(): Promise<boolean> {
    probing ??= (async () => {
        const { threading, reason } = selectHyphonNativeThreading(undefined, detectHyphonNativeEnvironment());
        const file = HYPHON_NATIVE_ARTIFACTS[threading].wasm;
        try {
            const res = await fetch(resolvePublicAsset(file));
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            if (!WebAssembly.validate(await res.arrayBuffer())) throw new Error('not a valid wasm module');
            globalThis.hyphonNativeReady = true;
            window.dispatchEvent(new CustomEvent(HYPHON_NATIVE_READY_EVENT, { detail: { file, reason } }));
            return true;
        } catch (err) {
            logEngineFallback('hyphon-native', threading, `${file} unavailable`, err);
            return false;
        }
    })();
    return probing;
}

/** Test hook: forget the cached probe. */
export function resetHyphonNativeProbeForTests(): void {
    probing = null;
    globalThis.hyphonNativeReady = undefined;
}
