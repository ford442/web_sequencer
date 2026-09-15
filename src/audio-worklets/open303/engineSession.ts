// src/audio-worklets/open303/engineSession.ts
// The native/jc303 instance handles for one Open303Processor, on the audio
// session's shared hyphon_native.wasm instance (see ../hyphonNativeSession.ts):
// resolving which native API(s) the module exposes, the heap view used to read
// rendered samples back out, and handle teardown. Everything here either runs
// once at init or is called from the process() hot path — no allocation-adding
// indirection.

import { formatMissingWasmExports } from '../hyphonNativeImports';
import { acquireHyphonNativeSession, type HyphonNativeSession } from '../hyphonNativeSession';
import { resolveWorkletSampleRate } from '../../utils/workletSampleRate';
import { SynthState, type SynthStateType, getTime } from './shared';

export class Open303EngineSession {
    /** Shared per-audio-session instance; this processor only owns handles on it. */
    private native: HyphonNativeSession | null = null;
    private detachHeapListener: (() => void) | null = null;
    private disposed = false;
    private heap: Float32Array | null = null;
    private synthState: SynthStateType = SynthState.UNINITIALIZED;
    private isThreadedFlag: boolean = false;

    // When true the WASM exposes the open303_* instance-based API
    // (hyphon_native.wasm with open303_wrapper.cpp).  When false the legacy
    // jc303_* single-instance API is used (standalone jc303-single.wasm).
    private nativeApi: boolean = false;
    private handle: number | bigint = 0;
    // Caller-allocated output buffer pointer (malloc'd once, freed on cleanup)
    private outputPtr: number | bigint = 0;
    private readonly bufFrames: number = 128;

    // Authentic rosic::Open303 multi-instance API (jc303_wrapper.cpp).
    // Available alongside the custom open303_* API in hyphon_native.wasm.
    private jc303MultiApi: boolean = false;
    private jc303HandleValue: number | bigint = 0;

    private rateHz: number = 44100;

    /** Native 303 model registry (open303_get_model_* exports), discovered at
     *  init. null = the loaded WASM predates the voices architecture; model
     *  selection then degrades to plain engine-family switching. */
    private registry: Map<string, { index: number; engine: 'open303' | 'jc303' }> | null = null;

    // Error tracking
    private initAttempts = 0;
    private static readonly MAX_INIT_ATTEMPTS = 3;
    private lastErrorMessage: string = '';

    private readonly port: MessagePort;

    constructor(port: MessagePort) {
        this.port = port;
    }

    get state(): SynthStateType {
        return this.synthState;
    }

    /** True once the WASM module has instantiated successfully and the synth is live. */
    get isReady(): boolean {
        return this.synthState === SynthState.READY && this.native !== null;
    }

    get isInstantiated(): boolean {
        return this.native !== null;
    }

    get heapFloat32(): Float32Array | null {
        return this.heap;
    }

    get isNativeApi(): boolean {
        return this.nativeApi;
    }

    get hasJc303MultiApi(): boolean {
        return this.jc303MultiApi;
    }

    get instanceHandle(): number | bigint {
        return this.handle;
    }

    get jc303Handle(): number | bigint {
        return this.jc303HandleValue;
    }

    get nativeOutputPtr(): number | bigint {
        return this.outputPtr;
    }

    get nativeBufFrames(): number {
        return this.bufFrames;
    }

    get modelRegistry(): Map<string, { index: number; engine: 'open303' | 'jc303' }> | null {
        return this.registry;
    }

    get sampleRateHz(): number {
        return this.rateHz;
    }

    getExports(): Record<string, any> {
        return this.native?.exports ?? {};
    }

    /**
     * Pass a handle back to WASM in the representation the module handed us.
     *
     * WASM_BIGINT only changes how i64 values cross the boundary. The
     * open303 and jc303 handles are plain i32 in this wasm32 build —
     * open303_create() returns a JS number — so coercing to BigInt made every
     * call throw "Cannot convert a BigInt value to a number" and the engine fell
     * back to the JS voice. Preserving the representation keeps a future
     * MEMORY64 build (where these come back as bigint) working too.
     */
    toWasmHandle(handle: number | bigint): number | bigint {
        return handle;
    }

    isInvalidHandle(handle: number | bigint | null | undefined): boolean {
        if (handle == null) return true;
        if (typeof handle === 'bigint') return handle <= 0n;
        return !Number.isFinite(handle) || handle <= 0;
    }

    /** Convert a WASM heap pointer (number or bigint) to a Float32Array index. */
    wasmPtrToOffset(ptr: number | bigint | null | undefined): number {
        if (ptr == null) return -1;
        const n = typeof ptr === 'bigint' ? Number(ptr) : ptr;
        if (!Number.isFinite(n) || n <= 0) return -1;
        return n >>> 2;
    }

