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

    constructor() {
        super();
        this.port.onmessage = this.handleMessage.bind(this);
    }

    private async handleMessage(event: MessageEvent) {
        const { type, data } = event.data;

        if (type === 'init-wasm') {
            try {
                // 1. Compile the WASM module
                const module = await WebAssembly.compile(data.wasmBytes);

                // DEBUG: Inspect imports to debug "module is not an object" error
                // This helps identify if the module expects 'env', 'a', 'wasi_snapshot_preview1', or something else.
                try {
                    const importDescriptors = WebAssembly.Module.imports(module);
                    console.log("[Open303] WASM Imports Requirement:", JSON.stringify(importDescriptors));

                    // If the module imports single-letter/minified names (e.g. "b"), the wasm
                    // was built with import minification. Recommend rebuilding with the
                    // MINIFY_WASM_IMPORTS=0 flag so names like "abort" are preserved.
                    const importNames = importDescriptors.map((d: any) => d.name || '');
                    if (importNames.some((n: string) => /^[A-Za-z]$/.test(n))) {
                        console.warn(
                            "[Open303] Detected minified import names (e.g. 'b').",
                            "Rebuild jc303 with: -s MINIFY_WASM_IMPORTS=0 (see tools/build_jc303_omp.sh)"
                        );
                    }
                } catch (e) {
                    console.warn("[Open303] Failed to inspect imports:", e);
                }

                // 2. Prepare Environment Imports
                // We define the standard Emscripten imports plus stubs for runtime safety.
                const env: any = {
                    abort: () => console.error("WASM Abort"),
                    b: () => console.error("WASM Abort"),  // Alias for minified abort — TODO: remove after rebuilding jc303 with -s MINIFY_WASM_IMPORTS=0
                    emscripten_notify_memory_growth: () => this.updateHeap(),
                    exp: Math.exp,
                    pow: Math.pow,
                    sin: Math.sin,
                    cos: Math.cos,
                    fmod: (x: number, y: number) => x % y,

                    // Emscripten Runtime Stubs (Prevent crashes on missing symbols)
                    _emscripten_resize_heap: (_size: number) => false, // Return false to indicate failure if dynamic growth isn't supported/needed
                    _emscripten_memcpy_big: (dest: number, src: number, num: number) => {
                        // Safety check: Instance might not be ready during immediate instantiation
                        if (!this.wasmInstance && !this.importedMemory) return;

                        const memory = (this.wasmInstance && (this.wasmInstance.exports && (this.wasmInstance.exports.memory as WebAssembly.Memory))) || this.importedMemory;
                        if (!memory) return;

                        const heap = new Uint8Array(memory.buffer);
                        heap.set(heap.subarray(src, src + num), dest);
                    }
                };

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

                // If the module expects an imported memory, create one and attach it to
                // the exact module/name the wasm expects (and also to common aliases).
                // Keep a reference on `this.importedMemory` so updateHeap can use it
                // when the module does not export the memory.
                const memoryImportPages = (data && data.memoryPages) || 256; // 256 pages = 16MB (reasonable default for Emscripten)
                for (const imp of WebAssembly.Module.imports(module)) {
                    if (imp.kind === 'memory') {
                        let mem: WebAssembly.Memory;
                        try {
                            // Try shared memory first (required if WASM was compiled with -pthread)
                            mem = new WebAssembly.Memory({
                                initial: memoryImportPages,
                                maximum: memoryImportPages,
                                shared: true
                            });
                            console.log(`[Open303] created SHARED memory for ${imp.module}.${imp.name} — ${memoryImportPages} pages`);
                        } catch (e) {
                            // Fallback to non-shared if SharedArrayBuffer not available (missing COOP/COEP headers)
                            console.warn(`[Open303] SharedArrayBuffer not available, using regular memory:`, e);
                            mem = new WebAssembly.Memory({ initial: memoryImportPages, maximum: memoryImportPages });
                            console.log(`[Open303] created non-shared memory for ${imp.module}.${imp.name} — ${memoryImportPages} pages`);
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
