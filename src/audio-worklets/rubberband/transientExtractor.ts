export class TransientExtractor {
  private fastEnv = [0, 0];
  private slowEnv = [0, 0];
  private hpState1 = [0, 0];
  private hpState2 = [0, 0];

  private cachedSampleRate = 0;
  private fastAlpha = 0;
  private slowAlpha = 0;
  private hpAlpha = 0;

  process(outputs: Float32Array[][], amount: number, isVowel: number, sampleRate: number): void {
    if (amount <= 0 || isVowel > 0) {
      // Fast decay when not active to prevent stuck envelopes
      this.fastEnv[0] *= 0.9;
      this.fastEnv[1] *= 0.9;
      this.slowEnv[0] *= 0.9;
      this.slowEnv[1] *= 0.9;
      return;
    }

    if (sampleRate !== this.cachedSampleRate) {
      this.cachedSampleRate = sampleRate;
      this.fastAlpha = Math.exp(-1.0 / (0.001 * sampleRate)); // 1ms
      this.slowAlpha = Math.exp(-1.0 / (0.015 * sampleRate)); // 15ms

      // High-pass filter coefficients for extracting the "click" / "sibilance"
      // ~3kHz cutoff
      const hpCutoff = 3000;
      const dt = 1.0 / sampleRate;
      const rc = 1.0 / (2 * Math.PI * hpCutoff);
      this.hpAlpha = rc / (rc + dt);
    }

    const fastAlpha = this.fastAlpha;
    const slowAlpha = this.slowAlpha;
    const hpAlpha = this.hpAlpha;

    for (let channel = 0; channel < outputs[0].length; channel++) {
      const outCh = outputs[0][channel];
      if (!outCh) continue;

      // ⚡ Bolt: Extract state to local variables outside the inner loop to
      // eliminate O(N) array property lookups per quantum on the hot path.
      let fastEnv = this.fastEnv[channel];
      let slowEnv = this.slowEnv[channel];
      let hpState1 = this.hpState1[channel];
      let hpState2 = this.hpState2[channel];

      for (let i = 0; i < outCh.length; i++) {
        const sample = outCh[i];
        const absSample = Math.abs(sample);

        // Envelope followers
        fastEnv = fastAlpha * fastEnv + (1 - fastAlpha) * absSample;
        slowEnv = slowAlpha * slowEnv + (1 - slowAlpha) * absSample;

        // Transient amount is positive when fast env > slow env
        let transientAmount = fastEnv - slowEnv;
        if (transientAmount < 0) transientAmount = 0;

        // Scale and limit transient modifier
        // Map to roughly 0.0 - 2.0 multiplier
        const transientGain = transientAmount * 10.0 * amount;

        // High-pass the sample to get just the top end
        // Simple 1-pole HPF: y[n] = alpha * (y[n-1] + x[n] - x[n-1])
        const hpOut = hpAlpha * (hpState1 + sample - hpState2);
        hpState1 = hpOut;
        hpState2 = sample;

        // Mix the high-passed transient back into the signal
        outCh[i] = sample + (hpOut * transientGain * 2.0);
      }

      this.fastEnv[channel] = fastEnv;
      this.slowEnv[channel] = slowEnv;
      this.hpState1[channel] = hpState1;
      this.hpState2[channel] = hpState2;
    }
  }
}
