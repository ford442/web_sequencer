export class TransientExtractor {
  private fastEnv = [0, 0];
  private slowEnv = [0, 0];
  private hpState1 = [0, 0];
  private hpState2 = [0, 0];

  process(outputs: Float32Array[][], amount: number, isVowel: number, sampleRate: number): void {
    if (amount <= 0 || isVowel > 0) {
      // Fast decay when not active to prevent stuck envelopes
      this.fastEnv[0] *= 0.9;
      this.fastEnv[1] *= 0.9;
      this.slowEnv[0] *= 0.9;
      this.slowEnv[1] *= 0.9;
      return;
    }

    const fs = sampleRate;
    const fastAlpha = Math.exp(-1.0 / (0.001 * fs)); // 1ms
    const slowAlpha = Math.exp(-1.0 / (0.015 * fs)); // 15ms

    // High-pass filter coefficients for extracting the "click" / "sibilance"
    // ~3kHz cutoff
    const hpCutoff = 3000;
    const dt = 1.0 / fs;
    const rc = 1.0 / (2 * Math.PI * hpCutoff);
    const hpAlpha = rc / (rc + dt);

    for (let channel = 0; channel < outputs[0].length; channel++) {
      const outCh = outputs[0][channel];
      if (!outCh) continue;

      for (let i = 0; i < outCh.length; i++) {
        const sample = outCh[i];
        const absSample = Math.abs(sample);

        // Envelope followers
        this.fastEnv[channel] = fastAlpha * this.fastEnv[channel] + (1 - fastAlpha) * absSample;
        this.slowEnv[channel] = slowAlpha * this.slowEnv[channel] + (1 - slowAlpha) * absSample;

        // Transient amount is positive when fast env > slow env
        let transientAmount = this.fastEnv[channel] - this.slowEnv[channel];
        if (transientAmount < 0) transientAmount = 0;

        // Scale and limit transient modifier
        // Map to roughly 0.0 - 2.0 multiplier
        const transientGain = transientAmount * 10.0 * amount;

        // High-pass the sample to get just the top end
        // Simple 1-pole HPF: y[n] = alpha * (y[n-1] + x[n] - x[n-1])
        const hpOut = hpAlpha * (this.hpState1[channel] + sample - this.hpState2[channel]);
        this.hpState1[channel] = hpOut;
        this.hpState2[channel] = sample;

        // Mix the high-passed transient back into the signal
        outCh[i] = sample + (hpOut * transientGain * 2.0);
      }
    }
  }
}
