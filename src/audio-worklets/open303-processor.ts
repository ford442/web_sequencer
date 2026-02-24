// src/audio-worklets/open303-processor.ts

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

class Open303Processor extends AudioWorkletProcessor {
    private wasmInstance: WebAssembly.Instance | null = null;
    private importedMemory: WebAssembly.Memory | null = null;
    private heapFloat32: Float32Array | null = null;
    private isWasmReady: boolean = false;
    private isThreaded: boolean = false;  // Track if we're using threaded variant

    // Gain compensation for 303 output level matching.
    // TB-303 emulations typically output at ~-12dB relative to standard
    // digital oscillators. A 4x multiplier brings the signal to ~0dB/-6dB.
    private static readonly OUTPUT_GAIN = 4.0;

    // Stuck note protection
    private activeNotes: Map<number, number> = new Map(); // note -> startTime (ms)
    private static readonly MAX_NOTE_DURATION_MS = 8000; // 8 seconds max note duration
    private static readonly _NOTE_CHECK_INTERVAL = 128 * 10; // Check every 10 process blocks (~1280 samples @ 44.1kHz)
    private _processBlockCount = 0;
    private stuckNoteWarnings = 0;

    // Stack protection - rate limit noteOn to prevent stack overflow
    private lastNoteOnTime = 0;
    private static readonly MIN_NOTE_INTERVAL_MS = 5; // Min 5ms between noteOn calls
    private static readonly MAX_NOTES_PER_SECOND = 50; // Max 50 notes/sec to prevent stack exhaustion
    private noteOnTimes: number[] = []; // Track recent noteOn times

    // Portamento/slide fix: delay noteOn until next process block after noteOff
    private pendingNote: { note: number; velocity: number } | null = null;
    private noteOffJustSent = false;

    constructor() {
        super();
        this.port.onmessage = this.handleMessage.bind(this);
    }

