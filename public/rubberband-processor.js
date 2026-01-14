var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// src/utils/ringBuffer.ts
var HEAD_INDEX = 0;
var TAIL_INDEX = 1;
var RingBuffer = class {
  constructor(arg) {
    __publicField(this, "sab");
    __publicField(this, "atomicIndices");
    __publicField(this, "buffer");
    __publicField(this, "bufferSize");
    if (typeof arg === "number") {
      const size = arg;
      if (size & size - 1) {
        throw new Error("RingBuffer size must be a power of two.");
      }
      this.sab = new SharedArrayBuffer(
        2 * Int32Array.BYTES_PER_ELEMENT + size * Float32Array.BYTES_PER_ELEMENT
      );
    } else {
      this.sab = arg;
    }
    this.atomicIndices = new Int32Array(this.sab, 0, 2);
    this.buffer = new Float32Array(this.sab, 2 * Int32Array.BYTES_PER_ELEMENT);
    this.bufferSize = this.buffer.length;
  }
  // Producer side (main thread)
  push(data) {
    const head = Atomics.load(this.atomicIndices, HEAD_INDEX);
    const tail = Atomics.load(this.atomicIndices, TAIL_INDEX);
    const availableToWrite = this.bufferSize - (head - tail);
    if (data.length > availableToWrite) {
      return 0;
    }
    const headIndex = head & this.bufferSize - 1;
    const toWrite = Math.min(data.length, this.bufferSize - headIndex);
    this.buffer.set(data.subarray(0, toWrite), headIndex);
    this.buffer.set(data.subarray(toWrite), 0);
    Atomics.store(this.atomicIndices, HEAD_INDEX, head + data.length);
    return data.length;
  }
  // Consumer side (AudioWorklet)
  pull(data) {
    const head = Atomics.load(this.atomicIndices, HEAD_INDEX);
    const tail = Atomics.load(this.atomicIndices, TAIL_INDEX);
    const availableToRead = head - tail;
    if (availableToRead === 0) {
      return 0;
    }
    const toRead = Math.min(data.length, availableToRead);
    const tailIndex = tail & this.bufferSize - 1;
    const fromRead = Math.min(toRead, this.bufferSize - tailIndex);
    data.set(this.buffer.subarray(tailIndex, tailIndex + fromRead));
    data.set(this.buffer.subarray(0, toRead - fromRead), fromRead);
    Atomics.store(this.atomicIndices, TAIL_INDEX, tail + toRead);
    return toRead;
  }
  availableRead() {
    const head = Atomics.load(this.atomicIndices, HEAD_INDEX);
    const tail = Atomics.load(this.atomicIndices, TAIL_INDEX);
    return head - tail;
  }
};

