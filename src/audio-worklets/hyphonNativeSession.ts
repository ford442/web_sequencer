// src/audio-worklets/hyphonNativeSession.ts
// One hyphon_native.wasm instance per audio session, shared by every voice.
//
// Every AudioWorkletNode created on a BaseAudioContext runs in that context's
// single AudioWorkletGlobalScope, on the one render thread. Open303 (bass1 /
// bass2 / lead303, plus their lazily created live high-fid voices) and Prophecy
// (part A / part B) used to instantiate the module once per processor, and each
// instantiation imported its own 128 MB `shared: true` WebAssembly.Memory — five
// SharedArrayBuffers before a note played. The C wrappers already expose
// multi-instance handles (open303_create / jc303_create / prophecy_create /
// highfid303_create), so the processors now take handles on one instance instead.
//
// The session lives on `globalThis` under a registered Symbol rather than in
// module scope: open303-processor and prophecy-processor are bundled as separate
// worklet scripts, each with its own copy of this module, but both share the
// AudioWorkletGlobalScope's global object. Calls into the instance never overlap
// because every processor's message handler and process() run on that thread.

import {
    buildHyphonWasmImports,
    normalizeWasmExports,
    type HyphonNativeThreading,
    type WasmExportMap,
} from './hyphonNativeImports';

/** 64 KiB — WebAssembly page size. */
const WASM_PAGE_BYTES = 65536;

/** Instantiation budget; a stuck instantiate must not hang every voice forever. */
const INSTANTIATE_TIMEOUT_MS = 5000;

const REGISTRY_KEY = Symbol.for('hyphon.nativeSession');

export interface HyphonNativeInitData {
    wasmBytes?: ArrayBuffer;
    isThreaded?: boolean;
    memoryPages?: number;
    exportMap?: WasmExportMap;
}

/** Heap telemetry reported to the main thread (Engine HUD). */
export interface HyphonNativeHeapStats {
    /** hyphon_native memories alive in this audio session. Anything but 1 is a regression. */
    heapCount: number;
    initialPages: number;
    currentPages: number;
    growEvents: number;
    /** Voice processors currently holding handles on the shared instance. */
    voices: number;
    /** Link profile the instance was built from: pthread (shared memory) or st. */
    threading: HyphonNativeThreading;
}

interface SessionRegistry {
    pending: Promise<HyphonNativeSession> | null;
    /** Profile of the pending / live session, for mismatch warnings. */
    threading: HyphonNativeThreading | null;
    heapCount: number;
}

function getRegistry(): SessionRegistry {
    const g = globalThis as { [REGISTRY_KEY]?: SessionRegistry };
    let registry = g[REGISTRY_KEY];
    if (!registry) {
        registry = { pending: null, threading: null, heapCount: 0 };
        g[REGISTRY_KEY] = registry;
    }
    return registry;
}

export class HyphonNativeSession {
    readonly instance: WebAssembly.Instance;
    readonly exports: Record<string, any>;
    readonly memory: WebAssembly.Memory | null;
    readonly initialPages: number;
    readonly threading: HyphonNativeThreading;

    private growEvents = 0;
    private lastSeenPages: number;
    private voices = 0;
    private readonly heapListeners = new Set<(stats: HyphonNativeHeapStats) => void>();

    constructor(
        instance: WebAssembly.Instance,
        exports: Record<string, any>,
        memory: WebAssembly.Memory | null,
        threading: HyphonNativeThreading,
    ) {
        this.threading = threading;
        this.instance = instance;
        this.exports = exports;
        this.memory = memory;
        this.initialPages = memory ? memory.buffer.byteLength / WASM_PAGE_BYTES : 0;
        this.lastSeenPages = this.initialPages;
    }

    get stats(): HyphonNativeHeapStats {
        return {
            heapCount: getRegistry().heapCount,
            initialPages: this.initialPages,
            currentPages: this.memory ? this.memory.buffer.byteLength / WASM_PAGE_BYTES : 0,
            growEvents: this.growEvents,
            voices: this.voices,
            threading: this.threading,
        };
    }

    /** Register a voice processor as a user of this instance. */
    retain(): void {
        this.voices++;
    }

    /** A voice processor destroyed its handles. The instance itself stays up for
     *  the life of the audio context — later voices reuse it. */
    release(): void {
        this.voices = Math.max(0, this.voices - 1);
    }

    /** Called whenever the heap grows. Returns an unsubscribe function. */
    onHeapGrow(listener: (stats: HyphonNativeHeapStats) => void): () => void {
        this.heapListeners.add(listener);
        return () => this.heapListeners.delete(listener);
    }

    /** @internal — wired to emscripten_resize_heap / notify_memory_growth. */
    notifyHeapGrow(): void {
        // resize_heap and notify_memory_growth can both fire for one grow.
        const pages = this.memory ? this.memory.buffer.byteLength / WASM_PAGE_BYTES : 0;
        if (pages <= this.lastSeenPages) return;
        this.lastSeenPages = pages;
        this.growEvents++;
        const stats = this.stats;
        for (const listener of this.heapListeners) listener(stats);
    }
}

