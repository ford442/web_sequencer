/// <reference lib="dom" />
/// <reference types="vite/client" />

// Definitions for the AudioWorklet scope
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}

declare function registerProcessor(name: string, processorCtor: new () => AudioWorkletProcessor): void;
declare const sampleRate: number;

class VocalOverdriveProcessor extends AudioWorkletProcessor {
  private lpStates: number[] = [];

  static get parameterDescriptors() {
    return [
      {
        name: "drive",
        defaultValue: 0,
        minValue: 0,
        maxValue: 1,
        automationRate: "a-rate",
      },
    ];
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>) {
    const input = inputs[0];
    const output = outputs[0];

    if (!input || !output || input.length === 0 || output.length === 0) return true;

    const driveParams = parameters.drive;
    const isDriveConstant = driveParams.length === 1;

    // Crossover frequency at ~2.5kHz
    const cutoff = 2500;
    // 1-pole filter coefficient
    const dt = 1.0 / sampleRate;
    const rc = 1.0 / (2.0 * Math.PI * cutoff);
    const alpha = dt / (rc + dt);

    for (let channel = 0; channel < input.length; ++channel) {
      const inputChannel = input[channel];
      const outputChannel = output[channel];

      if (!outputChannel) continue;

      if (this.lpStates[channel] === undefined) {
        this.lpStates[channel] = 0;
      }

      for (let i = 0; i < inputChannel.length; ++i) {
        const x = inputChannel[i];
        const drive = isDriveConstant ? driveParams[0] : driveParams[i];

        // Apply crossover filter
        this.lpStates[channel] = this.lpStates[channel] + alpha * (x - this.lpStates[channel]);
        const low = this.lpStates[channel];
        const high = x - low;

        if (drive > 0) {
            const k = 2 * drive / (1 - drive + 0.01);

            // Asymmetric soft clipping on high band ONLY
            const sign = high < 0 ? -1 : 1;
            const y = (1 + k) * high / (1 + k * Math.abs(high));
            // Add second harmonic for tube warmth to highs
            const saturatedHigh = y + (y * y * drive * 0.1) * sign;

            // Recombine clean low + saturated high
            outputChannel[i] = low + saturatedHigh;
        } else {
            outputChannel[i] = x;
        }
      }
    }

    return true;
  }
}

registerProcessor("vocal-overdrive-processor", VocalOverdriveProcessor);