// src/audio-worklets/rubberband-processor.ts
var RubberBandProcessor = class extends AudioWorkletProcessor {
  constructor() {
    super();
    __publicField(this, "rubberBand", null);
    __publicField(this, "inputRingBuffer", null);
    __publicField(this, "outputRingBuffer", null);
    // WASM Memory Management
    __publicField(this, "inputHeapPtr", 0);
    __publicField(this, "outputHeapPtr", 0);
    __publicField(this, "heapSizeFrames", 0);
    // Current size of allocated buffers
    // Audio State
    __publicField(this, "sampleRate", 44100);
    __publicField(this, "lfoPhase", 0);
    __publicField(this, "initialized", false);
    __publicField(this, "fullSampleBuffer", null);
    this.port.onmessage = this.handleMessage.bind(this);
    if (globalThis.sampleRate) {
      this.sampleRate = globalThis.sampleRate;
    }
  }
  static get parameterDescriptors() {
    return [
      { name: "pitchScale", defaultValue: 1, minValue: 0.1, maxValue: 4 },
      { name: "timeRatio", defaultValue: 1, minValue: 0.1, maxValue: 4 },
      { name: "vibratoDepth", defaultValue: 0, minValue: 0, maxValue: 1 },
      { name: "vibratoRate", defaultValue: 5, minValue: 0.1, maxValue: 20 },
      { name: "tremoloDepth", defaultValue: 0, minValue: 0, maxValue: 1 },
      { name: "tremoloRate", defaultValue: 0, minValue: 0.1, maxValue: 20 },
      { name: "breathIntensity", defaultValue: 0, minValue: 0, maxValue: 1 }
    ];
  }
  async handleMessage(event) {
    const { type, data } = event.data;
    switch (type) {
      case "INIT_WASM":
        try {
          this.inputRingBuffer = new RingBuffer(event.data.inputBuffer);
          this.outputRingBuffer = new RingBuffer(event.data.outputBuffer);
          const moduleFactory = await import(data.moduleUrl || "/rubberband.js");
          const createRubberBandModule = moduleFactory.default;
          const module = await createRubberBandModule();
          this.rubberBand = new module.RubberBandStretcher(
            this.sampleRate,
            1,
            // Mono
            1 | 32 | 1048576,
            // RealTime | Finer | FormantPreserved
            1,
            1
          );
          this.rubberBand.module = module;
          this.initialized = true;
          this.port.postMessage({ type: "READY" });
        } catch (e) {
          console.error("RubberBand WASM Failed:", e);
          this.port.postMessage({ type: "ERROR", error: String(e) });
        }
        break;
      case "loadBuffer":
        this.fullSampleBuffer = new Float32Array(data.buffer);
        break;
      case "noteOn":
        if (!this.initialized || !this.fullSampleBuffer) return;
        this.rubberBand.reset();
        this.rubberBand.setPitchScale(data.pitch || 1);
        this.rubberBand.setTimeRatio(1);
        this.ensureHeapSize(this.fullSampleBuffer.length);
        this.rubberBand.module.HEAPF32.set(this.fullSampleBuffer, this.inputHeapPtr >> 2);
        this.rubberBand.process(this.inputHeapPtr, this.fullSampleBuffer.length, false);
        break;
      case "noteOff":
        break;
    }
  }
  process(_inputs, outputs, parameters) {
    const outputChannel = outputs[0][0];
    if (!this.initialized || !this.rubberBand || !this.inputRingBuffer || !this.outputRingBuffer) {
      return true;
    }
    const pitch = parameters.pitchScale[0];
    const time = parameters.timeRatio[0];
    const vibDepth = parameters.vibratoDepth[0];
    const vibRate = parameters.vibratoRate[0];
    const tremDepth = parameters.tremoloDepth[0];
    const breath = parameters.breathIntensity[0];
    const dt = 128 / this.sampleRate;
    this.lfoPhase += vibRate * dt * 2 * Math.PI;
    if (this.lfoPhase > 2 * Math.PI) this.lfoPhase -= 2 * Math.PI;
    const lfoSine = Math.sin(this.lfoPhase);
    const vibFactor = Math.pow(2, vibDepth * lfoSine * 0.5 / 12);
    this.rubberBand.setPitchScale(pitch * vibFactor);
    this.rubberBand.setTimeRatio(time);
    try {
      const required = this.rubberBand.getSamplesRequired();
      const available = this.inputRingBuffer.availableRead();
      if (available >= required && required > 0) {
        this.ensureHeapSize(required);
        const inputTemp = new Float32Array(required);
        this.inputRingBuffer.pull(inputTemp);
        this.rubberBand.module.HEAPF32.set(inputTemp, this.inputHeapPtr >> 2);
        this.rubberBand.process(this.inputHeapPtr, required, false);
      }
      const availOutput = this.rubberBand.available();
      if (availOutput > 0) {
        const framesToRead = Math.min(availOutput, 128);
        this.ensureHeapSize(framesToRead);
        const retrieved = this.rubberBand.retrieve(this.outputHeapPtr, framesToRead);
        const outputView = this.rubberBand.module.HEAPF32.subarray(
          this.outputHeapPtr >> 2,
          (this.outputHeapPtr >> 2) + retrieved
        );
        outputChannel.set(outputView);
      }
    } catch (e) {
      console.error("DSP Error:", e);
    }
    for (let i = 0; i < outputChannel.length; i++) {
      if (tremDepth > 0) {
        const amp = 1 - tremDepth * 0.5 * (1 + lfoSine);
        outputChannel[i] *= amp;
      }
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
      if (this.inputHeapPtr) this.rubberBand.module._free(this.inputHeapPtr);
      if (this.outputHeapPtr) this.rubberBand.module._free(this.outputHeapPtr);
      this.inputHeapPtr = this.rubberBand.module._malloc(frames * 4);
      this.outputHeapPtr = this.rubberBand.module._malloc(frames * 4);
      this.heapSizeFrames = frames;
    }
  }
};
registerProcessor("rubberband-processor", RubberBandProcessor);
