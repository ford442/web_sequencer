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
    private outputBufferPtr: number = 0;  // Pointer to the persistent output buffer

    // Gain compensation for 303 output level matching.
    // TB-303 emulations typically output at ~-12dB relative to standard
    // digital oscillators. A 4x multiplier brings the signal to ~0dB/-6dB.
    private static readonly OUTPUT_GAIN = 4.0;

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
                try {
                    const importDescriptors = WebAssembly.Module.imports(module);
                    console.log("[Open303] WASM Imports Requirement:", JSON.stringify(importDescriptors));
                } catch (e) {
                    console.warn("[Open303] Failed to inspect imports:", e);
                }

                // 2. Prepare Environment Imports
                const env: any = {
                    // Core runtime
                    _abort_js: () => console.error("WASM Abort"),
                    abort: () => console.error("WASM Abort"),
                    b: () => console.error("WASM Abort"),

                    // Memory management
                    emscripten_resize_heap: (size: number) => {
                        const memory = this.wasmInstance?.exports?.memory as WebAssembly.Memory || this.importedMemory;
                        if (!memory) return 0;
                        
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
                    },
                    _emscripten_resize_heap: (size: number) => { 
                        return env.emscripten_resize_heap(size);
                    },
                    emscripten_notify_memory_growth: () => this.updateHeap(),

                    // Math functions
                    exp: Math.exp,
                    pow: Math.pow,
                    sin: Math.sin,
                    cos: Math.cos,
                    fmod: (x: number, y: number) => x % y,

                    // Stubs
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
                    clock_time_get: () => Date.now() * 1000000,
                    emscripten_get_now: () => performance.now(),
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

                // WASI imports
                const wasiImports: any = {
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

                const importsObject: any = {
                    env: env,
                    a: env,
                    wasi_snapshot_preview1: wasiImports,
                    wasi_unstable: wasiImports,
                    "": env
                };

                // Memory handling
                const imports = WebAssembly.Module.imports(module);
                const memoryImport = imports.find(i => i.kind === 'memory');
                
                if (memoryImport) {
                    const memoryImportPages = (data && data.memoryPages) || 512;
                    const maxMemoryPages = 1024;
                    let mem: WebAssembly.Memory;

                    if (this.isThreaded) {
                        try {
                            mem = new WebAssembly.Memory({
                                initial: memoryImportPages,
                                maximum: maxMemoryPages,
                                shared: true
                            });
                        } catch (e) {
                            console.error(`[Open303] SharedArrayBuffer not available:`, e);
                            this.port.postMessage({ type: 'error', error: 'SharedArrayBuffer not available' });
                            return;
                        }
                    } else {
                        mem = new WebAssembly.Memory({
                            initial: memoryImportPages,
                            maximum: maxMemoryPages
                        });
                    }

                    this.importedMemory = mem;
                    if (!importsObject[memoryImport.module]) importsObject[memoryImport.module] = {};
                    importsObject[memoryImport.module][memoryImport.name] = mem;
                }

                // Instantiate
                const instantiatePromise = WebAssembly.instantiate(module, importsObject);
                const timeoutPromise = new Promise<never>((_, reject) => {
                    setTimeout(() => reject(new Error('WASM instantiation timeout (5s)')), 5000);
                });
                
                this.wasmInstance = await Promise.race([instantiatePromise, timeoutPromise]);
                console.log('[Open303] WASM instantiated successfully');

                this.updateHeap();

                // 4. Initialize the DSP
                const exports = this.wasmInstance.exports as any;
                
                // Initialize the synthesizer
                const sampleRate = data.sampleRate || 44100;
                exports.jc303_init(sampleRate, 128);
                console.log(`[Open303] Initialized with sampleRate=${sampleRate}`);

                // 5. Get buffer pointer
                // Critical fix: We use a persistent buffer pointer to avoid dynamic allocation in the audio thread
                if (typeof exports.jc303_getOutputBuffer === 'function') {
                    this.outputBufferPtr = exports.jc303_getOutputBuffer();
                    console.log(`[Open303] Buffer Pointer retrieved: ${this.outputBufferPtr}`);

                    if (this.outputBufferPtr === 0) {
                        console.warn("[Open303] Buffer pointer is 0 (NULL). Initialization might have failed to allocate memory.");
                    }
                } else if (typeof exports.getOutputBuffer === 'function') {
                    // Try without prefix if bindings are used
                    this.outputBufferPtr = exports.getOutputBuffer();
                    console.log(`[Open303] Buffer Pointer retrieved (via bind): ${this.outputBufferPtr}`);
                } else {
                    console.warn("[Open303] jc303_getOutputBuffer not found in exports. Check WASM build.");
                    // We will likely fail in process() but we continue initialization
                }

                this.isWasmReady = true;
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
        const memory = (this.wasmInstance?.exports as any)?.memory || this.importedMemory;
        if (memory) {
            this.heapFloat32 = new Float32Array(memory.buffer);
        }
    }

    private processErrorCount = 0;
    
    process(_inputs: Float32Array[][], outputs: Float32Array[][], _parameters: Record<string, Float32Array>): boolean {
        const output = outputs[0];
        if (!output) return true;

        const channelL = output[0];
        const channelR = output[1];

        if (!this.isWasmReady || !this.wasmInstance || !this.heapFloat32 || this.outputBufferPtr === 0) {
            // Output silence if not ready or buffer missing
            if (channelL) channelL.fill(0);
            if (channelR) channelR.fill(0);
            return true;
        }

        try {
            const exports = this.wasmInstance.exports as any;
            const processFunc = exports.jc303_process;

            if (processFunc) {
                // Perform processing
                // This call now returns void and writes to the persistent buffer at this.outputBufferPtr
                processFunc(128);
                
                const ptr = this.outputBufferPtr;
                const offset = ptr >> 2;

                // Safety check
                if (offset >= 0 && offset + 128 <= this.heapFloat32.length) {
                    const gain = Open303Processor.OUTPUT_GAIN;

                    // Optimization: Read directly from heap
                    // Since it's mono, we read once and write to both channels
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

                // NO FREE call here anymore!
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
