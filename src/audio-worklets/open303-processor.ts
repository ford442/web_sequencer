// src/audio-worklets/open303-processor.ts
// Hardened version with stack overflow protection and graceful degradation

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

class Open303Processor extends AudioWorkletProcessor {
    private wasmInstance: WebAssembly.Instance | null = null;
    private importedMemory: WebAssembly.Memory | null = null;
    private heapFloat32: Float32Array | null = null;
    private synthState: SynthStateType = SynthState.UNINITIALIZED;
    private isThreaded: boolean = false;

    // Gain compensation for 303 output level matching.
    private static readonly OUTPUT_GAIN = 4.0;

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

        // Handle messages only if ready
        if (this.synthState === SynthState.READY && this.wasmInstance) {
            const exports = this.wasmInstance.exports as any;

            if (type === 'noteOn' && exports.jc303_noteOn) {
                this.handleNoteOn(data.note, data.velocity);
            } else if (type === 'noteOff' && exports.jc303_noteOff) {
                this.handleNoteOff(data.note);
            } else if (type === 'param' && exports[data.func]) {
                exports[data.func](data.value);
            }
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

        // 2. Prepare Environment Imports
        const env = this.createEnvironmentImports();
        const wasiImports = this.createWASIImports();

        // Construct the imports object
        const importsObject: any = {
            env: env,
            a: env,
            wasi_snapshot_preview1: wasiImports,
            wasi_unstable: wasiImports,
            "": env
        };

        // Dynamic import mapping
        const imports = WebAssembly.Module.imports(module);
        const uniqueModules = new Set(imports.map((i: any) => i.module));
        for (const mod of uniqueModules) {
            if (!importsObject[mod]) {
                console.log(`[Open303] Adding dynamic import namespace: ${mod}`);
                importsObject[mod] = env;
            }
        }

        // Check for memory import
        const memoryImport = imports.find((i: any) => i.kind === 'memory');
        if (memoryImport) {
            this.importedMemory = this.createMemory(data.memoryPages, this.isThreaded);
            if (!importsObject[memoryImport.module]) importsObject[memoryImport.module] = {};
            importsObject[memoryImport.module][memoryImport.name] = this.importedMemory;
        }

        console.log('[Open303] Instantiating WASM module...');

        // 3. Instantiate with timeout protection
        const instantiatePromise = WebAssembly.instantiate(module, importsObject);
        const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('WASM instantiation timeout (5s)')), 5000);
        });

        this.wasmInstance = await Promise.race([instantiatePromise, timeoutPromise]);
        console.log('[Open303] WASM instantiated successfully');

        this.updateHeap();

        // 4. Verify exports
        const exports = this.wasmInstance.exports as any;
        const hasInit = typeof exports.jc303_init === 'function';
        const hasProcess = typeof exports.jc303_process === 'function';

        if (!hasInit || !hasProcess) {
            throw new Error(`Missing required functions: jc303_init=${hasInit}, jc303_process=${hasProcess}`);
        }

        // 5. Initialize the synth with stack protection
        return this.initializeSynth(exports, data.sampleRate || 44100);
    }

    private createMemory(pages: number | undefined, shared: boolean): WebAssembly.Memory {
        // CRITICAL FIX: Large initial memory to prevent stack overflow
        // 32MB stack + 32MB heap minimum = 1024 pages (64MB)
        const memoryImportPages = pages || 1024;
        const maxMemoryPages = 4096; // 256MB max

        if (shared) {
            try {
                return new WebAssembly.Memory({
                    initial: memoryImportPages,
                    maximum: maxMemoryPages,
                    shared: true
                });
            } catch (e) {
                throw new Error('SharedArrayBuffer not available. Ensure COOP/COEP headers are configured.');
            }
        } else {
            return new WebAssembly.Memory({
                initial: memoryImportPages,
                maximum: maxMemoryPages
            });
        }
    }

    private createEnvironmentImports(): any {
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

        // CRITICAL FIX: Stack overflow handler that doesn't throw
        const handleStackOverflow = () => {
            const err = new Error("[Open303] Stack overflow detected in WASM");
            console.error(err.message);
            // Post message but don't throw - let the init retry logic handle it
            try {
                this.port.postMessage({ type: 'stack-overflow', error: err.message });
            } catch { }
            return 0;
        };

        const env: any = {
            // Core runtime
            _abort_js: () => console.error("WASM Abort"),
            abort: () => console.error("WASM Abort"),

            // Stack overflow and fault handlers
            __handle_stack_overflow: handleStackOverflow,
            segfault: () => {
                console.error("[Open303] Segmentation fault");
                return 0;
            },
            alignfault: () => {
                console.error("[Open303] Alignment fault");
                return 0;
            },

            // Memory management
            emscripten_resize_heap: resizeHeap,
            _emscripten_resize_heap: resizeHeap,
            emscripten_notify_memory_growth: () => this.updateHeap(),

            // Math functions
            exp: Math.exp,
            pow: Math.pow,
            sin: Math.sin,
            cos: Math.cos,
            fmod: (x: number, y: number) => x % y,

            // ASYNCIFY invoke functions (required when WASM is built with -s ASYNCIFY)
            // These are used by Emscripten's asyncify mechanism
            invoke_ii: (index: number, a1: number) => {
                // Get the function from the table and call it
                const exports = this.wasmInstance?.exports as any;
                const table = exports.__indirect_function_table as WebAssembly.Table;
                const func = table.get(index) as Function;
                return func(a1);
            },
            invoke_vi: (index: number, a1: number) => {
                const exports = this.wasmInstance?.exports as any;
                const table = exports.__indirect_function_table as WebAssembly.Table;
                const func = table.get(index) as Function;
                func(a1);
            },
            invoke_vii: (index: number, a1: number, a2: number) => {
                const exports = this.wasmInstance?.exports as any;
                const table = exports.__indirect_function_table as WebAssembly.Table;
                const func = table.get(index) as Function;
                func(a1, a2);
            },
            invoke_vid: (index: number, a1: number, a2: number) => {
                const exports = this.wasmInstance?.exports as any;
                const table = exports.__indirect_function_table as WebAssembly.Table;
                const func = table.get(index) as Function;
                func(a1, a2);
            },
            invoke_dddddd: (index: number, a1: number, a2: number, a3: number, a4: number, a5: number) => {
                const exports = this.wasmInstance?.exports as any;
                const table = exports.__indirect_function_table as WebAssembly.Table;
                const func = table.get(index) as Function;
                return func(a1, a2, a3, a4, a5);
            },

            // Threading (stubs for single-threaded)
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

            // Time
            clock_time_get: () => Date.now() * 1000000,
            emscripten_get_now: () => performance.now(),

            // Embind stubs
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
        };

        // Add minified aliases (a-z, A-F)
        const aliases: Record<string, any> = {
            'a': () => console.error("WASM Abort"),
            'b': () => console.error("WASM Abort"),
            'c': resizeHeap,
            'd': resizeHeap,
            'e': () => this.updateHeap(),
            'f': Math.exp,
            'g': Math.pow,
            'h': Math.sin,
            'i': Math.cos,
            'j': (x: number, y: number) => x % y,
        };
        for (let i = 0; i < 26; i++) {
            const key = String.fromCharCode(97 + i); // a-z
            if (!env[key]) env[key] = aliases[key] || (() => { });
        }

        return env;
    }

    private createWASIImports(): any {
        return {
            proc_exit: () => { },
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
            clock_time_get: () => 0,
            random_get: () => 0,
            sched_yield: () => 0,
            poll_oneoff: () => 0,
        };
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
        // Try with progressively smaller buffer sizes to reduce stack pressure
        const bufferSizes = [128, 64, 32, 16];

        for (const bufferSize of bufferSizes) {
            try {
                console.log(`[Open303] Attempting jc303_init with bufferSize=${bufferSize}...`);
                const result = exports.jc303_init(sampleRate, bufferSize);

                if (result === 1) {
                    console.log(`[Open303] Initialized successfully with sampleRate=${sampleRate}, bufferSize=${bufferSize}`);
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
        const exports = this.wasmInstance.exports as any;

        try {
            exports.jc303_noteOff(note);
            this.activeNotes.delete(note);
            this.noteOffJustSent = true;
        } catch (e) {
            console.error('[Open303] noteOff failed:', e);
        }
    }

    private clearAllNotes(): void {
        if (!this.wasmInstance) return;
        const exports = this.wasmInstance.exports as any;

        try {
            if (exports.jc303_allNotesOff) {
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
        const exports = this.wasmInstance.exports as any;

        try {
            exports.jc303_noteOn(note, velocity);
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

    process(_inputs: Float32Array[][], outputs: Float32Array[][], _parameters: Record<string, Float32Array>): boolean {
        const output = outputs[0];
        if (!output) return true;

        const channelL = output[0];
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
            const exports = this.wasmInstance.exports as any;
            const ptr = exports.jc303_process(128);

            if (ptr === 0 || ptr === undefined) {
                if (this.allocationErrorCount++ < 5) {
                    console.error('[Open303] jc303_process returned invalid pointer');
                }
                if (channelL) channelL.fill(0);
                if (channelR) channelR.fill(0);
                return true;
            }

            const offset = ptr >> 2;
            const gain = Open303Processor.OUTPUT_GAIN;

            // Safety check
            if (offset >= 0 && offset + 128 <= this.heapFloat32.length) {
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

            // Free the allocated buffer
            if (exports._free) {
                exports._free(ptr);
            }

            // Stuck note detection
            this.checkStuckNotes(exports);

        } catch (e: any) {
            if (this.processErrorCount++ < 5) {
                console.error('[Open303] Process error:', e);
            }
            if (channelL) channelL.fill(0);
            if (channelR) channelR.fill(0);
        }

        return true;
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
                    exports.jc303_noteOff(note);
                } catch { }
                this.activeNotes.delete(note);
            }
        }
    }
}

registerProcessor('open303-processor', Open303Processor);