/**
 * Get this audio session's hyphon_native instance, instantiating it on first use.
 *
 * Concurrent callers share one in-flight promise, so five voices initialising in
 * parallel compile, allocate memory and instantiate exactly once. A failed
 * instantiation is not cached — the next caller (e.g. Open303's retry loop)
 * starts a fresh attempt.
 */
export function acquireHyphonNativeSession(
    data: HyphonNativeInitData,
    logPrefix = '[HyphonNative]',
): Promise<HyphonNativeSession> {
    const registry = getRegistry();
    const threading: HyphonNativeThreading = data.isThreaded ? 'pthread' : 'st';
    if (!registry.pending) {
        const attempt = createSession(data, logPrefix, registry);
        registry.pending = attempt;
        registry.threading = threading;
        attempt.catch(() => {
            if (registry.pending === attempt) {
                registry.pending = null;
                registry.threading = null;
            }
        });
    } else if (registry.threading !== threading) {
        // The main thread binds one profile per AudioContext
        // (src/engines/hyphonNativeVariant.ts), so this means a caller bypassed it.
        console.warn(
            `${logPrefix} asked for the ${threading} hyphon_native build but this audio session ` +
            `already runs ${registry.threading}; reusing it (one heap per session).`,
        );
    }
    return registry.pending;
}

/** Drop the session so the next acquire instantiates afresh. For tests only. */
export function resetHyphonNativeSessionForTests(): void {
    const g = globalThis as { [REGISTRY_KEY]?: SessionRegistry };
    delete g[REGISTRY_KEY];
}

async function createSession(
    data: HyphonNativeInitData,
    logPrefix: string,
    registry: SessionRegistry,
): Promise<HyphonNativeSession> {
    if (!data.wasmBytes || data.wasmBytes.byteLength === 0) {
        throw new Error('No WASM bytes received');
    }

    const module = await WebAssembly.compile(data.wasmBytes);

    let session: HyphonNativeSession | null = null;
    let pendingInstance: WebAssembly.Instance | null = null;
    let importedMemory: WebAssembly.Memory | null = null;

    const { imports, memory } = buildHyphonWasmImports(
        module,
        {
            getWasmInstance: () => session?.instance ?? pendingInstance,
            getImportedMemory: () => importedMemory,
            setImportedMemory: (m) => {
                importedMemory = m;
            },
            onHeapUpdate: () => session?.notifyHeapGrow(),
            logPrefix,
        },
        { memoryPages: data.memoryPages, isThreaded: !!data.isThreaded },
    );
    if (memory) registry.heapCount++;

    try {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(
                () => reject(new Error(`WASM instantiation timeout (${INSTANTIATE_TIMEOUT_MS / 1000}s)`)),
                INSTANTIATE_TIMEOUT_MS,
            );
        });
        try {
            pendingInstance = await Promise.race([WebAssembly.instantiate(module, imports), timeout]);
        } finally {
            clearTimeout(timer);
        }

        const exports = normalizeWasmExports(pendingInstance.exports, data.exportMap ?? {}) as Record<string, any>;
        const ownMemory =
            memory ?? ((pendingInstance.exports as { memory?: WebAssembly.Memory }).memory ?? null);
        configureWasmStack(exports);

        session = new HyphonNativeSession(
            pendingInstance,
            exports,
            ownMemory,
            data.isThreaded ? 'pthread' : 'st',
        );
        console.log(
            `${logPrefix} hyphon_native (${session.threading}) instantiated once for this audio session ` +
            `(${session.initialPages} pages, heaps=${registry.heapCount})`,
        );
        return session;
    } catch (e) {
        // The memory is unreachable now; don't let it inflate the HUD's heap count.
        if (memory) registry.heapCount = Math.max(0, registry.heapCount - 1);
        throw e;
    }
}

/**
 * One-time runtime setup that previously ran inside each processor.
 *
 * - __wasm_call_ctors: hyphon_native.wasm is an Emscripten C++ module whose model
 *   registry, rosic wavetables and embind registrations live in global objects.
 *   The Emscripten glue runs the constructors on the main thread, but worklets
 *   instantiate by hand; skipping them left the statics zeroed, so
 *   open303_create() returned a null handle and Prophecy trapped on
 *   `unreachable`. Running them twice would re-construct live globals, which is
 *   one more reason the instance must be shared rather than re-initialised.
 * - __set_stack_limits(base, 0): the jc303 build calls __handle_stack_overflow
 *   during init even though sp never falls below the real limit; stackEnd=0
 *   makes the check (sp < 0) always false.
 */
function configureWasmStack(exports: Record<string, any>): void {
    if (typeof exports.emscripten_stack_init === 'function') {
        exports.emscripten_stack_init();
    }
    if (typeof exports.__wasm_call_ctors === 'function') {
        exports.__wasm_call_ctors();
    }
    if (typeof exports.__set_stack_limits === 'function' &&
        typeof exports.emscripten_stack_get_base === 'function') {
        const stackBase = exports.emscripten_stack_get_base();
        if (stackBase > 0) {
            exports.__set_stack_limits(stackBase, 0);
        }
    }
}
