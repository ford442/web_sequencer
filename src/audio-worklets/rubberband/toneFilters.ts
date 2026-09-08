/**
 * Phoneme-brightness low-pass: maps syllable volume to a filter cutoff so
 * quieter phonemes get darker, then applies the phoneme volume as gain.
 * Mono (outputChannel) only.
 */
export class PhonemeToneFilter {
  private state = 0;
  private lastCutoffHz = 20000;

  /** phonemeVolume is null when there is no active phoneme-driven playback. */
  process(outputChannel: Float32Array, phonemeFilterMod: number, phonemeVolume: number | null, sampleRate: number): void {
    if (phonemeVolume !== null) {
      if (phonemeFilterMod > 0.0) {
        const minFc = 200;
        const maxFc = 10000;
        const clampedVol = Math.max(0.0, Math.min(1.0, phonemeVolume));
        const brightness = Math.pow(clampedVol, 0.7);
        const targetFc = minFc + (maxFc - minFc) * (phonemeFilterMod * brightness);

        for (let i = 0; i < outputChannel.length; i++) {
          // Smooth fc over time to prevent zippering
          this.lastCutoffHz = this.lastCutoffHz * 0.99 + targetFc * 0.01;

          const costh = 2.0 - Math.cos(2.0 * Math.PI * this.lastCutoffHz / sampleRate);
          const b1 = Math.sqrt(costh * costh - 1.0) - costh;
          const a0 = 1.0 + b1;

          this.state = a0 * outputChannel[i] - b1 * this.state;
          outputChannel[i] = this.state;
        }
      } else if (outputChannel.length > 0) {
        this.state = outputChannel[outputChannel.length - 1];
      }

      if (phonemeVolume !== 1.0) {
        for (let i = 0; i < outputChannel.length; i++) {
          outputChannel[i] *= phonemeVolume;
        }
      }
    } else if (phonemeFilterMod === 0.0 && outputChannel.length > 0) {
      this.state = outputChannel[outputChannel.length - 1];
    }
  }
}

/** Syllable-driven volume low-pass, weighted toward vowels. */
export class SyllableVolumeFilter {
  private cutoffSmooth = 20000;
  private lp: number[] = [0, 0];

  /** Clears the lowpass hold state; called on noteOn to avoid bleed between notes. */
  resetHoldState(): void {
    this.lp[0] = 0;
    this.lp[1] = 0;
  }

  process(outputs: Float32Array[][], volFilterMod: number, phonemeVolume: number, isVowel: number, sampleRate: number): void {
    if (volFilterMod <= 0) return;

    const amount = volFilterMod * (0.25 + 0.75 * isVowel);
    // Log scale mapping from 400Hz to 8000Hz based on clamped phonemeVolume
    const targetCutoff = 400 * Math.pow(8000 / 400, Math.min(1.0, Math.max(0.0, phonemeVolume)) * amount);

    // Smooth target -> cutoffState at block rate using a fixed ~10ms time constant
    const dt = 1.0 / sampleRate;
    const smoothAlpha = dt / (0.01 + dt);
    this.cutoffSmooth = this.cutoffSmooth + smoothAlpha * (targetCutoff - this.cutoffSmooth);

    const rc = 1.0 / (2.0 * Math.PI * this.cutoffSmooth);
    const alpha = dt / (rc + dt);

    for (let channel = 0; channel < outputs[0].length; channel++) {
      const outCh = outputs[0][channel];
      if (!outCh) continue;
      for (let i = 0; i < outCh.length; i++) {
        this.lp[channel] = this.lp[channel] + alpha * (outCh[i] - this.lp[channel]);
        outCh[i] = this.lp[channel];
      }
    }
  }
}

/** Rhythmic trance-gate amplitude modulator. Mono (outputChannel) only. */
export class TranceGate {
  private phase = 0;
  private currentLfo = 1.0;

  process(outputChannel: Float32Array, gateDepth: number, gateRate: number, sampleRate: number): void {
    if (!(gateDepth > 0 && gateRate > 0)) return;

    const phaseIncrement = (2 * Math.PI * gateRate) / sampleRate;

    for (let i = 0; i < outputChannel.length; i++) {
      this.phase += phaseIncrement;
      if (this.phase > 2 * Math.PI) {
        this.phase -= 2 * Math.PI;
      }

      const targetGate = Math.sin(this.phase) > 0 ? 1.0 : 0.0;

      // ~4-6 ms one-pole smoothing at 44.1/48 kHz - tight but click-free
      this.currentLfo = this.currentLfo * 0.92 + targetGate * 0.08;

      const gateMultiplier = 1.0 - (gateDepth * (1.0 - this.currentLfo));
      outputChannel[i] *= gateMultiplier;
    }
  }
}