    /** Ensures the heap view is up to date and returns the Float32 offset, or -1 if invalid. */
    getWasmSampleOffset(ptr: number | bigint, numFrames: number): number {
        this.updateHeap();
        if (!this.heap) return -1;

        const byteOffset = typeof ptr === 'bigint' ? Number(ptr) : ptr;
        if (!Number.isFinite(byteOffset) || byteOffset <= 0) return -1;
        if (byteOffset + numFrames * 4 > this.heap.buffer.byteLength) return -1;

        return byteOffset >>> 2;
    }

    writeOutputSamples(
        floatOffset: number,
        numFrames: number,
        channelL: Float32Array | undefined,
        channelR: Float32Array | undefined,
        gain: number,
    ): void {
        const heap = this.heap;
        if (!heap) return;

        for (let i = 0; i < numFrames; i++) {
            const sample = heap[floatOffset + i] * gain;
            if (channelL) channelL[i] = sample;
            if (channelR) channelR[i] = sample;
        }
    }

    updateHeap(): void {
        const memory = this.native?.memory;
        if (memory && (!this.heap || this.heap.buffer !== memory.buffer)) {
            this.heap = new Float32Array(memory.buffer);
        }
    }

    /** Read a null-terminated UTF-8 string from the WASM heap. */
    readWasmCString(ptr: number | bigint | null | undefined): string | null {
        const memory = this.native?.memory;
        const start = typeof ptr === 'bigint' ? Number(ptr) : ptr;
        if (!memory?.buffer || !start || !Number.isFinite(start) || start <= 0) return null;

        const bytes = new Uint8Array(memory.buffer);
        let end = start;
        const limit = Math.min(bytes.length, start + 256); // model ids are short
        while (end < limit && bytes[end] !== 0) end++;
        if (end === start) return null;

        let str = '';
        for (let i = start; i < end; i++) str += String.fromCharCode(bytes[i]);
        return str;
    }

    /** Compile + instantiate the WASM module, retrying up to MAX_INIT_ATTEMPTS times.
     *  Posts 'ready'/'error' on the worklet port itself; `onReady` lets the
     *  caller flush anything it queued while waiting for init to finish. */
    async initialize(data: any, onReady: () => void): Promise<void> {
        if (this.synthState === SynthState.INITIALIZING) {
            console.log('[Open303] Initialization already in progress');
            return;
        }

        this.synthState = SynthState.INITIALIZING;

        while (this.initAttempts < Open303EngineSession.MAX_INIT_ATTEMPTS && !this.disposed) {
            this.initAttempts++;
            console.log(`[Open303] Initialization attempt ${this.initAttempts}/${Open303EngineSession.MAX_INIT_ATTEMPTS}`);

            try {
                const success = await this.tryInitialize(data);
                if (this.disposed) {
                    // The node was torn down while the shared instance was coming up.
                    this.releaseHandles();
                    return;
                }
                if (success) {
                    this.synthState = SynthState.READY;
                    console.log('[Open303] WASM initialized successfully');
                    this.attachToSession();
                    onReady();
                    this.port.postMessage({ type: 'ready', heap: this.native?.stats });
                    return;
                }
            } catch (e) {
                this.releaseHandles();
                const errorMsg = e instanceof Error ? e.message : String(e);
                console.warn(`[Open303] Init attempt ${this.initAttempts} failed:`, errorMsg);
                this.lastErrorMessage = errorMsg;

                // Small delay before retry to let stack/heap settle
                // Note: AudioWorklet doesn't have setTimeout, so we use a simple spin wait
                if (this.initAttempts < Open303EngineSession.MAX_INIT_ATTEMPTS) {
                    const start = getTime();
                    while (getTime() - start < 100) { /* spin wait */ }
                }
            }
        }

        if (this.disposed) return;

        // All attempts failed
        console.error('[Open303] All initialization attempts failed');
        this.synthState = SynthState.FAILED;
        this.port.postMessage({
            type: 'error',
            error: `Failed to initialize after ${Open303EngineSession.MAX_INIT_ATTEMPTS} attempts. Last error: ${this.lastErrorMessage}`,
            recoverable: false
        });
    }

