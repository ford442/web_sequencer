/**
 * Vocal Stack Chorus: post-retrieve micro-delay taps (~12ms / ~18ms) with a
 * slow LFO detune and constant-power L/R panning.
 */
export class VocalChorusEffect {
  private buffer: Float32Array[] = [new Float32Array(48000), new Float32Array(48000)];
  private writePtr = 0;
  private lfoPhase = 0;

  process(outputs: Float32Array[][], vocalChorusAmount: number, isVowel: number, sampleRate: number): void {
    if (vocalChorusAmount <= 0) return;

    // Consonants get 30% of the wet amount to prevent smearing plosives
    const wetMod = isVowel > 0 ? 1.0 : 0.3;
    const currentWet = vocalChorusAmount * wetMod;

    const fs = sampleRate;
    const bufferSize = this.buffer[0].length;

    const lfoRate = 0.6; // Hz
    const lfoPhaseInc = (2.0 * Math.PI * lfoRate) / fs;

    // ⚡ Bolt: Extract state to local variables outside the inner loop to
    // eliminate O(N) array property lookups per quantum on the hot path.
    const len = outputs[0][0].length;
    const out0 = outputs[0][0];
    const out1 = outputs[0][1];
    const buf0 = this.buffer[0];
    const buf1 = this.buffer[1];

    // Dampen dry signal slightly to compensate for wet gain sum
    const dryGain = 1.0 - (currentWet * 0.3);
    const wetGain = currentWet * 0.7;
    const pi2 = 2.0 * Math.PI;

    // Tap 1: ~12ms, Tap 2: ~18ms
    const delay1FramesBase = 12.0 * 0.001 * fs;
    const delay2FramesBase = 18.0 * 0.001 * fs;
    const lfoMult1 = 3.0 * vocalChorusAmount * 0.001 * fs;
    const lfoMult2 = -4.0 * vocalChorusAmount * 0.001 * fs;

    let p = this.lfoPhase;
    let w = this.writePtr;

    if (out0 && out1) {
      for (let i = 0; i < len; i++) {
        p += lfoPhaseInc;
        if (p > pi2) p -= pi2;
        const lfoVal = Math.sin(p);

        let r1 = w - ((delay1FramesBase + lfoVal * lfoMult1) | 0);
        let r2 = w - ((delay2FramesBase + lfoVal * lfoMult2) | 0);

        if (r1 < 0) r1 += bufferSize;
        if (r2 < 0) r2 += bufferSize;

        // Channel 0 (left-biased tap 1)
        const dry0 = out0[i];
        buf0[w] = dry0;
        out0[i] = (dry0 * dryGain) + ((buf0[r1] * 0.8 + buf0[r2] * 0.2) * wetGain);

        // Channel 1 (right-biased tap 2)
        const dry1 = out1[i];
        buf1[w] = dry1;
        out1[i] = (dry1 * dryGain) + ((buf1[r1] * 0.2 + buf1[r2] * 0.8) * wetGain);

        w++;
        if (w >= bufferSize) w = 0;
      }
    } else if (out0) {
      // Fallback for mono
      for (let i = 0; i < len; i++) {
        p += lfoPhaseInc;
        if (p > pi2) p -= pi2;
        const lfoVal = Math.sin(p);

        let r1 = w - ((delay1FramesBase + lfoVal * lfoMult1) | 0);
        let r2 = w - ((delay2FramesBase + lfoVal * lfoMult2) | 0);

        if (r1 < 0) r1 += bufferSize;
        if (r2 < 0) r2 += bufferSize;

        for (let channel = 0; channel < outputs[0].length; channel++) {
          const outCh = outputs[0][channel];
          if (!outCh) continue;

          const buf = this.buffer[channel];
          const dry = outCh[i];
          buf[w] = dry;

          const tap1 = buf[r1];
          const tap2 = buf[r2];

          let mixedWet = 0;
          if (channel === 0) {
            mixedWet = (tap1 * 0.8) + (tap2 * 0.2);
          } else if (channel === 1) {
            mixedWet = (tap1 * 0.2) + (tap2 * 0.8);
          } else {
            mixedWet = (tap1 + tap2) * 0.5;
          }

          outCh[i] = (dry * dryGain) + (mixedWet * wetGain);
        }

        w++;
        if (w >= bufferSize) w = 0;
      }
    }

    this.lfoPhase = p;
    this.writePtr = w;
  }
}
