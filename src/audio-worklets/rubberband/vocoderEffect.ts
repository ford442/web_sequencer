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

  process(outputs: Float32Array[][], amount: number, isVowel: number, sampleRate: number): void {
    if (amount <= 0 || isVowel <= 0) return;

    // Fast envelope follower for the modulator (TTS dry signal)
    const envAttack = Math.exp(-1.0 / (sampleRate * 0.005));
    const envRelease = Math.exp(-1.0 / (sampleRate * 0.05));

    // Pitch tracker constraints
    const minPeriod = Math.floor(sampleRate / 800); // Max 800Hz
    const maxPeriod = Math.floor(sampleRate / 60);  // Min 60Hz

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

        // 4. Amplitude Modulation (Vocoder effect)
        // Multiply the generated carrier by the modulator's envelope
        const vocoded = carrier * this.env[channel] * 2.0;

        // 5. Mix with dry signal
        outCh[i] = x * (1.0 - (amount * 0.5)) + (vocoded * amount);
      }
    }
  }
}
