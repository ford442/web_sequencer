/** Sample-and-hold downsampler with optional bit-depth reduction. */
export class Bitcrusher {
  private downsamplePhase: number[] = [0, 0];
  private lastSampleValue: number[] = [0, 0];

  process(outputs: Float32Array[][], bitcrushAmount: number, downsampleFactor: number): void {
    if (!(bitcrushAmount > 0 || downsampleFactor > 1.0)) return;

    // Hoist bitcrush quantization step calculation outside the per-sample loop
    let steps = 0;
    if (bitcrushAmount > 0) {
      const bits = 16 - (bitcrushAmount * 14);
      steps = Math.pow(2, bits);
    }

    for (let channel = 0; channel < outputs[0].length; channel++) {
      const outCh = outputs[0][channel];
      if (!outCh) continue;

      for (let i = 0; i < outCh.length; i++) {
        this.downsamplePhase[channel] += 1.0;
        if (this.downsamplePhase[channel] >= downsampleFactor) {
          this.downsamplePhase[channel] -= downsampleFactor;

          if (bitcrushAmount > 0) {
            this.lastSampleValue[channel] = Math.floor(outCh[i] * steps) / steps;
          } else {
            this.lastSampleValue[channel] = outCh[i];
          }
        }
        outCh[i] = this.lastSampleValue[channel];
      }
    }
  }
}