    private async handleMessage(event: MessageEvent) {
        const { type, data } = event.data;

        if (type === 'init-wasm') {
            try {
                const variant = data.variant || 'single';
                this.isThreaded = data.isThreaded || false;

                console.log(`[Open303] Initializing with ${variant} WASM variant (threaded: ${this.isThreaded})`);
                console.log(`[Open303] WASM bytes received: ${data.wasmBytes?.byteLength || 0} bytes`);

                if (!data.wasmBytes || data.wasmBytes.byteLength === 0) {
                    throw new Error('No WASM bytes received');
                }

                // 1. Compile the WASM module
                console.log('[Open303] Compiling WASM module...');
                const module = await WebAssembly.compile(data.wasmBytes);
                console.log('[Open303] WASM module compiled successfully');

                // DEBUG: Inspect imports to debug "module is not an object" error
                // This helps identify if the module expects 'env', 'a', 'wasi_snapshot_preview1', or something else.
                try {
                    const importDescriptors = WebAssembly.Module.imports(module);
                    console.log("[Open303] WASM Imports Requirement:", JSON.stringify(importDescriptors));

                    // If the module imports single-letter/minified names (e.g. "b"), the wasm
                    // was built with import minification. Recommend rebuilding with -O1 -g
                    // instead of -O3 -flto to avoid aggressive minification.
                    const importNames = importDescriptors.map((d: any) => d.name || '');
                    if (importNames.some((n: string) => /^[A-Za-z]$/.test(n))) {
                        console.warn(
                            "[Open303] Detected minified import names (e.g. 'b').",
                            "Rebuild jc303 with: -O1 -g (see tools/build_jc303_omp.sh)"
                        );
                    }
                } catch (e) {
                    console.warn("[Open303] Failed to inspect imports:", e);
                }

                // 2. Prepare Environment Imports
                // Support BOTH full names (from -O1 -g builds) AND minified names (from -O3 -flto builds)
                // The WASM may import from 'env' or 'a' namespace with single-letter function names

                const resizeHeap = (size: number) => {
                    const memory = this.wasmInstance?.exports?.memory as WebAssembly.Memory || this.importedMemory;
                    if (!memory) {
                        console.warn('[Open303] emscripten_resize_heap called but no memory available yet');
                        return 0;
                    }
                    const currentPages = memory.buffer.byteLength / (64 * 1024);
                    const targetPages = Math.ceil(size / (64 * 1024));
                    const deltaPages = targetPages - currentPages;
                    if (deltaPages > 0) {
                        try {
                            memory.grow(deltaPages);
                            console.log(`[Open303] Heap grown from ${currentPages} to ${currentPages + deltaPages} pages`);
                            this.updateHeap();
                            return 1;
                        } catch (e) {
                            console.error('[Open303] Failed to grow heap:', e);
                            return 0;
                        }
                    }
                    return 1;
                };

                const env: any = {
                    // Core runtime - full names
                    _abort_js: () => console.error("WASM Abort"),
                    abort: () => console.error("WASM Abort"),

                    // Stack overflow and fault handlers (required by newer Emscripten builds)
                    // CRITICAL FIX: These handlers prevent AudioContext death from WASM faults
                    __handle_stack_overflow: () => {
                        const err = new Error("[Open303] Stack overflow detected");
                        console.error(err.message);
                        if (err.stack) console.error(err.stack);
                        // inform the main thread so UI can surface a warning
                        try {
                            this.port.postMessage({ type: 'error', error: err.message + '\n' + (err.stack || '') });
                        } catch { }
                        // Don't crash - just log and continue
                        // The WASM may be in an undefined state, but we prevent AudioContext death
                        return 0;
                    },
                    segfault: () => {
                        const err = new Error("[Open303] Segmentation fault");
                        console.error(err.message);
                        if (err.stack) console.error(err.stack);
                        try { this.port.postMessage({ type: 'error', error: err.message + '\n' + (err.stack || '') }); } catch { }
                        return 0;
                    },
                    alignfault: () => {
                        const err = new Error("[Open303] Alignment fault");
                        console.error(err.message);
                        if (err.stack) console.error(err.stack);
                        try { this.port.postMessage({ type: 'error', error: err.message + '\n' + (err.stack || '') }); } catch { }
                        return 0;
                    },

                    // Core runtime - minified names (a-o based on typical Emscripten output)
                    a: () => console.error("WASM Abort"),
                    b: () => console.error("WASM Abort"),

                    // Memory management - full names
                    emscripten_resize_heap: resizeHeap,
                    _emscripten_resize_heap: resizeHeap,

                    // Memory management - minified names
                    c: resizeHeap,  // often emscripten_resize_heap
                    d: resizeHeap,  // often _emscripten_resize_heap

                    // Memory growth notification
                    emscripten_notify_memory_growth: () => this.updateHeap(),
                    e: () => this.updateHeap(),  // minified

                    // Math functions - full names
                    exp: Math.exp,
                    pow: Math.pow,
                    sin: Math.sin,
                    cos: Math.cos,
                    fmod: (x: number, y: number) => x % y,

                    // Math functions - minified names
                    f: Math.exp,
                    g: Math.pow,
                    h: Math.sin,
                    i: Math.cos,
                    j: (x: number, y: number) => x % y,

                    // Threading (for OMP) - full names
                    _emscripten_thread_set_strongref: () => { },
                    emscripten_exit_with_live_runtime: () => { },
                    _emscripten_notify_mailbox_postmessage: () => { },
                    emscripten_check_blocking_allowed: () => { },
                    _emscripten_receive_on_main_thread_js: () => { },
                    _emscripten_init_main_thread_js: () => { },
                    _emscripten_thread_mailbox_await: () => { },
                    _emscripten_thread_cleanup: () => { },
                    _setitimer_js: () => { },
                    _emscripten_runtime_keepalive_clear: () => { },

                    // Threading - minified names
                    k: () => { }, l: () => { }, m: () => { }, n: () => { },
                    o: () => { }, p: () => { }, q: () => { }, r: () => { },
                    s: () => { }, t: () => { },

                    // Time - full names
                    clock_time_get: () => Date.now() * 1000000,
                    emscripten_get_now: () => performance.now(),

                    // Time - minified
                    u: () => Date.now() * 1000000,
                    v: () => performance.now(),

                    // Embind - full names
                    _embind_register_function: () => { },
                    _embind_register_void: () => { },
                    _embind_register_bool: () => { },
                    _embind_register_std_string: () => { },
                    _embind_register_std_wstring: () => { },
                    _embind_register_emval: () => { },
                    _embind_register_integer: () => { },
                    _embind_register_bigint: () => { },
                    _embind_register_float: () => { },
                    _embind_register_memory_view: () => { },

                    // Embind - minified
                    w: () => { }, x: () => { }, y: () => { }, z: () => { },
                    A: () => { }, B: () => { }, C: () => { }, D: () => { },
                    E: () => { }, F: () => { },
                };

                // Log what we're providing for debugging
                console.log("[Open303] env keys:", Object.keys(env).slice(0, 20) + "...");

                // Verify critical minified imports are callable
                const testImports = ['a', 'b', 'c', 'd', 'e'];
                for (const key of testImports) {
                    if (typeof env[key] !== 'function') {
                        console.warn(`[Open303] env.${key} is not a function:`, typeof env[key]);
                    }
                }

                // WASI imports required by the WASM
                const wasiImports: any = {
                    proc_exit: (code: number) => {
                        console.warn(`[Open303] WASI proc_exit called with code ${code}`);
                    },
                    fd_close: () => 0,
                    fd_write: () => 0,
                    fd_seek: () => 0,
                    fd_read: () => 0,
                    path_open: () => 0,
                    path_filestat_get: () => 0,
                    path_unlink_file: () => 0,
                    path_create_directory: () => 0,
                    path_remove_directory: () => 0,
                    path_rename: () => 0,
                    path_symlink: () => 0,
                    path_readlink: () => 0,
                    path_link: () => 0,
                    path_filestat_set_times: () => 0,
                    fd_fdstat_get: () => 0,
                    fd_prestat_get: () => 0,
                    fd_prestat_dir_name: () => 0,
                    environ_sizes_get: () => 0,
                    environ_get: () => 0,
                    args_sizes_get: () => 0,
                    args_get: () => 0,
                    clock_res_get: () => 0,
                    clock_time_get: (_id: number, _precision: number, _ptr: number) => {
                        // const now = BigInt(Date.now() * 1000000); // nanoseconds
                        // Would need to write to memory at ptr, but we don't have memory yet
                        return 0;
                    },
                    random_get: () => 0,
                    sched_yield: () => 0,
                    poll_oneoff: () => 0,
                };

                // Construct the imports object explicitly
                // Support both 'env' and 'a' namespaces (minified builds use 'a')
                const importsObject: any = {
                    env: env,
                    a: env,
                    wasi_snapshot_preview1: wasiImports,
                    wasi_unstable: wasiImports,
                    "": env
                };

                // Check if WASM imports memory or exports it
                // Also get all imports for dynamic namespace mapping
                const imports = WebAssembly.Module.imports(module);

                // Dynamic import mapping: for each unique import module, provide the env
                // This handles cases where WASM was built with different minification settings
                const uniqueModules = new Set(imports.map((i: any) => i.module));
                for (const mod of uniqueModules) {
                    if (!importsObject[mod]) {
                        console.log(`[Open303] Adding dynamic import namespace: ${mod}`);
                        importsObject[mod] = env;
                    }
                }
                const memoryImport = imports.find(i => i.kind === 'memory');

                if (memoryImport) {
                    // WASM expects imported memory - create it
                    // CRITICAL FIX: Increased memory pages to prevent stack overflow
                    // STACK_SIZE is 2MB (2097152 bytes) in CMakeLists.txt
                    // We need at least 2MB + headroom for stack + heap
                    const memoryImportPages = (data && data.memoryPages) || 512; // 512 pages = 32MB minimum
                    const maxMemoryPages = 2048; // 2048 pages = 128MB max (allows heap growth)
                    let mem: WebAssembly.Memory;

                    if (this.isThreaded) {
                        // Threaded variant requires shared memory
                        try {
                            mem = new WebAssembly.Memory({
                                initial: memoryImportPages,
                                maximum: maxMemoryPages,
                                shared: true
                            });
                            console.log(`[Open303] Created SHARED memory for ${memoryImport.module}.${memoryImport.name} — ${memoryImportPages} pages (max: ${maxMemoryPages})`);
                        } catch (e) {
                            console.error(`[Open303] SharedArrayBuffer not available for threaded variant:`, e);
                            this.port.postMessage({
                                type: 'error',
                                error: 'SharedArrayBuffer not available. Ensure Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy headers are configured correctly on your web server.'
                            });
                            return;
                        }
                    } else {
                        // Single-threaded uses regular memory
                        mem = new WebAssembly.Memory({
                            initial: memoryImportPages,
                            maximum: maxMemoryPages
                        });
                        console.log(`[Open303] Created non-shared memory for ${memoryImport.module}.${memoryImport.name} — ${memoryImportPages} pages (max: ${maxMemoryPages})`);
                    }

                    this.importedMemory = mem;

                    // Attach to the correct import namespace
                    if (!importsObject[memoryImport.module]) importsObject[memoryImport.module] = {};
                    importsObject[memoryImport.module][memoryImport.name] = mem;
                } else {
                    console.log('[Open303] WASM exports its own memory (no import needed)');
                }

                console.log('[Open303] Instantiating WASM module...');
                console.log('[Open303] Import object modules:', Object.keys(importsObject));

                // Set a timeout for instantiation in case it hangs
                const instantiatePromise = WebAssembly.instantiate(module, importsObject);
                const timeoutPromise = new Promise<never>((_, reject) => {
                    setTimeout(() => reject(new Error('WASM instantiation timeout (5s)')), 5000);
                });

                this.wasmInstance = await Promise.race([instantiatePromise, timeoutPromise]);
                console.log('[Open303] WASM instantiated successfully');

                // Ensure updateHeap() can see either the exported memory or the imported one
                this.updateHeap();

                // 4. Initialize the DSP in the WASM
                const exports = this.wasmInstance.exports as any;

                // Debug exports
                console.log("[Open303] WASM Exports:", Object.keys(exports));

                // Check for required functions
                const hasInit = typeof exports.jc303_init === 'function';
                const hasProcess = typeof exports.jc303_process === 'function';
                const hasNoteOn = typeof exports.jc303_noteOn === 'function';
                const hasNoteOff = typeof exports.jc303_noteOff === 'function';

                console.log(`[Open303] Required functions: init=${hasInit}, process=${hasProcess}, noteOn=${hasNoteOn}, noteOff=${hasNoteOff}`);

                if (!hasInit || !hasProcess) {
                    throw new Error(`Missing required functions: jc303_init=${hasInit}, jc303_process=${hasProcess}`);
                }

                // CRITICAL FIX: Wrap init in try/catch with recovery for stack overflow protection
                // The C++ constructor initializes many nested objects (oscillators, filters, wavetables)
                // which can blow the default 64KB stack. STACK_SIZE=2097152 should prevent this.
                let initSuccess = false;
                let lastError: Error | null = null;

                // Try progressively smaller buffer sizes to reduce stack pressure
                const bufferSizes = [128, 64, 32, 16];
                const sampleRate = data.sampleRate || 44100;

                for (const bufferSize of bufferSizes) {
                    try {
                        console.log(`[Open303] Attempting init with bufferSize=${bufferSize}...`);
                        exports.jc303_init(sampleRate, bufferSize);
                        console.log(`[Open303] Initialized successfully with sampleRate=${sampleRate}, bufferSize=${bufferSize}`);
                        initSuccess = true;
                        break;
                    } catch (initError) {
                        lastError = initError as Error;
                        console.warn(`[Open303] init failed with bufferSize=${bufferSize}:`, initError);
                        // Small delay to let stack unwind
                        await new Promise(r => setTimeout(r, 10));
                    }
                }

                if (!initSuccess) {
                    console.error('[Open303] All init attempts failed. Stack overflow likely.');
                    console.error('[Open303] Last error:', lastError);
                    console.warn('[Open303] Bass synthesis will be unavailable. Consider rebuilding WASM with: -s STACK_SIZE=2097152');
                    // Don't throw - let the worklet initialize in "degraded" mode
                    // The main thread will detect failure via the error message
                    this.port.postMessage({
                        type: 'error',
                        error: `Stack overflow during init. Rebuild with: emcc -s STACK_SIZE=2097152`,
                        recoverable: false
                    });
                    return;
                }

                this.isWasmReady = true;
                console.log('[Open303] Sending ready message');
                this.port.postMessage({ type: 'ready' });
            } catch (e) {
                const errorMsg = e instanceof Error ? e.message : String(e);
                console.error("[Open303] Worklet Error:", errorMsg);
                this.port.postMessage({ type: 'error', error: errorMsg });
            }
        }

        // Handling messages after initialization
        if (this.isWasmReady && this.wasmInstance) {
            const exports = this.wasmInstance.exports as any;

            if (type === 'noteOn' && exports.jc303_noteOn) {
                const now = getTime();

                // Stack protection: rate limit noteOn calls
                // Remove old entries (> 1 second ago)
                this.noteOnTimes = this.noteOnTimes.filter(t => now - t < 1000);

                // Check rate limits
                if (this.noteOnTimes.length >= Open303Processor.MAX_NOTES_PER_SECOND) {
                    console.warn(`[Open303] Rate limit exceeded: ${this.noteOnTimes.length} notes/sec, dropping note ${data.note}`);
                    return;
                }

                const timeSinceLastNote = now - this.lastNoteOnTime;
                if (timeSinceLastNote < Open303Processor.MIN_NOTE_INTERVAL_MS) {
                    console.warn(`[Open303] Note ${data.note} too soon (${timeSinceLastNote.toFixed(1)}ms < ${Open303Processor.MIN_NOTE_INTERVAL_MS}ms), dropping`);
                    return;
                }

                // Portamento fix: If we just sent noteOff, delay this noteOn to next process block
                if (this.noteOffJustSent || this.activeNotes.size > 0) {
                    // Clear any active notes first
                    if (this.activeNotes.size > 0) {
                        this.clearAllNotes();
                    }
                    // Queue note for next process block to prevent portamento slide
                    this.pendingNote = { note: data.note, velocity: data.velocity };
                    this.noteOffJustSent = true;
                    return;
                }

                // Safe to trigger note immediately
                this.triggerNoteOn(data.note, data.velocity);
            }
            if (type === 'noteOff' && exports.jc303_noteOff) {
                exports.jc303_noteOff(data.note);
                this.activeNotes.delete(data.note);
                this.noteOffJustSent = true;
            }
            if (type === 'param' && exports[data.func]) {
                exports[data.func](data.value);
            }
        }
    }

