// src/audio-worklets/open303-processor.ts

// Definitions for the AudioWorklet scope
declare class AudioWorkletProcessor {
    readonly port: MessagePort;
    process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}

declare function registerProcessor(name: string, processorCtor: new () => AudioWorkletProcessor): void;

class Open303Processor extends AudioWorkletProcessor {
    private wasmInstance: WebAssembly.Instance | null = null;
    private importedMemory: WebAssembly.Memory | null = null;
    private heapFloat32: Float32Array | null = null;
    private isWasmReady: boolean = false;
    private isThreaded: boolean = false;  // Track if we're using threaded variant

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
                // We define the standard Emscripten imports plus stubs for runtime safety.
                // Based on the rebuilt WASM with -O1 -g, the imports are now full names.
                const env: any = {
                    // Core runtime
                    _abort_js: () => console.error("WASM Abort"),
                    abort: () => console.error("WASM Abort"),  // fallback alias
                    b: () => console.error("WASM Abort"),  // TODO: remove after confirming no minified builds exist

                    // Memory management - allow heap growth
                    // NOTE: These functions are called during WASM instantiation, so we need to
                    // handle the case where wasmInstance isn't set yet
                    emscripten_resize_heap: (size: number) => {
                        // During instantiation, we may not have wasmInstance yet
                        // Use the imported memory if available
                        const memory = this.importedMemory;
                        if (!memory) {
                            console.warn('[Open303] emscripten_resize_heap called but no memory available yet');
                            return false;
                        }
                        
                        const currentPages = memory.buffer.byteLength / (64 * 1024);
                        const targetPages = Math.ceil(size / (64 * 1024));
                        const deltaPages = targetPages - currentPages;
                        
                        if (deltaPages > 0) {
                            try {
                                memory.grow(deltaPages);
                                console.log(`[Open303] Heap grown from ${currentPages} to ${currentPages + deltaPages} pages`);
                                this.updateHeap();
                                return true;
                            } catch (e) {
                                console.error('[Open303] Failed to grow heap:', e);
                                return false;
                            }
                        }
                        return true;
                    },
                    _emscripten_resize_heap: (size: number) => { 
                        return env.emscripten_resize_heap(size);
                    },

                    // Emscripten Runtime Stubs (Prevent crashes on missing symbols)
                    emscripten_notify_memory_growth: () => this.updateHeap(),

                    // Math functions
                    exp: Math.exp,
                    pow: Math.pow,
                    sin: Math.sin,
                    cos: Math.cos,
                    fmod: (x: number, y: number) => x % y,

                    // Threading (for OMP)
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
                    clock_time_get: () => Date.now() * 1000000, // nanoseconds
                    emscripten_get_now: () => performance.now(),

                    // Embind (for C++ bindings)
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

                    // 3. Instantiate with Alias
                    // Emscripten -O3 builds often minify 'env' to 'a'. We provide both to be safe.
                    // We also add WASI aliases because modern Emscripten might use them.
                };

                console.log("[Open303] Instantiating with env keys:", Object.keys(env));

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
                const importsObject: any = {
                    env: env,
                    a: env,
                    wasi_snapshot_preview1: wasiImports,
                    wasi_unstable: wasiImports,
                    "": env
                };

                // Check if WASM imports memory or exports it
                const imports = WebAssembly.Module.imports(module);
                const memoryImport = imports.find(i => i.kind === 'memory');
                
                if (memoryImport) {
                    // WASM expects imported memory - create it
                    const memoryImportPages = (data && data.memoryPages) || 512; // 512 pages = 32MB (increased from 256 to prevent memory errors)
                    const maxMemoryPages = 1024; // 1024 pages = 64MB (allows heap growth)
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

                // Initialize the synthesizer
                const sampleRate = data.sampleRate || 44100;
                exports.jc303_init(sampleRate, 128);
                console.log(`[Open303] Initialized with sampleRate=${sampleRate}`);

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
                exports.jc303_noteOn(data.note, data.velocity);
            }
            if (type === 'noteOff' && exports.jc303_noteOff) {
                exports.jc303_noteOff(data.note);
            }
            if (type === 'param' && exports[data.func]) {
                exports[data.func](data.value);
            }
        }
    }

    private updateHeap() {
        if (!this.wasmInstance) return;
        
        // Get memory from exports (preferred) or fall back to imported memory
        const exports = this.wasmInstance.exports as any;
        const memory = exports.memory || this.importedMemory;
        
        if (memory) {
            this.heapFloat32 = new Float32Array(memory.buffer);
            console.log('[Open303] Heap updated, memory size:', memory.buffer.byteLength);
        } else {
            console.error('[Open303] No memory available for heap');
        }
    }

    private processErrorCount = 0;
    private allocationErrorCount = 0;
    
    process(_inputs: Float32Array[][], outputs: Float32Array[][], _parameters: Record<string, Float32Array>): boolean {
        const output = outputs[0];
        if (!output) return true;

        const channelL = output[0];
        const channelR = output[1];

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
                    for (let i = 0; i < 128; i++) {
                        const sample = this.heapFloat32[offset + i];
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
            } else {
                // No process function - output silence
                if (channelL) channelL.fill(0);
                if (channelR) channelR.fill(0);
            }
        } catch (e) {
            if (this.processErrorCount++ < 5) {
                console.error('[Open303] Process error:', e);
            }
            if (channelL) channelL.fill(0);
            if (channelR) channelR.fill(0);
        }

        return true;
    }
}

registerProcessor('open303-processor', Open303Processor);
