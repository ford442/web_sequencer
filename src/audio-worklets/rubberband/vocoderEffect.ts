/**
 * Lightweight Vocoder-like effect (vowels only): zero-crossing pitch tracker driving
 * a synthetic carrier wave (saw/square mix), amplitude-modulated by the dry TTS signal (modulator).
 */
export class VocoderEffect {
  private lastSign = [0, 0];
  private zeroCrossings = [0, 0];
  private periodSamples = [0, 0];
  private phase = [0, 0];
  private env = [0, 0];

  // Smoothing for detected pitch
  private smoothedPeriod = [0, 0];

  // Noise generator state for unvoiced consonants
  private noiseSeed = [1, 2];
  private noiseHp = [0, 0]; // High pass filter state

  private cachedSampleRate = 0;
  private envAttack = 0;
  private envRelease = 0;
  private minPeriod = 0;
  private maxPeriod = 0;

  process(outputs: Float32Array[][], amount: number, isVowel: number, sampleRate: number, phonemeIntensity: number): void {
    if (amount <= 0) return;

    if (sampleRate !== this.cachedSampleRate) {
      this.cachedSampleRate = sampleRate;
      // Fast envelope follower for the modulator (TTS dry signal)
      this.envAttack = Math.exp(-1.0 / (sampleRate * 0.005));
      this.envRelease = Math.exp(-1.0 / (sampleRate * 0.05));
      // Pitch tracker constraints
      this.minPeriod = Math.floor(sampleRate / 800); // Max 800Hz
      this.maxPeriod = Math.floor(sampleRate / 60);  // Min 60Hz
    }

    const envAttack = this.envAttack;
    const envRelease = this.envRelease;
    const minPeriod = this.minPeriod;
    const maxPeriod = this.maxPeriod;

    for (let channel = 0; channel < outputs[0].length; channel++) {
      const outCh = outputs[0][channel];
      if (!outCh) continue;
      if (channel > 1) continue; // Stereo only

      for (let i = 0; i < outCh.length; i++) {
        const x = outCh[i];

        // 1. Amplitude Envelope Following (Modulator)
        const absX = Math.abs(x);
        if (absX > this.env[channel]) {
          this.env[channel] = envAttack * (this.env[channel] - absX) + absX;
        } else {
          this.env[channel] = envRelease * (this.env[channel] - absX) + absX;
        }

        // 2. Pitch Tracking via Zero-Crossing
        const currentSign = x >= 0 ? 1 : -1;
        if (currentSign !== this.lastSign[channel] && currentSign === 1) {
          // Positive zero crossing
          if (this.zeroCrossings[channel] > minPeriod && this.zeroCrossings[channel] < maxPeriod) {
            this.periodSamples[channel] = this.zeroCrossings[channel];
          }
          this.zeroCrossings[channel] = 0;
        } else {
          this.zeroCrossings[channel]++;
        }
        this.lastSign[channel] = currentSign;

        // Smooth the period
        if (this.periodSamples[channel] > 0) {
            if (this.smoothedPeriod[channel] === 0) {
                this.smoothedPeriod[channel] = this.periodSamples[channel];
            } else {
                this.smoothedPeriod[channel] = 0.1 * this.periodSamples[channel] + 0.9 * this.smoothedPeriod[channel];
            }
        }

        // 3. Carrier Generation (Sawtooth)
        let carrier = 0;
        if (this.smoothedPeriod[channel] > 0) {
          const phaseInc = 1.0 / this.smoothedPeriod[channel];
          this.phase[channel] += phaseInc;
          if (this.phase[channel] > 1.0) {
            this.phase[channel] -= 1.0;
          }

          // Basic sawtooth wave -1 to 1
          carrier = (this.phase[channel] * 2.0) - 1.0;
        }

        // 4. Unvoiced Consonant Generation (Noise)
        let noise = 0;
        if (isVowel <= 0) {
            // Dynamic threshold: scale inversely with phonemeIntensity.
            // A base threshold ensures absolute silence gating, but we increase it for quieter phonemes.
            // Clamp intensity to 0.01 to prevent division by zero or massive thresholds.
            const safeIntensity = Math.max(0.01, phonemeIntensity);
            const noiseThreshold = 0.005 / safeIntensity;

            if (this.env[channel] > noiseThreshold) {
                // LCG Pseudo-random noise
                this.noiseSeed[channel] = (this.noiseSeed[channel] * 1664525 + 1013904223) | 0;
                const rawNoise = (this.noiseSeed[channel] / 2147483648.0);

                // 1-pole high-pass filter (approx 2kHz cutoff)
                // hp(t) = alpha * hp(t-1) + alpha * (x(t) - x(t-1)) => approx: y = rawNoise - lowpass
                const alpha = 0.8; // Simple fast hp
                this.noiseHp[channel] = alpha * this.noiseHp[channel] + (1 - alpha) * rawNoise;
                noise = rawNoise - this.noiseHp[channel];
            } else {
                // Fade out HP state to prevent click when threshold is crossed again
                this.noiseHp[channel] *= 0.9;
            }

            // For unvoiced, we rely entirely on noise, zero carrier
            carrier = noise;
        }

        // 5. Amplitude Modulation (Vocoder effect)
        // Multiply the generated carrier by the modulator's envelope
        const vocoded = carrier * this.env[channel] * 2.0;

        // 6. Mix with dry signal
        outCh[i] = x * (1.0 - (amount * 0.5)) + (vocoded * amount);
      }
    }
  }
}