    private clearAllNotes(): void {
        if (!this.wasmInstance) return;
        const exports = this.wasmInstance.exports as any;
        if (!exports.jc303_noteOff) return;

        for (const note of this.activeNotes.keys()) {
            exports.jc303_noteOff(note);
        }
        this.activeNotes.clear();
    }

    private triggerNoteOn(note: number, velocity: number): void {
        if (!this.wasmInstance) return;
        const exports = this.wasmInstance.exports as any;
        if (!exports.jc303_noteOn) return;

        try {
            exports.jc303_noteOn(note, velocity);
            const now = getTime();
            this.lastNoteOnTime = now;
            this.noteOnTimes.push(now);
            this.activeNotes.set(note, now);
        } catch (e: any) {
            console.error(`[Open303] noteOn failed (possible stack overflow):`, e);
            if (e && e.stack) console.error(e.stack);
            // dump some helpful runtime state
            console.error('[Open303] wasmInstance exports keys', Object.keys(exports));
            const currentTime = getTime();
            for (const [note, startTime] of this.activeNotes.entries()) {
                const duration = currentTime - startTime;
                if (duration > Open303Processor.MAX_NOTE_DURATION_MS) {
                    if (this.stuckNoteWarnings++ < 5) {
                        console.warn(`[Open303] Stuck note detected: ${note} held for ${duration.toFixed(0)}ms, auto-releasing`);
                    }
                    exports.jc303_noteOff(note);
                    this.activeNotes.delete(note);
                }
            }
        }
    }

