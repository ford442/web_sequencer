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

                // 1. Compile the WASM module
                const module = await WebAssembly.compile(data.wasmBytes);

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
                            \"[Open303] Detected minified import names (e.g. 'b').\",
                            \"Rebuild jc303 with: -O1 -g (see tools/build_jc303_omp.sh)\"
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

                    // Memory management
                    emscripten_resize_heap: (_size: number) => false, // Return false to indicate failure if dynamic growth isn't supported/needed
                    _emscripten_resize_heap: (_size: number) => false, // alias

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
                    console.log("[Open303] Instantiating with env keys:", Object.keys(env));

                    // Construct the imports object explicitly
                    const importsObject: any = {
                        env: env,
                        a: env,
                        wasi_snapshot_preview1: env,
                        wasi_unstable: env,
                        "": env
                    };

                    // If the module expects an imported memory, create one and attach it.
                    // For threaded variant: Use SharedArrayBuffer (requires COOP/COEP headers)
                    // For single-threaded: Use regular ArrayBuffer
                    const memoryImportPages = (data && data.memoryPages) || 256; // 256 pages = 16MB
                    for(const imp of WebAssembly.Module.imports(module)) {
                        if (imp.kind === 'memory') {
                    let mem: WebAssembly.Memory;

                    if (this.isThreaded) {
                        // Threaded variant requires shared memory
                        try {
                            mem = new WebAssembly.Memory({
                                initial: memoryImportPages,
                                maximum: memoryImportPages,
                                shared: true
                            });
                            console.log(`[Open303] Created SHARED memory for ${imp.module}.${imp.name} — ${memoryImportPages} pages`);
                        } catch (e) {
                            // If SharedArrayBuffer fails, we can't continue with threaded variant
                            console.error(`[Open303] SharedArrayBuffer not available for threaded variant:`, e);
                            this.port.postMessage({
                                type: 'error',
                                error: 'SharedArrayBuffer not available. Ensure Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy headers are configured correctly on your web server. These headers are required for threaded WASM variants.'
                            });
                            return;
                        }
                    } else {
                        // Single-threaded uses regular memory
                        mem = new WebAssembly.Memory({
                            initial: memoryImportPages,
                            maximum: memoryImportPages
                        });
                        console.log(`[Open303] Created non-shared memory for ${imp.module}.${imp.name} — ${memoryImportPages} pages`);
                    }

                    this.importedMemory = mem;

                    // Ensure the importsObject has the exact module namespace the wasm requests
                    if (!importsObject[imp.module]) importsObject[imp.module] = {};
                    importsObject[imp.module][imp.name] = mem;

                    // Also attach to the common aliases so other code can access it
                    importsObject.env = importsObject.env || {};
                    importsObject.env.memory = mem;
                    importsObject.a = importsObject.a || {};
                    importsObject.a.memory = mem;
                }
            }

                this.wasmInstance = await WebAssembly.instantiate(module, importsObject);

            // Ensure updateHeap() can see either the exported memory or the imported one
            this.updateHeap();

            // 4. Initialize the DSP in the WASM
            const exports = this.wasmInstance.exports as any;

            // Debug exports
            console.log("[Open303] WASM Exports:", Object.keys(exports));

            if (exports.jc303_init) {
                exports.jc303_init(data.sampleRate || 44100, 128);
            }

            this.isWasmReady = true;
            this.port.postMessage({ type: 'ready' });
        } catch (e) {
            console.error("Open303 Worklet Error:", e);
            this.port.postMessage({ type: 'error', error: String(e) });
        }
    }

    // Handling messages after initialization
    if(this.isWasmReady && this.wasmInstance) {
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
    // Prefer exported memory, fall back to an imported memory we created for instantiation.
    const memory = (this.wasmInstance && (this.wasmInstance.exports && (this.wasmInstance.exports.memory as WebAssembly.Memory))) || this.importedMemory;
    if (memory) {
        this.heapFloat32 = new Float32Array(memory.buffer);
    }
}

process(_inputs: Float32Array[][], outputs: Float32Array[][], _parameters: Record<string, Float32Array>): boolean {
    const output = outputs[0];
    if (!output) return true;

    const channelL = output[0];
    const channelR = output[1];

    if (!this.isWasmReady || !this.wasmInstance || !this.heapFloat32) {
        return true;
    }

    const exports = this.wasmInstance.exports as any;
    const processFunc = exports.jc303_process;

    if (processFunc) {
        // Ask WASM to process 128 samples
        const ptr = processFunc(128);

        // Pointer is in bytes, divide by 4 for Float32 index
        const offset = ptr >> 2;

        // Safety check
        if (offset + 128 < this.heapFloat32.length) {
            for (let i = 0; i < 128; i++) {
                const sample = this.heapFloat32[offset + i];
                if (channelL) channelL[i] = sample;
                if (channelR) channelR[i] = sample;
            }
        }
    }

    return true;
}
}

registerProcessor('open303-processor', Open303Processor);
