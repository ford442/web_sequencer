interface AudioWorkletProcessor {
    readonly port: MessagePort;
    process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}

declare const AudioWorkletProcessor: {
    prototype: AudioWorkletProcessor;
    new(options?: unknown): AudioWorkletProcessor;
};

declare function registerProcessor(name: string, processorCtor: (new (options?: unknown) => AudioWorkletProcessor)): void;

class HyphonAgentRecorder extends AudioWorkletProcessor {
  active = true;
  left = new Float32Array(4096);
  right = new Float32Array(4096);
  fill = 0;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<string>) => {
      if (e.data === 'stop') {
        this.flush();
        this.active = false;
        this.port.postMessage('stopped');
      }
    };
  }

  flush() {
    if (this.fill === 0) return;
    this.port.postMessage([this.left.slice(0, this.fill), this.right.slice(0, this.fill)]);
    this.fill = 0;
  }

  process(inputs: Float32Array[][]) {
    if (!this.active) return false;
    const input = inputs[0];
    const l = input && input[0];
    const r = (input && input[1]) || l;
    const n = l ? l.length : 128;
    for (let i = 0; i < n; i++) {
      this.left[this.fill] = l ? l[i] : 0;
      this.right[this.fill] = r ? r[i] : 0;
      if (++this.fill === this.left.length) this.flush();
    }
    return true;
  }
}

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
registerProcessor('hyphon-agent-recorder', HyphonAgentRecorder);
