import { RingBuffer } from "../utils/ringBuffer";
class RubberBandProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [
            { name: 'pitchScale', defaultValue: 1.0, minValue: 0.1, maxValue: 4.0 },
            { name: 'timeRatio', defaultValue: 1.0, minValue: 0.1, maxValue: 4.0 },
            { name: 'vibratoDepth', defaultValue: 0.0, minValue: 0.0, maxValue: 1.0 },
            { name: 'vibratoRate', defaultValue: 5.0, minValue: 0.1, maxValue: 20.0 },
            { name: 'tremoloDepth', defaultValue: 0.0, minValue: 0.0, maxValue: 1.0 },
            { name: 'tremoloRate', defaultValue: 0.0, minValue: 0.1, maxValue: 20.0 },
            { name: 'breathIntensity', defaultValue: 0.0, minValue: 0.0, maxValue: 1.0 }
        ];
    }
    constructor() {
        super();
        this.rubberBand = null;
        this.inputRingBuffer = null;
        this.outputRingBuffer = null;
        // WASM Memory Management
        this.inputHeapPtr = 0;
        this.outputHeapPtr = 0;
        this.heapSizeFrames = 0; // Current size of allocated buffers
        // Audio State
        this.sampleRate = 44100;
        this.lfoPhase = 0;
        this.initialized = false;
        this.fullSampleBuffer = null;
        this.port.onmessage = this.handleMessage.bind(this);
        // @ts-ignore
        if (globalThis.sampleRate) {
            this.sampleRate = globalThis.sampleRate;
        }
    }
    async handleMessage(event) {
        const { type, data } = event.data;
        switch (type) {
            case 'INIT_WASM':
                try {
                    // Fix: RingBuffer constructor takes only 1 argument (shared buffer)
                    this.inputRingBuffer = new RingBuffer(event.data.inputBuffer);
                    this.outputRingBuffer = new RingBuffer(event.data.outputBuffer);
                    // Load WASM
                    // @ts-ignore
                    const moduleFactory = await import(data.moduleUrl || '/rubberband.js');
                    const createRubberBandModule = moduleFactory.default;
                    // @ts-ignore
                    const module = await createRubberBandModule();
                    this.rubberBand = new module.RubberBandStretcher(this.sampleRate, 1, // Mono
                    1 | 32 | 1048576, // RealTime | Finer | FormantPreserved
                    1.0, 1.0);
                    // Store module reference to access _malloc/_free and HEAPF32
                    this.rubberBand.module = module;
                    this.initialized = true;
                    this.port.postMessage({ type: 'READY' });
                }
                catch (e) {
                    console.error("RubberBand WASM Failed:", e);
                    this.port.postMessage({ type: 'ERROR', error: String(e) });
                }
                break;
            case 'loadBuffer':
                this.fullSampleBuffer = new Float32Array(data.buffer);
                break;
            case 'noteOn':
                if (!this.initialized || !this.fullSampleBuffer)
                    return;
                this.rubberBand.reset();
                this.rubberBand.setPitchScale(data.pitch || 1.0);
                this.rubberBand.setTimeRatio(1.0);
                this.ensureHeapSize(this.fullSampleBuffer.length);
                this.rubberBand.module.HEAPF32.set(this.fullSampleBuffer, this.inputHeapPtr >> 2);
                this.rubberBand.process(this.inputHeapPtr, this.fullSampleBuffer.length, false);
                break;
            case 'noteOff':
                break;
        }
    }
    process(_inputs, outputs, parameters) {
        const outputChannel = outputs[0][0];
        // Pass-through if not ready
        if (!this.initialized || !this.rubberBand || !this.inputRingBuffer || !this.outputRingBuffer) {
            return true;
        }
        // 1. DSP Parameters
        const pitch = parameters.pitchScale[0];
        const time = parameters.timeRatio[0];
        const vibDepth = parameters.vibratoDepth[0];
        const vibRate = parameters.vibratoRate[0];
        const tremDepth = parameters.tremoloDepth[0];
        const breath = parameters.breathIntensity[0];
        // 2. Expression (Vibrato)
        const dt = 128 / this.sampleRate;
        this.lfoPhase += (vibRate * dt * 2 * Math.PI);
        if (this.lfoPhase > 2 * Math.PI)
            this.lfoPhase -= 2 * Math.PI;
        const lfoSine = Math.sin(this.lfoPhase);
        // Apply Pitch Modulation
        // vibDepth 0-1 maps to approx 0-50 cents
        const vibFactor = Math.pow(2, (vibDepth * lfoSine * 0.5) / 12);
        this.rubberBand.setPitchScale(pitch * vibFactor);
        this.rubberBand.setTimeRatio(time);
        // 3. Process Audio Logic (Memory Managed)
        try {
            // A. PULL from RingBuffer -> WASM
            const required = this.rubberBand.getSamplesRequired();
            // Fix: Use availableRead() from modified RingBuffer
            const available = this.inputRingBuffer.availableRead();
            // Process in chunks if we have enough data
            if (available >= required && required > 0) {
                this.ensureHeapSize(required); // Ensure heap buffer is large enough
                // 1. Read from RingBuffer into temp JS array
                const inputTemp = new Float32Array(required);
                // Fix: Use pull() instead of pop()
                this.inputRingBuffer.pull(inputTemp);
                // 2. Copy JS Array -> WASM Heap
                // HEAPF32 is a view of memory. We calculate offset in 32-bit floats (bytes / 4)
                this.rubberBand.module.HEAPF32.set(inputTemp, this.inputHeapPtr >> 2);
                // 3. Process (Pass the POINTER, not the array)
                this.rubberBand.process(this.inputHeapPtr, required, false);
            }
            // B. RETRIEVE from WASM -> Output
            // We want to fill the current Web Audio block (128 frames)
            const availOutput = this.rubberBand.available();
            if (availOutput > 0) {
                const framesToRead = Math.min(availOutput, 128); // Read up to block size
                this.ensureHeapSize(framesToRead);
                // 1. Retrieve (Pass POINTER)
                const retrieved = this.rubberBand.retrieve(this.outputHeapPtr, framesToRead);
                // 2. Copy WASM Heap -> Output Buffer
                const outputView = this.rubberBand.module.HEAPF32.subarray(this.outputHeapPtr >> 2, (this.outputHeapPtr >> 2) + retrieved);
                outputChannel.set(outputView);
            }
        }
        catch (e) {
            console.error("DSP Error:", e);
        }
        // 4. Post-Processing Effects (Tremolo & Breath)
        // Applied directly to the output buffer
        for (let i = 0; i < outputChannel.length; i++) {
            // Tremolo
            if (tremDepth > 0) {
                const amp = 1.0 - (tremDepth * 0.5 * (1 + lfoSine));
                outputChannel[i] *= amp;
            }
            // Breath (White Noise)
            if (breath > 0) {
                const noise = (Math.random() * 2 - 1) * breath * 0.05;
                outputChannel[i] += noise;
            }
        }
        return true;
    }
    // Helper: Resize WASM heap buffers if needed to avoid constant malloc/free
    ensureHeapSize(frames) {
        if (frames > this.heapSizeFrames) {
            // Free old if exists
            if (this.inputHeapPtr)
                this.rubberBand.module._free(this.inputHeapPtr);
            if (this.outputHeapPtr)
                this.rubberBand.module._free(this.outputHeapPtr);
            // Alloc new (Bytes = frames * 4)
            this.inputHeapPtr = this.rubberBand.module._malloc(frames * 4);
            this.outputHeapPtr = this.rubberBand.module._malloc(frames * 4);
            this.heapSizeFrames = frames;
        }
    }
}
registerProcessor('rubberband-processor', RubberBandProcessor);