    private async tryInitialize(data: any): Promise<boolean> {
        const variant = data.variant || (data.isThreaded ? 'pthread' : 'st');
        this.isThreadedFlag = data.isThreaded || false;

        console.log(`[Open303] Initializing with ${variant} WASM variant (threaded: ${this.isThreadedFlag})`);

        // Compile, allocate the imported memory, instantiate and run the C++
        // constructors — once per audio session. Every 303 and Prophecy voice
        // after the first gets the already-live instance and just creates handles.
        this.native = await acquireHyphonNativeSession(
            {
                wasmBytes: data.wasmBytes,
                isThreaded: this.isThreadedFlag,
                // createHyphonMemory floors this per profile (pthread / st).
                memoryPages: data.memoryPages,
                exportMap: data.exportMap,
            },
            '[Open303]',
        );
        const rawExports = this.native.instance.exports;
        this.updateHeap();

        // 4. Verify exports — accept either the native multi-instance API
        // (open303_create/open303_init, exported by hyphon_native.wasm) or the
        // legacy single-instance jc303_init/jc303_process API.
        const exports = this.getExports();
        const hasNative = typeof exports.open303_create === 'function'
                       && typeof exports.open303_init === 'function';
        const hasLegacy = typeof exports.jc303_init_handle === 'function'
                       && typeof exports.jc303_process_handle === 'function';

        if (!hasNative && !hasLegacy) {
            throw new Error(
                `Missing required exports: neither open303_* (native) nor jc303_* (legacy) found. ` +
                formatMissingWasmExports(rawExports, [
                    'open303_create',
                    'open303_init',
                    'jc303_init_handle',
                    'jc303_process_handle',
                ]),
            );
        }

        // 5. Initialize the synth with stack protection
        return this.initializeSynth(
            exports,
            resolveWorkletSampleRate({
                sampleRate: data.sampleRate ?? (globalThis as { sampleRate?: number }).sampleRate,
            }),
        );
    }

    private initializeSynth(exports: any, sampleRate: number): boolean {
        this.rateHz = resolveWorkletSampleRate({ sampleRate });
        // Prefer the new multi-instance native API (hyphon_native with open303_wrapper.cpp).
        // Fall back to the single-instance jc303_* API (standalone jc303-single.wasm).
        if (typeof exports.open303_create === 'function' &&
            typeof exports.open303_init   === 'function') {
            return this.initializeNativeApi(exports, sampleRate);
        }
        return this.initializeLegacyApi(exports, sampleRate);
    }

    private initializeNativeApi(exports: any, sampleRate: number): boolean {
        console.log('[Open303] Using native multi-instance API (open303_*)');
        try {
            // Create instance
            this.handle = exports.open303_create();
            if (this.isInvalidHandle(this.handle)) {
                throw new Error('open303_create() returned null handle');
            }

            const result = exports.open303_init(
                this.toWasmHandle(this.handle),
                sampleRate,
                this.bufFrames,
            );
            if (result !== 1) {
                throw new Error(`open303_init() returned ${result}`);
            }

            // Allocate the output buffer on the WASM heap (owned by the worklet)
            const mallocFn = exports._malloc ?? exports.malloc;
            if (mallocFn) {
                // 4 bytes per sample (Float32)
                this.outputPtr = mallocFn(this.bufFrames * 4);
                if (this.isInvalidHandle(this.outputPtr)) {
                    throw new Error('Failed to allocate native output buffer');
                }
            }

            this.nativeApi = true;
            console.log(`[Open303] Native instance created: handle=${this.handle}`);

            // Also initialise the authentic rosic::Open303 multi-instance (jc303_*)
            // so that per-voice engine switching works without a full reinit.
            this.initializeJc303MultiInstance(exports, sampleRate);

            this.discoverModelRegistry(exports);

            return true;
        } catch (e) {
            console.error('[Open303] Native API init failed:', e);
            this.nativeApi = false;
            // Leave this.handle set: initialize()'s catch destroys it on the shared
            // instance. Zeroing it here would leak the open303 handle there.
            // Rethrow: initialize()'s retry loop records the message, and a bare
            // `return false` here is what produced "Failed to initialize after 3
            // attempts. Last error: " with nothing after the colon.
            throw e instanceof Error ? e : new Error(String(e));
        }
    }

