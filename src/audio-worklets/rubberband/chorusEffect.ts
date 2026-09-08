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

    for (let i = 0; i < outputs[0][0].length; i++) {
      this.lfoPhase += lfoPhaseInc;
      if (this.lfoPhase > 2.0 * Math.PI) {
        this.lfoPhase -= 2.0 * Math.PI;
      }

      const lfoVal = Math.sin(this.lfoPhase);

      for (let channel = 0; channel < outputs[0].length; channel++) {
        const outCh = outputs[0][channel];
        if (!outCh) continue;

        const buf = this.buffer[channel];

        const dry = outCh[i];
        buf[this.writePtr] = dry;

        // Tap 1: ~12ms, Tap 2: ~18ms
        const delay1Ms = 12.0 + (lfoVal * 3.0 * vocalChorusAmount);
        const delay2Ms = 18.0 + (-lfoVal * 4.0 * vocalChorusAmount);

        const delay1Frames = delay1Ms * 0.001 * fs;
        const delay2Frames = delay2Ms * 0.001 * fs;

        let readPtr1 = this.writePtr - Math.floor(delay1Frames);
        let readPtr2 = this.writePtr - Math.floor(delay2Frames);

        if (readPtr1 < 0) readPtr1 += bufferSize;
        if (readPtr2 < 0) readPtr2 += bufferSize;

        const tap1 = buf[readPtr1];
        const tap2 = buf[readPtr2];

        // Constant power panning. Tap 1 left-biased, Tap 2 right-biased
        let mixedWet = 0;
        if (channel === 0) {
          mixedWet = (tap1 * 0.8) + (tap2 * 0.2);
        } else if (channel === 1) {
          mixedWet = (tap1 * 0.2) + (tap2 * 0.8);
        } else {
          mixedWet = (tap1 + tap2) * 0.5;
        }

        // Dampen dry signal slightly to compensate for wet gain sum
        const dryGain = 1.0 - (currentWet * 0.3);
        const wetGain = currentWet * 0.7;

        outCh[i] = (dry * dryGain) + (mixedWet * wetGain);
      }

      this.writePtr++;
      if (this.writePtr >= bufferSize) {
        this.writePtr = 0;
      }
    }
  }
}
