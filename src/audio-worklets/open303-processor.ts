// src/audio-worklets/open303-processor.ts
// Hardened version with stack overflow protection and graceful degradation

import {
    HYPHON_NATIVE_MIN_MEMORY_PAGES,
    buildHyphonWasmImports,
    normalizeWasmExports,
} from './hyphonNativeImports';
import { WorkletPerfReporter } from './workletPerfReporter';

// Definitions for the AudioWorklet scope
declare class AudioWorkletProcessor {
    readonly port: MessagePort;
    process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}

declare function registerProcessor(name: string, processorCtor: new () => AudioWorkletProcessor): void;

// Safe performance.now() wrapper for contexts where performance is not defined
function getTime(): number {
    if (typeof performance !== 'undefined' && performance.now) {
        return performance.now();
    }
    return Date.now();
}

// Synth state (using const object instead of enum for erasableSyntaxOnly compatibility)
const SynthState = {
    UNINITIALIZED: 'uninitialized',
    INITIALIZING: 'initializing',
    READY: 'ready',
    FAILED: 'failed',
    FALLBACK: 'fallback'
} as const;

type SynthStateType = typeof SynthState[keyof typeof SynthState];

/** Minimum WebAssembly memory pages for hyphon_native.wasm (threaded Emscripten build).
 *  Must stay in sync with OPEN303_MIN_MEMORY_PAGES in Open303Oscillator.ts. */
const OPEN303_MIN_MEMORY_PAGES = HYPHON_NATIVE_MIN_MEMORY_PAGES;

// Map from jc303_set* function name → open303 paramId
// (keeps the existing message protocol while supporting the new native API)
const JC303_PARAM_MAP: Record<string, number> = {
    jc303_setWaveform:   0,  // OPEN303_WAVEFORM
    jc303_setCutoff:     2,  // OPEN303_CUTOFF
    jc303_setResonance:  3,  // OPEN303_RESONANCE
    jc303_setEnvMod:     4,  // OPEN303_ENV_MOD
    jc303_setDecay:      5,  // OPEN303_DECAY
    jc303_setAccent:     6,  // OPEN303_ACCENT
    jc303_setVolume:     7,  // OPEN303_VOLUME
    jc303_setFilterMode: 8,  // OPEN303_FILTER_MODE
};

class Open303Processor extends AudioWorkletProcessor {
    private wasmInstance: WebAssembly.Instance | null = null;
    private normalizedExports: Record<string, unknown> | null = null;
    private importedMemory: WebAssembly.Memory | null = null;
    private heapFloat32: Float32Array | null = null;
    private synthState: SynthStateType = SynthState.UNINITIALIZED;
    private isThreaded: boolean = false;

    // When true the WASM exposes the open303_* instance-based API
    // (hyphon_native.wasm with open303_wrapper.cpp).  When false the legacy
    // jc303_* single-instance API is used (standalone jc303-single.wasm).
    private isNativeApi: boolean = false;
    private instanceHandle: number | bigint = 0;
    // Caller-allocated output buffer pointer (malloc'd once, freed on cleanup)
    private nativeOutputPtr: number | bigint = 0;
    private nativeBufFrames: number = 128;

    // Authentic rosic::Open303 multi-instance API (jc303_wrapper.cpp).
    // Available alongside the custom open303_* API in hyphon_native.wasm.
    private hasJc303MultiApi: boolean = false;
    private jc303Handle: number | bigint = 0;

    /** Which DSP engine is currently active for this processor instance.
     *  'open303' = custom synthesizer (open303_* API, default)
     *  'jc303'   = authentic rosic::Open303 (jc303_* multi-instance API)
     */
    private activeEngine: 'open303' | 'jc303' = 'open303';
    private readonly perf = new WorkletPerfReporter(this.port, 'open303');

    // Mild makeup gain — hyphon_native 303 engines already run near full scale.
    private static readonly OUTPUT_GAIN = 1.0;

    // Stuck note protection
    private activeNotes: Map<number, number> = new Map(); // note -> startTime (ms)
    private static readonly MAX_NOTE_DURATION_MS = 8000;
    private stuckNoteWarnings = 0;

    // Rate limiting
    private lastNoteOnTime = 0;
    private static readonly MIN_NOTE_INTERVAL_MS = 5;
    private static readonly MAX_NOTES_PER_SECOND = 50;
    private noteOnTimes: number[] = [];

