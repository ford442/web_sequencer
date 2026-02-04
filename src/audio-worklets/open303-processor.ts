// src/audio-worklets/open303-processor.ts

// Definitions for the AudioWorklet scope
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
                // compile the WASM module
                const module = await WebAssembly.compile(data.wasmBytes);

                // Instantiate
                this.wasmInstance = await WebAssembly.instantiate(module, {
                    env: {
                        // Minimal environment for WASM.
                        // If jc303.wasm was built with Emscripten, it might expect more imports here.
                        // We provide stubs for common math if needed, though usually they are self-contained or use built-ins.
                        abort: () => console.error("WASM Abort"),
                        emscripten_notify_memory_growth: () => this.updateHeap(),
                        // Basic math needed by some builds
                        exp: Math.exp,
                        pow: Math.pow,
                        sin: Math.sin,
                        cos: Math.cos,
                        fmod: (x: number, y: number) => x % y
                    }
                });

                this.updateHeap();

                // Initialize the DSP in the WASM
                const exports = this.wasmInstance.exports as any;
                if (exports.jc303_init) {
                    // Initialize with Sample Rate and Buffer Size (128 for Worklets)
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
        if (this.wasmInstance && this.wasmInstance.exports.memory) {
            const memory = this.wasmInstance.exports.memory as WebAssembly.Memory;
            this.heapFloat32 = new Float32Array(memory.buffer);
        }
    }

    process(_inputs: Float32Array[][], outputs: Float32Array[][], _parameters: Record<string, Float32Array>): boolean {
        const output = outputs[0];
        if (!output) return true;

        const channelL = output[0];
        const channelR = output[1];

        // If not ready, output silence
        if (!this.isWasmReady || !this.wasmInstance || !this.heapFloat32) {
            return true;
        }

        const exports = this.wasmInstance.exports as any;
        const processFunc = exports.jc303_process;

        if (processFunc) {
            // Ask WASM to process 128 samples. It usually returns a pointer to the buffer.
            const ptr = processFunc(128);

            // Pointer arithmetic to find the data in the heap
            // ptr is in bytes, divide by 4 for Float32 index
            const offset = ptr >> 2;

            // Copy to AudioWorklet outputs
            // Safety check to ensure we don't read out of bounds
            if (offset + 128 < this.heapFloat32.length) {
                for (let i = 0; i < 128; i++) {
                    const sample = this.heapFloat32[offset + i];
                    if (channelL) channelL[i] = sample;
                    // Duplicate to stereo if needed, or if the synth is mono
                    if (channelR) channelR[i] = sample;
                }
            }
        }

        return true;
    }
}

registerProcessor('open303-processor', Open303Processor);
