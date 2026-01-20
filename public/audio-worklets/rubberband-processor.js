// src/utils/ringBuffer.ts
var HEAD_INDEX = 0;
var TAIL_INDEX = 1;
var RingBuffer = class {
  sab;
  atomicIndices;
  buffer;
  bufferSize;
  constructor(arg) {
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

// src/engines/rubberband/ExpressiveVoiceProcessor.ts
var DEFAULT_EXPRESSIVE_CONFIG = {
  vibrato: {
    rate: 5.5,
    depth: 0.03,
    enabled: true,
    delay: 0.2,
    rampTime: 0.15
  },
  tremolo: {
    rate: 5,
    depth: 0.1,
    enabled: false
  },
  breath: {
    amount: 0.05,
    filterCutoff: 2e3,
    enabled: true
  },
  sampleRate: 44100
};
var DelayLine = class {
  buffer;
  writeIndex = 0;
  size;
  constructor(maxDelaySamples) {
    this.size = maxDelaySamples;
    this.buffer = new Float32Array(maxDelaySamples);
  }
  write(sample) {
    this.buffer[this.writeIndex] = sample;
    this.writeIndex = (this.writeIndex + 1) % this.size;
  }
  read(delaySamples) {
    const intDelay = Math.floor(delaySamples);
    const frac = delaySamples - intDelay;
    let index1 = this.writeIndex - intDelay - 1;
    if (index1 < 0) index1 += this.size;
    let index2 = index1 - 1;
    if (index2 < 0) index2 += this.size;
    return this.buffer[index1] * (1 - frac) + this.buffer[index2] * frac;
  }
  clear() {
    this.buffer.fill(0);
    this.writeIndex = 0;
  }
};
var ExpressiveVoiceProcessor = class {
  config;
  delayLine;
  // LFO States
  vibratoPhase = 0;
  tremoloPhase = 0;
  // Noise Generation
  noiseBuffer;
  noiseIndex = 0;
  // Time tracking
  sampleIndex = 0;
  constructor(config = {}) {
    this.config = { ...DEFAULT_EXPRESSIVE_CONFIG, ...config };
    const maxDelaySamples = Math.ceil(0.02 * this.config.sampleRate);
    this.delayLine = new DelayLine(maxDelaySamples);
    const noiseSize = this.config.sampleRate;
    this.noiseBuffer = new Float32Array(noiseSize);
    for (let i = 0; i < noiseSize; i++) {
      this.noiseBuffer[i] = Math.random() * 2 - 1;
    }
  }
  /**
   * Process a buffer of audio samples in-place or to a new buffer.
   *
   * @param input Input buffer
   * @param output Output buffer (can be same as input)
   */
  process(input, output) {
    const len = input.length;
    const sampleRate = this.config.sampleRate;
    const vib = this.config.vibrato;
    const trem = this.config.tremolo;
    const breath = this.config.breath;
    const dt = 1 / sampleRate;
    const vibIncrement = vib.rate * dt * 2 * Math.PI;
    const tremIncrement = trem.rate * dt * 2 * Math.PI;
    const maxVibDelayMs = 10;
    const maxVibDelaySamples = maxVibDelayMs * sampleRate / 1e3;
    for (let i = 0; i < len; i++) {
      let sample = input[i];
      const currentTime = this.sampleIndex * dt;
      if (vib.enabled && vib.depth > 0) {
        this.vibratoPhase += vibIncrement;
        if (this.vibratoPhase > 2 * Math.PI) this.vibratoPhase -= 2 * Math.PI;
        let envelope = 1;
        const delay = vib.delay || 0;
        const ramp = vib.rampTime || 0.1;
        if (currentTime < delay) {
          envelope = 0;
        } else if (currentTime < delay + ramp) {
          envelope = (currentTime - delay) / ramp;
        }
        const lfo = Math.sin(this.vibratoPhase);
        const modDelay = (1 + vib.depth * envelope * lfo) * (maxVibDelaySamples * 0.5);
        this.delayLine.write(sample);
        sample = this.delayLine.read(modDelay);
      }
      if (trem.enabled && trem.depth > 0) {
        this.tremoloPhase += tremIncrement;
        if (this.tremoloPhase > 2 * Math.PI) this.tremoloPhase -= 2 * Math.PI;
        const tremLfo = Math.sin(this.tremoloPhase);
        const mod = 1 - trem.depth * 0.5 * (1 + tremLfo);
        sample *= mod;
      }
      if (breath.enabled && breath.amount > 0) {
        const noiseSample = this.noiseBuffer[this.noiseIndex];
        this.noiseIndex = (this.noiseIndex + 1) % this.noiseBuffer.length;
        sample += noiseSample * breath.amount * 0.1;
      }
      output[i] = sample;
      this.sampleIndex++;
    }
  }
  /**
   * Update configuration parameters dynamically.
   */
  updateConfig(newConfig) {
    if (newConfig.vibrato) {
      this.config.vibrato = { ...this.config.vibrato, ...newConfig.vibrato };
    }
    if (newConfig.tremolo) {
      this.config.tremolo = { ...this.config.tremolo, ...newConfig.tremolo };
    }
    if (newConfig.breath) {
      this.config.breath = { ...this.config.breath, ...newConfig.breath };
    }
    if (newConfig.sampleRate) {
      this.config.sampleRate = newConfig.sampleRate;
    }
  }
  /**
   * Reset internal state (phases, etc.)
   */
  reset() {
    this.vibratoPhase = 0;
    this.tremoloPhase = 0;
    this.noiseIndex = 0;
    this.sampleIndex = 0;
    this.delayLine.clear();
  }
};

// src/audio-worklets/rubberband-processor.ts
var RubberBandProcessor = class extends AudioWorkletProcessor {
  rubberBand = null;
  inputRingBuffer = null;
  outputRingBuffer = null;
  expressiveProcessor;
  // WASM Memory Management
  inputHeapPtr = 0;
  outputHeapPtr = 0;
  heapSizeFrames = 0;
  // Current size of allocated buffers
  // Audio State
  sampleRate = 44100;
  initialized = false;
  fullSampleBuffer = null;
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
  constructor() {
    super();
    this.port.onmessage = this.handleMessage.bind(this);
    if (globalThis.sampleRate) {
      this.sampleRate = globalThis.sampleRate;
    }
    this.expressiveProcessor = new ExpressiveVoiceProcessor({
      sampleRate: this.sampleRate
    });
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
        this.expressiveProcessor.reset();
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
    const tremRate = parameters.tremoloRate ? parameters.tremoloRate[0] : 0;
    const breath = parameters.breathIntensity[0];
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
        filterCutoff: 2e3
        // Default value
      }
    });
    this.rubberBand.setPitchScale(pitch);
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
        this.expressiveProcessor.process(outputChannel, outputChannel);
      }
    } catch (e) {
      console.error("DSP Error:", e);
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