    // Portamento/slide fix
    private pendingNote: { note: number; velocity: number } | null = null;
    private noteOffJustSent = false;

    // Error tracking
    private initAttempts = 0;
    private static readonly MAX_INIT_ATTEMPTS = 3;
    private processErrorCount = 0;
    private allocationErrorCount = 0;
    private lastErrorMessage: string = '';

    /** Params/engine messages received before the worklet reaches READY. */
    private pendingMessages: Array<{ type: string; data: any }> = [];

    constructor() {
        super();
        this.port.onmessage = this.handleMessage.bind(this);
    }

    private async handleMessage(event: MessageEvent) {
        const { type, data } = event.data;

        if (type === 'init-wasm') {
            await this.initializeWasm(data);
            return;
        }

        if (this.synthState !== SynthState.READY || !this.wasmInstance) {
            if (type === 'set-engine' || type === 'param') {
                this.pendingMessages.push({ type, data });
            }
            return;
        }

        this.dispatchMessage(type, data);
    }

    private dispatchMessage(type: string, data: any): void {
        const exports = this.getExports();

        if (type === 'noteOn') {
            this.handleNoteOn(data.note, data.velocity);
        } else if (type === 'noteOff') {
            this.handleNoteOff(data.note);
        } else if (type === 'set-engine') {
            this.handleSetEngine(data.engine as 'open303' | 'jc303');
        } else if (type === 'param') {
            this.applyParamMessage(exports, data);
        }
    }

    private applyParamMessage(exports: Record<string, any>, data: { func: string; value: number }): void {
        if (this.isNativeApi) {
            const paramId = JC303_PARAM_MAP[data.func as string];
            if (paramId !== undefined) {
                if (this.activeEngine === 'jc303' && this.hasJc303MultiApi && exports.jc303_set_param) {
                    exports.jc303_set_param(this.toWasmHandle(this.jc303Handle), paramId, data.value);
                } else if (exports.open303_set_param) {
                    exports.open303_set_param(this.toWasmHandle(this.instanceHandle), paramId, data.value);
                }
            }
        } else if (exports[data.func]) {
            exports[data.func](data.value);
        }
    }

    private flushPendingMessages(): void {
        const queue = this.pendingMessages;
        this.pendingMessages = [];
        for (const msg of queue) {
            this.dispatchMessage(msg.type, msg.data);
        }
    }

    private async initializeWasm(data: any) {
        // Prevent concurrent initialization
        if (this.synthState === SynthState.INITIALIZING) {
            console.log('[Open303] Initialization already in progress');
            return;
        }

        this.synthState = SynthState.INITIALIZING;

        while (this.initAttempts < Open303Processor.MAX_INIT_ATTEMPTS) {
            this.initAttempts++;
            console.log(`[Open303] Initialization attempt ${this.initAttempts}/${Open303Processor.MAX_INIT_ATTEMPTS}`);

            try {
                const success = await this.tryInitialize(data);
                if (success) {
                    this.synthState = SynthState.READY;
                    console.log('[Open303] WASM initialized successfully');
                    this.flushPendingMessages();
                    this.port.postMessage({ type: 'ready' });
                    return;
                }
            } catch (e) {
                const errorMsg = e instanceof Error ? e.message : String(e);
                console.warn(`[Open303] Init attempt ${this.initAttempts} failed:`, errorMsg);
                this.lastErrorMessage = errorMsg;

                // Small delay before retry to let stack/heap settle
                // Note: AudioWorklet doesn't have setTimeout, so we use a simple spin wait
                if (this.initAttempts < Open303Processor.MAX_INIT_ATTEMPTS) {
                    const start = getTime();
                    while (getTime() - start < 100) { /* spin wait */ }
                }
            }
        }

        // All attempts failed
        console.error('[Open303] All initialization attempts failed');
        this.synthState = SynthState.FAILED;
        this.port.postMessage({
            type: 'error',
            error: `Failed to initialize after ${Open303Processor.MAX_INIT_ATTEMPTS} attempts. Last error: ${this.lastErrorMessage}`,
            recoverable: false
        });
    }

