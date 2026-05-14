/// <reference lib="dom" />
/// <reference types="vite/client" />
class VocalOverdriveProcessor extends AudioWorkletProcessor {
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

    for (let channel = 0; channel < input.length; ++channel) {
      const inputChannel = input[channel];
      const outputChannel = output[channel];

      if (!outputChannel) continue;

      for (let i = 0; i < inputChannel.length; ++i) {
        const x = inputChannel[i];
        const drive = isDriveConstant ? driveParams[0] : driveParams[i];

        // Asymmetric tube-like distortion
        // Simple polynomial approach combined with soft clipping
        if (drive > 0) {
            const k = 2 * drive / (1 - drive + 0.01);
            // Asymmetric soft clipping
            const sign = x < 0 ? -1 : 1;
            const y = (1 + k) * x / (1 + k * Math.abs(x));
            // Add second harmonic for tube warmth
            outputChannel[i] = y + (y * y * drive * 0.1) * sign;
        } else {
            outputChannel[i] = x;
        }
      }
    }

    return true;
  }
}

registerProcessor("vocal-overdrive-processor", VocalOverdriveProcessor);
