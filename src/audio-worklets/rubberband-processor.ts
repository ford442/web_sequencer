import { RingBuffer } from "../utils/ringBuffer";
import { ExpressiveVoiceProcessor } from "../engines/rubberband/ExpressiveVoiceProcessor";

interface AudioWorkletProcessor {
  readonly port: MessagePort;
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}

declare var AudioWorkletProcessor: {
  prototype: AudioWorkletProcessor;
  new (options?: any): AudioWorkletProcessor;
};

declare function registerProcessor(name: string, processorCtor: (new (options?: any) => AudioWorkletProcessor)): void;

declare const globalThis: {
  sampleRate: number;
};

class RubberBandProcessor extends AudioWorkletProcessor {
  private rubberBand: any = null;
  private inputRingBuffer: RingBuffer | null = null;
  private outputRingBuffer: RingBuffer | null = null;
  private expressiveProcessor: ExpressiveVoiceProcessor;

  // WASM Memory Management
  private inputHeapPtr: number = 0;
  private outputHeapPtr: number = 0;
  private heapSizeFrames: number = 0; // Current size of allocated buffers

  // Audio State
  private sampleRate = 44100;
  private initialized = false;
  private fullSampleBuffer: Float32Array | null = null;


  static get parameterDescriptors() {
    return [
      { name: 'pitchScale', defaultValue: 1.0, minValue: 0.1, maxValue: 4.0 },
      { name: 'timeRatio', defaultValue: 1.0, minValue: 0.1, maxValue: 4.0 },
      { name: 'vibratoDepth', defaultValue: 0.0, minValue: 0.0, maxValue: 1.0 },
      { name: 'vibratoRate', defaultValue: 5.0, minValue: 0.1, maxValue: 20.0 },
      { name: 'tremoloDepth', defaultValue: 0.0, minValue: 0.0, maxValue: 1.0 },
      { name: 'tremoloRate', defaultValue: 0.1, minValue: 0.1, maxValue: 20.0 },
      { name: 'breathIntensity', defaultValue: 0.0, minValue: 0.0, maxValue: 1.0 }
    ];
  }

  constructor() {
    super();
    this.port.onmessage = this.handleMessage.bind(this);
    // @ts-ignore
    if (globalThis.sampleRate) {
        this.sampleRate = globalThis.sampleRate;
    }

    // Initialize Expressive Processor
    this.expressiveProcessor = new ExpressiveVoiceProcessor({
        sampleRate: this.sampleRate
    });
  }

  async handleMessage(event: MessageEvent) {
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

          this.rubberBand = new module.RubberBandStretcher(
            this.sampleRate,
            1, // Mono
            1 | 32 | 1048576, // RealTime | Finer | FormantPreserved
            1.0,
            1.0
          );

          // Store module reference to access _malloc/_free and HEAPF32
          this.rubberBand.module = module;
          this.initialized = true;
          this.port.postMessage({ type: 'READY' });
        } catch (e) {
          console.error("RubberBand WASM Failed:", e);
          this.port.postMessage({ type: 'ERROR', error: String(e) });
        }
        break;

      case 'loadBuffer':
        this.fullSampleBuffer = new Float32Array(data.buffer);
        break;

      case 'noteOn':
        if (!this.initialized || !this.fullSampleBuffer) return;
        this.rubberBand.reset();
        this.rubberBand.setPitchScale(data.pitch || 1.0);
        this.rubberBand.setTimeRatio(1.0);
        this.expressiveProcessor.reset(); // Reset LFOs
        this.ensureHeapSize(this.fullSampleBuffer.length);
        this.rubberBand.module.HEAPF32.set(this.fullSampleBuffer, this.inputHeapPtr >> 2);
        this.rubberBand.process(this.inputHeapPtr, this.fullSampleBuffer.length, false);
        break;

      case 'noteOff':
        break;
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
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
    const tremRate = parameters.tremoloRate ? parameters.tremoloRate[0] : 0;
    const breath = parameters.breathIntensity[0];

    // 2. Update Expression Processor
    this.expressiveProcessor.updateConfig({
        vibrato: {
            depth: vibDepth,
            rate: vibRate,
            enabled: vibDepth > 0
        },
        tremolo: {
            depth: tremDepth,
            rate: tremRate,
            enabled: tremDepth > 0
        },
        breath: {
            amount: breath,
            enabled: breath > 0,
            filterCutoff: 2000 // Default value
        }
    });

    // Apply Pitch (Base only, vibrato is now post-process)
    this.rubberBand.setPitchScale(pitch);
    this.rubberBand.setTimeRatio(time);

    // 3. Process Audio Logic (Memory Managed)
    try {
        // A. PULL from RingBuffer -> WASM
        const required = this.rubberBand.getSamplesRequired();
        const available = this.inputRingBuffer.availableRead();

        // Process in chunks if we have enough data
        if (available >= required && required > 0) {
            this.ensureHeapSize(required); // Ensure heap buffer is large enough

            // 1. Read from RingBuffer into temp JS array
            const inputTemp = new Float32Array(required);
            this.inputRingBuffer.pull(inputTemp);

            // 2. Copy JS Array -> WASM Heap
            this.rubberBand.module.HEAPF32.set(inputTemp, this.inputHeapPtr >> 2);

            // 3. Process
            this.rubberBand.process(this.inputHeapPtr, required, false);
        }

        // B. RETRIEVE from WASM -> Output
        const availOutput = this.rubberBand.available();
        if (availOutput > 0) {
            const framesToRead = Math.min(availOutput, 128); // Read up to block size
            this.ensureHeapSize(framesToRead);
            
            // 1. Retrieve
            const retrieved = this.rubberBand.retrieve(this.outputHeapPtr, framesToRead);

            // 2. Copy WASM Heap -> Output Buffer
            const outputView = this.rubberBand.module.HEAPF32.subarray(
                this.outputHeapPtr >> 2,
                (this.outputHeapPtr >> 2) + retrieved
            );

            // Copy to outputChannel (needed because outputView is a view on WASM memory)
            outputChannel.set(outputView);

            // 4. Post-Processing Effects (Expressive Layer)
            // Apply in-place on the output buffer
            this.expressiveProcessor.process(outputChannel, outputChannel);
        }

    } catch (e) {
        console.error("DSP Error:", e);
    }

    return true;
  }

  // Helper: Resize WASM heap buffers if needed to avoid constant malloc/free
  private ensureHeapSize(frames: number) {
      if (frames > this.heapSizeFrames) {
          // Free old if exists
          if (this.inputHeapPtr) this.rubberBand.module._free(this.inputHeapPtr);
          if (this.outputHeapPtr) this.rubberBand.module._free(this.outputHeapPtr);

          // Alloc new (Bytes = frames * 4)
          this.inputHeapPtr = this.rubberBand.module._malloc(frames * 4);
          this.outputHeapPtr = this.rubberBand.module._malloc(frames * 4);
          this.heapSizeFrames = frames;
      }
  }
}

registerProcessor('rubberband-processor', RubberBandProcessor);
