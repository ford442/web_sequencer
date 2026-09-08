/** Sample-and-hold downsampler with optional bit-depth reduction. */
export class Bitcrusher {
  private downsamplePhase: number[] = [0, 0];
  private lastSampleValue: number[] = [0, 0];

  process(outputs: Float32Array[][], bitcrushAmount: number, downsampleFactor: number): void {
    if (!(bitcrushAmount > 0 || downsampleFactor > 1.0)) return;

    for (let channel = 0; channel < outputs[0].length; channel++) {
      const outCh = outputs[0][channel];
      if (!outCh) continue;

      for (let i = 0; i < outCh.length; i++) {
        this.downsamplePhase[channel] += 1.0;
        if (this.downsamplePhase[channel] >= downsampleFactor) {
          this.downsamplePhase[channel] -= downsampleFactor;

          if (bitcrushAmount > 0) {
            // bitcrushAmount 0.0 -> 16 bits, 1.0 -> 2 bits
            const bits = 16 - (bitcrushAmount * 14);
            const steps = Math.pow(2, bits);
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
