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

    // Precalculate final multiplier since drive = 2.5 is constant
    const finalMultiplier = (4.0 / 2.5) * effectiveSubAmount;

    const out0 = outputs[0][0];
    const out1 = outputs[0][1];

    if (out0) {
      // ⚡ Bolt: Extract state to local variables outside the inner loop to
      // eliminate O(N) array property lookups per quantum on the hot path.
      let lastSign = this.lastSign[0];
      let subToggle = this.subToggle[0];
      let lp1 = this.lp1[0];
      let lp2 = this.lp2[0];

      for (let i = 0; i < out0.length; i++) {
        const x = out0[i];

        // Zero crossing detector to divide frequency by 2
        const currentSign = x >= 0 ? 1 : -1;
        if (currentSign !== lastSign) {
          if (currentSign === 1) {
            subToggle = -subToggle;
          }
          lastSign = currentSign;
        }

        // Raw sub-octave square wave
        const rawSub = subToggle * 0.5;

        // Apply low-pass filter twice (2-pole approximation) to make it smooth/sine-like
        lp1 = lp1 + alpha * (rawSub - lp1);
        lp2 = lp2 + alpha * (lp1 - lp2);

        // Apply subtle soft-clipping saturation to the sub-harmonic
        // 4.0 * drive = 4.0 * 2.5 = 10.0
        const drivenSub = lp2 * 10.0;
        const saturatedSub = drivenSub / (1.0 + Math.abs(drivenSub));

        out0[i] = x + (saturatedSub * finalMultiplier);
      }

      this.lastSign[0] = lastSign;
      this.subToggle[0] = subToggle;
      this.lp1[0] = lp1;
      this.lp2[0] = lp2;
    }

    if (out1) {
      let lastSign = this.lastSign[1];
      let subToggle = this.subToggle[1];
      let lp1 = this.lp1[1];
      let lp2 = this.lp2[1];

      for (let i = 0; i < out1.length; i++) {
        const x = out1[i];

        // Zero crossing detector to divide frequency by 2
        const currentSign = x >= 0 ? 1 : -1;
        if (currentSign !== lastSign) {
          if (currentSign === 1) {
            subToggle = -subToggle;
          }
          lastSign = currentSign;
        }

        // Raw sub-octave square wave
        const rawSub = subToggle * 0.5;

        // Apply low-pass filter twice (2-pole approximation) to make it smooth/sine-like
        lp1 = lp1 + alpha * (rawSub - lp1);
        lp2 = lp2 + alpha * (lp1 - lp2);

        // Apply subtle soft-clipping saturation to the sub-harmonic
        const drivenSub = lp2 * 10.0;
        const saturatedSub = drivenSub / (1.0 + Math.abs(drivenSub));

        out1[i] = x + (saturatedSub * finalMultiplier);
      }

      this.lastSign[1] = lastSign;
      this.subToggle[1] = subToggle;
      this.lp1[1] = lp1;
      this.lp2[1] = lp2;
    }
  }
}
