/// <reference lib="dom" />
/// <reference types="vite/client" />

// Definitions for the AudioWorklet scope
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}

declare function registerProcessor(name: string, processorCtor: new () => AudioWorkletProcessor): void;

class VocalOverdriveProcessor extends AudioWorkletProcessor {
  private lp1: Float32Array;

  constructor() {
    super();
    this.lp1 = new Float32Array(2);
  }

  static get parameterDescriptors() {
    return [
      {
        name: "drive",
        defaultValue: 0,
        minValue: 0,
        maxValue: 1,
        automationRate: "a-rate",
      },
      {
        name: "crossoverFrequency",
        defaultValue: 1000,
        minValue: 20,
        maxValue: 20000,
        automationRate: "k-rate",
      }
    ];
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>) {
    const input = inputs[0];
    const output = outputs[0];

    if (!input || !output || input.length === 0 || output.length === 0) return true;

    const driveParams = parameters.drive;
    const isDriveConstant = driveParams.length === 1;
    const crossoverFreqParams = parameters.crossoverFrequency;
    const isCrossoverFreqConstant = crossoverFreqParams?.length === 1;

    // ensure state arrays match channel count
    if (this.lp1.length < input.length) {
        const newLp1 = new Float32Array(input.length);
        newLp1.set(this.lp1);
        this.lp1 = newLp1;
    }

    const sr = sampleRate;

    for (let channel = 0; channel < input.length; ++channel) {
      const inputChannel = input[channel];
      const outputChannel = output[channel];

      if (!outputChannel) continue;

      let lpState = this.lp1[channel];

      for (let i = 0; i < inputChannel.length; ++i) {
        const x = inputChannel[i];
        const drive = isDriveConstant ? driveParams[0] : driveParams[i];
        const crossoverFreq = crossoverFreqParams ? (isCrossoverFreqConstant ? crossoverFreqParams[0] : crossoverFreqParams[i]) : 1000;

        // Calculate 1-pole LP filter alpha
        const alpha = 1 - Math.exp(-2 * Math.PI * crossoverFreq / sr);

        // 1-pole crossover filter
        lpState = lpState + alpha * (x - lpState);
        const lowBand = lpState;
        const highBand = x - lowBand;

        let processedHigh = highBand;

        // Asymmetric tube-like distortion applied to high band only
        if (drive > 0) {
            // Apply a pre-gain to the high band based on drive
            // so we actually get distortion on lower level signals
            const preGain = 1 + drive * 8;
            const hx = highBand * preGain;

            const k = 2 * drive / (1 - drive + 0.01);
            // Asymmetric soft clipping
            const sign = hx < 0 ? -1 : 1;
            const y = (1 + k) * hx / (1 + k * Math.abs(hx));
            // Add second harmonic for tube warmth
            processedHigh = y + (y * y * drive * 0.1) * sign;

            // Compensate for gain so it doesn't blow out
            processedHigh = processedHigh / (1 + drive * 1.5);
        }

        // Sum clean lows and saturated highs
        outputChannel[i] = lowBand + processedHigh;
      }

      this.lp1[channel] = lpState;
    }

    return true;
  }
}

registerProcessor("vocal-overdrive-processor", VocalOverdriveProcessor);
