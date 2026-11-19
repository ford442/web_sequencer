/**
 * The private, single-threaded hyphon_native instance the offline renderers
 * share (macro family, analog drum kit).
 *
 * The same wasm the AudioWorklet voices run, instantiated on whatever thread
 * calls this (main thread or a worker — no AudioWorklet involved) with a plain
 * memory. Each render takes its own voice handle, so one instance serves every
 * offline engine; it is fetched, compiled and instantiated once per page.
 */

import {
    buildHyphonWasmImports,
    HYPHON_NATIVE_ARTIFACTS,
    normalizeWasmExports,
} from '../../audio-worklets/hyphonNativeImports';
import { configureWasmStack } from '../../audio-worklets/hyphonNativeSession';
import { loadHyphonWasmExportMap, resolvePublicAsset } from '../../utils/engineTelemetry';

/** Normalised exports of the offline instance, plus its memory. */
export interface OfflineNativeInstance {
    exports: Record<string, unknown>;
    memory: WebAssembly.Memory;
}

let loading: Promise<OfflineNativeInstance> | null = null;

/**
 * The shared offline instance. Rejects — and is retried on the next call —
 * when the wasm is missing or cannot be instantiated.
 */
export function loadOfflineNative(): Promise<OfflineNativeInstance> {
    if (!loading) {
        loading = instantiateOfflineNative();
        loading.catch(() => {
            loading = null;
        });
    }
    return loading;
}

async function instantiateOfflineNative(): Promise<OfflineNativeInstance> {
    const artifact = HYPHON_NATIVE_ARTIFACTS.st;
    const response = await fetch(resolvePublicAsset(artifact.wasm));
    if (!response.ok) throw new Error(`${artifact.wasm} fetch HTTP ${response.status}`);
    return instantiateOfflineNativeFromBytes(await response.arrayBuffer(), await loadHyphonWasmExportMap('st'));
}

/** Instantiate the single-threaded hyphon_native from its bytes + export map (tests, workers). */
export async function instantiateOfflineNativeFromBytes(
    bytes: BufferSource,
    exportMap: Record<string, string>,
): Promise<OfflineNativeInstance> {
    const module = await WebAssembly.compile(bytes);

    let instance: WebAssembly.Instance | null = null;
    let memory: WebAssembly.Memory | null = null;
    const built = buildHyphonWasmImports(
        module,
        {
            getWasmInstance: () => instance,
            getImportedMemory: () => memory,
            setImportedMemory: (m) => {
                memory = m;
            },
            onHeapUpdate: () => {},
            logPrefix: '[OfflineNative]',
        },
        { isThreaded: false },
    );
    instance = await WebAssembly.instantiate(module, built.imports);
    const exports = normalizeWasmExports(instance.exports, exportMap);
    configureWasmStack(exports);
    memory = built.memory ?? (instance.exports as { memory?: WebAssembly.Memory }).memory ?? null;
    if (!memory) throw new Error('hyphon_native has no memory');
    return { exports, memory };
}

/** Test hook: forget the cached instance. */
export function resetOfflineNativeForTests(): void {
    loading = null;
}
