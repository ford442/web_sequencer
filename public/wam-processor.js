class WamOscillatorProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        this.oscillator = null;
        this.bufferPointer = null;
        this.wasmInstance = null;
        this.heapFloat32 = null;
        this.running = true;

        const { wasmModule, sampleRate } = options.processorOptions;

        // Instantiate WASM synchronously (allowed in Worklet constructor if module is passed)
        if (wasmModule) {
            const instance = new WebAssembly.Instance(wasmModule, {
                env: {
                    memory: new WebAssembly.Memory({ initial: 1 }),
                    __memory_base: 0,
                    table: new WebAssembly.Table({ initial: 0, element: 'anyfunc' }),
                    __table_base: 0
                }
            });

            this.wasmInstance = instance.exports;

            // Initialize C++ Object
            this.oscillator = this.wasmInstance.create_oscillator(sampleRate);

            // Allocate buffer memory in WASM (128 frames * 4 bytes/float)
            this.bufferPointer = this.wasmInstance.malloc(128 * 4);

            // Create a view into WASM memory
            this.heapFloat32 = new Float32Array(this.wasmInstance.memory.buffer);
        }
    }

    process(inputs, outputs, parameters) {
        if (!this.oscillator || !this.wasmInstance) return true;

        const output = outputs[0];
        const channel = output[0]; // Mono output
        const frequency = parameters.frequency ? (parameters.frequency[0] || 440) : 440;
        const type = parameters.type ? (parameters.type[0] || 0) : 0; // 0=Saw, 1=Sqr...

        // 1. Call C++ to generate samples into the WASM heap
        this.wasmInstance.process_oscillator(
            this.oscillator,
            this.bufferPointer,
            128,
            frequency,
            type
        );

        // 2. Copy from WASM heap to AudioWorklet output
        // Note: WASM memory can grow, so we might need to refresh the view if detached,
        // but for this simple allocator it usually stays put or we check buffer.byteLength.
        if (this.heapFloat32.buffer.byteLength === 0) {
            this.heapFloat32 = new Float32Array(this.wasmInstance.memory.buffer);
        }

        const wasmView = this.heapFloat32.subarray(
            this.bufferPointer / 4,
            this.bufferPointer / 4 + 128
        );

        channel.set(wasmView);

        return this.running;
    }
}

registerProcessor('wam-oscillator', WamOscillatorProcessor);