    private updateHeap() {
        // Get memory from exports (preferred) or fall back to imported memory.
        // importedMemory is available before wasmInstance during instantiation,
        // which is critical for emscripten_resize_heap calls from C++ constructors.
        const memory = (this.wasmInstance?.exports as any)?.memory || this.importedMemory;

        if (memory) {
            this.heapFloat32 = new Float32Array(memory.buffer);
        }
    }

    private processErrorCount = 0;
    private allocationErrorCount = 0;

    process(_inputs: Float32Array[][], outputs: Float32Array[][], _parameters: Record<string, Float32Array>): boolean {
        const output = outputs[0];
        if (!output) return true;

        const channelL = output[0];
        const channelR = output[1];

        // Portamento fix: trigger pending note after noteOff has been processed
        if (this.pendingNote && this.isWasmReady) {
            this.triggerNoteOn(this.pendingNote.note, this.pendingNote.velocity);
            this.pendingNote = null;
            this.noteOffJustSent = false;
        }

        if (!this.isWasmReady || !this.wasmInstance || !this.heapFloat32) {
            // Output silence if not ready
            if (channelL) channelL.fill(0);
            if (channelR) channelR.fill(0);
            return true;
        }

        try {
            const exports = this.wasmInstance.exports as any;
            const processFunc = exports.jc303_process;

            if (processFunc) {
                // Ask WASM to process 128 samples (standard audio block size)
                // NOTE: jc303_process allocates a new buffer on every call using 'new float[numSamples]'.
                // This can exhaust the WASM heap over time. The emscripten_resize_heap function
                // above allows the heap to grow to accommodate this.
                const ptr = processFunc(128);

                if (ptr === 0 || ptr === undefined) {
                    // Invalid pointer - likely allocation failure
                    if (this.allocationErrorCount++ < 5) {
                        console.error('[Open303] jc303_process returned invalid pointer (likely memory allocation failure). Count:', this.allocationErrorCount);
                    }
                    if (channelL) channelL.fill(0);
                    if (channelR) channelR.fill(0);
                    return true;
                }

                // Pointer is in bytes, divide by 4 for Float32 index
                const offset = ptr >> 2;

                // Safety check
                if (offset >= 0 && offset + 128 <= this.heapFloat32.length) {
                    const gain = Open303Processor.OUTPUT_GAIN;
                    for (let i = 0; i < 128; i++) {
                        const sample = this.heapFloat32[offset + i] * gain;
                        if (channelL) channelL[i] = sample;
                        if (channelR) channelR[i] = sample;
                    }
                } else {
                    if (this.processErrorCount++ < 5) {
                        console.error(`[Open303] Heap overflow: offset=${offset}, length=${this.heapFloat32.length}`);
                    }
                    if (channelL) channelL.fill(0);
                    if (channelR) channelR.fill(0);
                }

                // Free the allocated buffer to prevent memory leak
                if (exports._free) {
                    exports._free(ptr);
                }
            } else {
                // No process function - output silence
                if (channelL) channelL.fill(0);
                if (channelR) channelR.fill(0);
            }
        } catch (e: any) {
            if (this.processErrorCount++ < 5) {
                console.error('[Open303] Process error:', e);
                if (e.stack) console.error(e.stack);
            }
            if (channelL) channelL.fill(0);
            if (channelR) channelR.fill(0);
        }

        return true;
    }
}

registerProcessor('open303-processor', Open303Processor);
