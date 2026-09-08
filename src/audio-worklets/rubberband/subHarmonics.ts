/**
 * Sub-octave generator (vowels only): zero-crossing frequency divider driving
 * a smoothed square wave, soft-clipped and mixed under the dry signal.
 */
export class SubHarmonicsEffect {
  private lastSign = [0, 0];
  private subToggle = [1, 1];
  private lp1 = [0, 0];
  private lp2 = [0, 0];

  process(outputs: Float32Array[][], effectiveSubAmount: number, isVowel: number, sampleRate: number): void {
    if (effectiveSubAmount <= 0 || isVowel <= 0) return;

    // Simple 1-pole LPF for the sub-octave square wave, cutoff around 80Hz
    const cutoffFreq = 80;
    const rc = 1.0 / (2.0 * Math.PI * cutoffFreq);
    const dt = 1.0 / sampleRate;
    const alpha = dt / (rc + dt);

    for (let channel = 0; channel < outputs[0].length; channel++) {
      const outCh = outputs[0][channel];
      if (!outCh) continue;
      if (channel > 1) continue; // Stereo only

      for (let i = 0; i < outCh.length; i++) {
        const x = outCh[i];

        // Zero crossing detector to divide frequency by 2
        const currentSign = x >= 0 ? 1 : -1;
        if (currentSign !== this.lastSign[channel]) {
          if (currentSign === 1) {
            this.subToggle[channel] = -this.subToggle[channel];
          }
          this.lastSign[channel] = currentSign;
        }

        // Raw sub-octave square wave
        const rawSub = this.subToggle[channel] * 0.5;

        // Apply low-pass filter twice (2-pole approximation) to make it smooth/sine-like
        this.lp1[channel] = this.lp1[channel] + alpha * (rawSub - this.lp1[channel]);
        this.lp2[channel] = this.lp2[channel] + alpha * (this.lp1[channel] - this.lp2[channel]);

        // Apply subtle soft-clipping saturation to the sub-harmonic
        const drive = 2.5;
        const drivenSub = this.lp2[channel] * 4.0 * drive;
        const saturatedSub = drivenSub / (1.0 + Math.abs(drivenSub));

        // Compensate for gain loss and mix with the dry signal
        const finalSub = (saturatedSub / drive) * 4.0;
        outCh[i] = x + (finalSub * effectiveSubAmount);
      }
    }
  }
}
