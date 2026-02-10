// src/audio-worklets/open303-processor.ts

// Declare the processor class/register function for TypeScript
declare class AudioWorkletProcessor {
    readonly port: MessagePort;
    process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}
declare function registerProcessor(name: string, processorCtor: new () => AudioWorkletProcessor): void;

class Open303Processor extends AudioWorkletProcessor {
    private wasmInstance: WebAssembly.Instance | null = null;
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
                // 1. Compile the WASM binary
                const module = await WebAssembly.compile(data.wasmBytes);

                // 2. Prepare Environment Imports
                // Emscripten-compiled modules need these standard imports
                const env = {
                    abort: () => console.error("Open303 WASM Abort"),
                    emscripten_notify_memory_growth: () => this.updateHeap(),
                    // Math functions often needed by DSP code
                    exp: Math.exp,
                    pow: Math.pow,
                    sin: Math.sin,
                    cos: Math.cos,
                    fmod: (x: number, y: number) => x % y,

                    // Stubs for common Emscripten runtime functions to prevent crashes
                    _emscripten_resize_heap: () => false,
                    _emscripten_memcpy_big: (dest: number, src: number, num: number) => {
                        if (!this.wasmInstance) return;
                        const heap = new Uint8Array(this.wasmInstance.exports.memory.buffer);
                        heap.set(heap.subarray(src, src + num), dest);
                    }
                };

                // 3. Instantiate with BOTH 'env' and 'a' (minified alias)
                // This is the specific fix for your error "Import #0 'a'..."
                this.wasmInstance = await WebAssembly.instantiate(module, {
                    env: env,
                    a: env  // <--- CRITICAL FIX: Alias 'env' to 'a'
                });

                this.updateHeap();

                // 4. Initialize the DSP engine in WASM
                const exports = this.wasmInstance.exports as any;
                if (exports.jc303_init) {
                    // Initialize with sample rate (default 44100) and buffer size (128 for Worklets)
                    exports.jc303_init(data.sampleRate || 44100, 128);
                }

                this.isWasmReady = true;
                this.port.postMessage({ type: 'ready' });
                // console.log("Open303 Worklet Ready");

            } catch (e) {
                console.error("Open303 Worklet Initialization Failed:", e);
                this.port.postMessage({ type: 'error', error: String(e) });
            }
        }

        // Handle Note/Param messages
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
        if (this.wasmInstance && this.wasmInstance.exports.memory) {
            this.heapFloat32 = new Float32Array((this.wasmInstance.exports.memory as WebAssembly.Memory).buffer);
        }
    }

    process(_inputs: Float32Array[][], outputs: Float32Array[][], _parameters: Record<string, Float32Array>): boolean {
        const output = outputs[0];
        if (!output || !output[0]) return true;

        const channelL = output[0];
        const channelR = output[1] || channelL; // Fallback to mono if needed

        // If WASM isn't ready, output silence but keep the node alive
        if (!this.isWasmReady || !this.wasmInstance || !this.heapFloat32) {
            return true;
        }

        const exports = this.wasmInstance.exports as any;
        const processFunc = exports.jc303_process;

        if (processFunc) {
            // Generate 128 samples (standard AudioWorklet block size)
            // The C++ function likely returns a pointer (integer offset) to the buffer in WASM memory
            const ptr = processFunc(128);

            // Convert byte offset to Float32 index (bytes / 4)
            const offset = ptr >> 2;

            // Safety check to prevent reading out of bounds
            if (offset + 128 <= this.heapFloat32.length) {
                for (let i = 0; i < 128; i++) {
                    const sample = this.heapFloat32[offset + i];
                    channelL[i] = sample;
                    if (output[1]) channelR[i] = sample;
                }
            }
        }

        // Return TRUE to keep the processor alive.
        // Returning false causes the node to be garbage collected and silence ensues.
        return true;
    }
}

registerProcessor('open303-processor', Open303Processor);