    /** Initialise the authentic rosic::Open303 multi-instance handle alongside
     *  the custom open303 instance.  Failures are non-fatal — the custom engine
     *  remains the default and engine switching will simply be unavailable. */
    private initializeJc303MultiInstance(exports: any, sampleRate: number): void {
        if (typeof exports.jc303_create !== 'function' ||
            typeof exports.jc303_init_handle !== 'function') {
            console.log('[Open303] jc303 multi-instance API not available in this WASM build');
            return;
        }
        try {
            this.jc303HandleValue = exports.jc303_create();
            if (this.isInvalidHandle(this.jc303HandleValue)) {
                console.warn('[Open303] jc303_create() returned null handle');
                return;
            }
            const res = exports.jc303_init_handle(
                this.toWasmHandle(this.jc303HandleValue),
                sampleRate,
                this.bufFrames,
            );
            if (res !== 1) {
                console.warn(`[Open303] jc303_init_handle() returned ${res}`);
                if (exports.jc303_destroy) {
                    exports.jc303_destroy(this.toWasmHandle(this.jc303HandleValue));
                }
                this.jc303HandleValue = 0;
                return;
            }
            this.jc303MultiApi = true;
            console.log(`[Open303] Authentic JC303 instance ready: handle=${this.jc303HandleValue}`);
        } catch (e) {
            console.warn('[Open303] JC303 multi-instance init failed (engine unavailable):', e);
            this.jc303HandleValue = 0;
            this.jc303MultiApi = false;
        }
    }

    /** Discover the native 303 model registry (open303_get_model_* exports).
     *  Absent on WASM builds that predate the voices architecture — model
     *  selection then falls back to plain engine-family switching. */
    private discoverModelRegistry(exports: any): void {
        if (typeof exports.open303_get_model_count !== 'function' ||
            typeof exports.open303_get_model_id !== 'function' ||
            typeof exports.open303_get_model_engine !== 'function') {
            console.log('[Open303] Native 303 model registry not available in this WASM build');
            return;
        }
        try {
            const count = Number(exports.open303_get_model_count());
            if (!Number.isFinite(count) || count <= 0 || count > 64) return;

            const registry = new Map<string, { index: number; engine: 'open303' | 'jc303' }>();
            for (let i = 0; i < count; i++) {
                const id = this.readWasmCString(exports.open303_get_model_id(i));
                if (!id) continue;
                const engine = Number(exports.open303_get_model_engine(i)) === 1 ? 'jc303' : 'open303';
                registry.set(id, { index: i, engine });
            }
            if (registry.size > 0) {
                this.registry = registry;
                console.log(`[Open303] Native 303 model registry: ${[...registry.keys()].join(', ')}`);
            }
        } catch (e) {
            console.warn('[Open303] Failed to read native 303 model registry:', e);
            this.registry = null;
        }
    }

    private initializeLegacyApi(exports: any, sampleRate: number): boolean {
        // Try with progressively smaller buffer sizes to reduce stack pressure
        const bufferSizes = [128, 64, 32, 16];

        for (const bufferSize of bufferSizes) {
            try {
                console.log(`[Open303] Attempting jc303_init with bufferSize=${bufferSize}...`);
                const result = exports.jc303_init(sampleRate, bufferSize);

                if (result === 1) {
                    console.log(`[Open303] Legacy API initialized with sampleRate=${sampleRate}, bufferSize=${bufferSize}`);
                    return true;
                } else {
                    console.warn(`[Open303] jc303_init returned ${result} with bufferSize=${bufferSize}`);
                }
            } catch (initError) {
                console.warn(`[Open303] init failed with bufferSize=${bufferSize}:`, initError);
            }
        }

        return false;
    }

    /** Subscribe to heap growth so the HUD sees grow events from the shared heap. */
    private attachToSession(): void {
        if (!this.native || this.detachHeapListener) return;
        this.native.retain();
        const unsubscribe = this.native.onHeapGrow((stats) => {
            this.updateHeap();
            this.port.postMessage({ type: 'hyphon-heap', data: stats });
        });
        const native = this.native;
        this.detachHeapListener = () => {
            unsubscribe();
            native.release();
        };
    }

    /** Destroy this processor's handles on the shared instance. The instance
     *  itself outlives the processor — other voices are still using it. */
    private releaseHandles(): void {
        const exports = this.getExports();
        try {
            if (!this.isInvalidHandle(this.handle)) exports.open303_destroy?.(this.toWasmHandle(this.handle));
            if (!this.isInvalidHandle(this.jc303HandleValue)) exports.jc303_destroy?.(this.toWasmHandle(this.jc303HandleValue));
            if (!this.isInvalidHandle(this.outputPtr)) (exports._free ?? exports.free)?.(this.outputPtr);
        } catch (e) {
            console.warn('[Open303] Handle teardown failed:', e);
        }
        this.handle = 0;
        this.jc303HandleValue = 0;
        this.outputPtr = 0;
        this.nativeApi = false;
        this.jc303MultiApi = false;
    }

    /** Tear down for good: free handles and detach from the shared session. */
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.releaseHandles();
        this.detachHeapListener?.();
        this.detachHeapListener = null;
        this.synthState = SynthState.FAILED;
        this.heap = null;
    }
}