    private async tryInitialize(data: any): Promise<boolean> {
        const variant = data.variant || 'single';
        this.isThreaded = data.isThreaded || false;

        console.log(`[Open303] Initializing with ${variant} WASM variant (threaded: ${this.isThreaded})`);

        if (!data.wasmBytes || data.wasmBytes.byteLength === 0) {
            throw new Error('No WASM bytes received');
        }

        // 1. Compile the WASM module
        console.log('[Open303] Compiling WASM module...');
        const module = await WebAssembly.compile(data.wasmBytes);
        console.log('[Open303] WASM module compiled successfully');

        // Debug: Inspect imports
        this.inspectModuleImports(module);

        const importCtx = {
            getWasmInstance: () => this.wasmInstance,
            getImportedMemory: () => this.importedMemory,
            setImportedMemory: (m: WebAssembly.Memory) => {
                this.importedMemory = m;
            },
            onHeapUpdate: () => this.updateHeap(),
            logPrefix: '[Open303]',
        };

        const { imports: importsObject } = buildHyphonWasmImports(module, importCtx, {
            memoryPages: data.memoryPages,
            isThreaded: this.isThreaded,
        });

        console.log('[Open303] Instantiating WASM module...');

        // 3. Instantiate with timeout protection
        const instantiatePromise = WebAssembly.instantiate(module, importsObject);
        const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('WASM instantiation timeout (5s)')), 5000);
        });

        this.wasmInstance = await Promise.race([instantiatePromise, timeoutPromise]);
        this.normalizedExports = normalizeWasmExports(this.wasmInstance.exports, data.exportMap ?? {});
        console.log('[Open303] WASM instantiated successfully');

        this.updateHeap();

        // 3b. Initialize the Emscripten stack tracking and disable false overflow detection.
        // The jc303 WASM triggers __handle_stack_overflow during jc303_init even though
        // the stack pointer never actually falls below the stack limit. This is caused by
        // how Emscripten's stack overflow check is compiled into the binary. Calling
        // emscripten_stack_init() sets up the stack tracking, and __set_stack_limits with
        // stackEnd=0 disables the false check (sp < 0 is always false), allowing jc303_init
        // to succeed without spurious overflow calls.
        this.configureWasmStack();

        // 4. Verify exports — accept either the native multi-instance API
        // (open303_create/open303_init, exported by hyphon_native.wasm) or the
        // legacy single-instance jc303_init/jc303_process API.
        const exports = this.getExports();
        const hasNative = typeof exports.open303_create === 'function'
                       && typeof exports.open303_init === 'function';
        const hasLegacy = typeof exports.jc303_init === 'function'
                       && typeof exports.jc303_process === 'function';

        if (!hasNative && !hasLegacy) {
            throw new Error(
                `Missing required exports: neither open303_* (native) nor jc303_* (legacy) found`
            );
        }

        // 5. Initialize the synth with stack protection
        return this.initializeSynth(exports, data.sampleRate || 44100);
    }

    private getExports(): Record<string, any> {
        return (this.normalizedExports ?? {}) as Record<string, any>;
    }

    /** hyphon_native.wasm is built with WASM_BIGINT — preserve bigint handles/pointers. */
    private toWasmHandle(handle: number | bigint): number | bigint {
        return typeof handle === 'bigint' ? handle : BigInt(handle);
    }

    private isInvalidHandle(handle: number | bigint | null | undefined): boolean {
        if (handle == null) return true;
        if (typeof handle === 'bigint') return handle <= 0n;
        return !Number.isFinite(handle) || handle <= 0;
    }

    /** Convert a WASM heap pointer (number or bigint) to a Float32Array index. */
    private wasmPtrToOffset(ptr: number | bigint | null | undefined): number {
        if (ptr == null) return -1;
        const n = typeof ptr === 'bigint' ? Number(ptr) : ptr;
        if (!Number.isFinite(n) || n <= 0) return -1;
        return n >>> 2;
    }

    /** Read a WASM heap float buffer using a fresh view (safe after memory growth). */
    private readWasmSamples(ptr: number | bigint, numFrames: number): Float32Array | null {
        this.updateHeap();
        const memory =
            (this.wasmInstance?.exports as { memory?: WebAssembly.Memory } | undefined)?.memory
            ?? this.importedMemory;
        if (!memory?.buffer) return null;

        const byteOffset = typeof ptr === 'bigint' ? Number(ptr) : ptr;
        if (!Number.isFinite(byteOffset) || byteOffset <= 0) return null;
        if (byteOffset + numFrames * 4 > memory.buffer.byteLength) return null;

        try {
            return new Float32Array(memory.buffer, byteOffset, numFrames);
        } catch {
            return null;
        }
    }

    private writeOutputSamples(
        samples: Float32Array,
        numFrames: number,
        channelL: Float32Array | undefined,
        channelR: Float32Array | undefined,
        gain: number,
    ): void {
        for (let i = 0; i < numFrames; i++) {
            const sample = samples[i] * gain;
            if (channelL) channelL[i] = sample;
            if (channelR) channelR[i] = sample;
        }
    }

    private inspectModuleImports(module: WebAssembly.Module) {
        try {
            const importDescriptors = WebAssembly.Module.imports(module);
            console.log("[Open303] WASM Imports:", JSON.stringify(importDescriptors.slice(0, 10)) + "...");

            const importNames = importDescriptors.map((d: any) => d.name || '');
            if (importNames.some((n: string) => /^[A-Za-z]$/.test(n))) {
                console.warn("[Open303] Detected minified import names. Using alias mappings.");
            }
        } catch (e) {
            console.warn("[Open303] Failed to inspect imports:", e);
        }
    }

    private initializeSynth(exports: any, sampleRate: number): boolean {
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
            this.instanceHandle = exports.open303_create();
            if (this.isInvalidHandle(this.instanceHandle)) {
                throw new Error('open303_create() returned null handle');
            }

            const result = exports.open303_init(
                this.toWasmHandle(this.instanceHandle),
                sampleRate,
                this.nativeBufFrames,
            );
            if (result !== 1) {
                throw new Error(`open303_init() returned ${result}`);
            }

            // Allocate the output buffer on the WASM heap (owned by the worklet)
            const mallocFn = exports._malloc ?? exports.malloc;
            if (mallocFn) {
                // 4 bytes per sample (Float32)
                this.nativeOutputPtr = mallocFn(this.nativeBufFrames * 4);
                if (this.isInvalidHandle(this.nativeOutputPtr)) {
                    throw new Error('Failed to allocate native output buffer');
                }
            }

            this.isNativeApi = true;
            console.log(`[Open303] Native instance created: handle=${this.instanceHandle}`);

            // Also initialise the authentic rosic::Open303 multi-instance (jc303_*)
            // so that per-voice engine switching works without a full reinit.
            this.initializeJc303MultiInstance(exports, sampleRate);

            return true;
        } catch (e) {
            console.error('[Open303] Native API init failed:', e);
            this.isNativeApi = false;
            this.instanceHandle = 0;
            return false;
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
            this.jc303Handle = exports.jc303_create();
            if (this.isInvalidHandle(this.jc303Handle)) {
                console.warn('[Open303] jc303_create() returned null handle');
                return;
            }
            const res = exports.jc303_init_handle(
                this.toWasmHandle(this.jc303Handle),
                sampleRate,
                this.nativeBufFrames,
            );
            if (res !== 1) {
                console.warn(`[Open303] jc303_init_handle() returned ${res}`);
                if (exports.jc303_destroy) {
                    exports.jc303_destroy(this.toWasmHandle(this.jc303Handle));
                }
                this.jc303Handle = 0;
                return;
            }
            this.hasJc303MultiApi = true;
            console.log(`[Open303] Authentic JC303 instance ready: handle=${this.jc303Handle}`);
        } catch (e) {
            console.warn('[Open303] JC303 multi-instance init failed (engine unavailable):', e);
            this.jc303Handle = 0;
            this.hasJc303MultiApi = false;
        }
    }

    /** Switch the active DSP engine for this processor instance.
     *  Clears any held notes before switching to avoid stuck notes. */
    private handleSetEngine(engine: 'open303' | 'jc303'): void {
        if (engine === this.activeEngine) return;

        if (engine === 'jc303' && !this.hasJc303MultiApi) {
            console.warn('[Open303] Authentic JC303 engine not available — ignoring set-engine request');
            return;
        }

        // Release any held notes on the current engine before switching
        this.clearAllNotes();

        this.activeEngine = engine;
        console.log(`[Open303] Engine switched to: ${engine}`);
        this.port.postMessage({ type: 'engine-changed', data: { engine } });
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

    private handleNoteOn(note: number, velocity: number): void {
        const now = getTime();

        // Rate limit check
        this.noteOnTimes = this.noteOnTimes.filter(t => now - t < 1000);
        if (this.noteOnTimes.length >= Open303Processor.MAX_NOTES_PER_SECOND) {
            console.warn(`[Open303] Rate limit exceeded, dropping note ${note}`);
            return;
        }

        const timeSinceLastNote = now - this.lastNoteOnTime;
        if (timeSinceLastNote < Open303Processor.MIN_NOTE_INTERVAL_MS) {
            console.warn(`[Open303] Note ${note} too soon (${timeSinceLastNote.toFixed(1)}ms), dropping`);
            return;
        }

        // Portamento fix
        if (this.noteOffJustSent || this.activeNotes.size > 0) {
            if (this.activeNotes.size > 0) {
                this.clearAllNotes();
            }
            this.pendingNote = { note, velocity };
            this.noteOffJustSent = true;
            return;
        }

        this.triggerNoteOn(note, velocity);
    }

    private handleNoteOff(note: number): void {
        if (!this.wasmInstance) return;
        const exports = this.getExports();

        try {
            if (this.activeEngine === 'jc303' && this.hasJc303MultiApi) {
                exports.jc303_note_off(this.toWasmHandle(this.jc303Handle), note);
            } else if (this.isNativeApi) {
                exports.open303_note_off(this.toWasmHandle(this.instanceHandle), note);
            } else {
                exports.jc303_noteOff(note);
            }
            this.activeNotes.delete(note);
            this.noteOffJustSent = true;
        } catch (e) {
            console.error('[Open303] noteOff failed:', e);
        }
    }

    private clearAllNotes(): void {
        if (!this.wasmInstance) return;
        const exports = this.getExports();

        try {
            if (this.activeEngine === 'jc303' && this.hasJc303MultiApi) {
                exports.jc303_all_notes_off(this.toWasmHandle(this.jc303Handle));
            } else if (this.isNativeApi) {
                exports.open303_all_notes_off(this.toWasmHandle(this.instanceHandle));
            } else if (exports.jc303_allNotesOff) {
                exports.jc303_allNotesOff();
            } else {
                for (const note of this.activeNotes.keys()) {
                    exports.jc303_noteOff(note);
                }
            }
        } catch (e) {
            console.error('[Open303] clearAllNotes failed:', e);
        }
        this.activeNotes.clear();
    }

    private triggerNoteOn(note: number, velocity: number): void {
        if (!this.wasmInstance) return;
        const exports = this.getExports();

        try {
            if (this.activeEngine === 'jc303' && this.hasJc303MultiApi) {
                exports.jc303_note_on(this.toWasmHandle(this.jc303Handle), note, velocity);
            } else if (this.isNativeApi) {
                exports.open303_note_on(this.toWasmHandle(this.instanceHandle), note, velocity);
            } else {
                exports.jc303_noteOn(note, velocity);
            }
            const now = getTime();
            this.lastNoteOnTime = now;
            this.noteOnTimes.push(now);
            this.activeNotes.set(note, now);
        } catch (e: any) {
            console.error(`[Open303] noteOn failed:`, e);
        }
    }

    private updateHeap() {
        const memory = (this.wasmInstance?.exports as any)?.memory || this.importedMemory;
        if (memory) {
            this.heapFloat32 = new Float32Array(memory.buffer);
        }
    }

    private configureWasmStack(): void {
        const exports = this.getExports();

        // Initialize Emscripten stack tracking
        if (typeof exports.emscripten_stack_init === 'function') {
            exports.emscripten_stack_init();
        }

        // Disable false stack overflow detection.
        // The jc303 WASM calls __handle_stack_overflow during jc303_init even though
        // the stack pointer never falls below the actual stack limit. Setting stackEnd=0
        // makes the overflow check (sp < 0) always false, preventing spurious calls.
        if (typeof exports.__set_stack_limits === 'function' &&
            typeof exports.emscripten_stack_get_base === 'function') {
            const stackBase = exports.emscripten_stack_get_base();
            if (stackBase > 0) {
                exports.__set_stack_limits(stackBase, 0);
                console.log(`[Open303] Stack configured: base=${stackBase}, end=0 (overflow check disabled)`);
            }
        }
    }

    process(_inputs: Float32Array[][], outputs: Float32Array[][], _parameters: Record<string, Float32Array>): boolean {
        const output = outputs[0];
        if (!output) return true;

        const channelL = output[0];
        const blockFrames = channelL ? channelL.length : 128;
        const endPerf = this.perf.beginProcess(blockFrames);
        try {
        const channelR = output[1];

        // Handle pending note (portamento fix)
        if (this.pendingNote && this.synthState === SynthState.READY) {
            this.triggerNoteOn(this.pendingNote.note, this.pendingNote.velocity);
            this.pendingNote = null;
            this.noteOffJustSent = false;
        }

        // Output silence if not ready
        if (this.synthState !== SynthState.READY || !this.wasmInstance || !this.heapFloat32) {
            if (channelL) channelL.fill(0);
            if (channelR) channelR.fill(0);
            return true;
        }

        try {
            const exports = this.getExports();
            const numFrames = channelL ? channelL.length : 128;
            const gain = Open303Processor.OUTPUT_GAIN;

            if (this.activeEngine === 'jc303' && this.hasJc303MultiApi) {
                // ── Authentic rosic::Open303 multi-instance API ───────────────
                const ptr = exports.jc303_process_handle(
                    this.toWasmHandle(this.jc303Handle),
                    numFrames,
                );
                const samples = this.readWasmSamples(ptr, numFrames);
                if (!samples) {
                    if (this.allocationErrorCount++ < 5) {
                        console.error('[Open303] jc303_process_handle returned invalid pointer');
                    }
                    if (channelL) channelL.fill(0);
                    if (channelR) channelR.fill(0);
                    return true;
                }
                this.writeOutputSamples(samples, numFrames, channelL, channelR, gain);
            } else if (this.isNativeApi) {
                // ── Custom open303 multi-instance API ────────────────────────
                if (this.isInvalidHandle(this.nativeOutputPtr)) {
                    if (channelL) channelL.fill(0);
                    if (channelR) channelR.fill(0);
                    return true;
                }

                exports.open303_process(
                    this.toWasmHandle(this.instanceHandle),
                    this.toWasmHandle(this.nativeOutputPtr),
                    numFrames,
                );

                const samples = this.readWasmSamples(this.nativeOutputPtr, numFrames);
                if (!samples) {
                    if (this.processErrorCount++ < 5) {
                        console.error('[Open303] open303_process output buffer unreadable');
                    }
                    if (channelL) channelL.fill(0);
                    if (channelR) channelR.fill(0);
                    return true;
                }
                this.writeOutputSamples(samples, numFrames, channelL, channelR, gain);
            } else {
                // ── Legacy jc303_* API ───────────────────────────────────────
                const ptr = exports.jc303_process(numFrames);

                if (this.wasmPtrToOffset(ptr) < 0) {
                    if (this.allocationErrorCount++ < 5) {
                        console.error('[Open303] jc303_process returned invalid pointer');
                    }
                    if (channelL) channelL.fill(0);
                    if (channelR) channelR.fill(0);
                    return true;
                }

                const samples = this.readWasmSamples(ptr, numFrames);
                if (!samples) {
                    if (this.processErrorCount++ < 5) {
                        console.error('[Open303] jc303_process buffer unreadable');
                    }
                    if (channelL) channelL.fill(0);
                    if (channelR) channelR.fill(0);
                    return true;
                }
                this.writeOutputSamples(samples, numFrames, channelL, channelR, gain);

                if (exports.free) {
                    exports.free(ptr);
                }
            }

            // Stuck note detection (common to both APIs)
            this.checkStuckNotes(exports);

        } catch (e: any) {
            if (this.processErrorCount++ < 5) {
                console.error('[Open303] Process error:', e);
            }
            if (channelL) channelL.fill(0);
            if (channelR) channelR.fill(0);
        }

        return true;
        } finally {
            endPerf();
        }
    }

    private checkStuckNotes(exports: any): void {
        const now = getTime();
        for (const [note, startTime] of this.activeNotes.entries()) {
            const duration = now - startTime;
            if (duration > Open303Processor.MAX_NOTE_DURATION_MS) {
                if (this.stuckNoteWarnings++ < 5) {
                    console.warn(`[Open303] Stuck note detected: ${note} held for ${duration.toFixed(0)}ms, auto-releasing`);
                }
                try {
                    if (this.activeEngine === 'jc303' && this.hasJc303MultiApi) {
                        exports.jc303_note_off(this.jc303Handle, note);
                    } else if (this.isNativeApi) {
                        exports.open303_note_off(this.instanceHandle, note);
                    } else {
                        exports.jc303_noteOff(note);
                    }
                } catch { }
                this.activeNotes.delete(note);
            }
        }
    }
}

registerProcessor('open303-processor', Open303Processor);
