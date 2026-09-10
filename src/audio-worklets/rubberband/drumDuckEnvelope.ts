/**
 * Sidechain ducking driven by drum-hit triggers delivered through a shared
 * Float32Array [triggerTime, velocity, decaySeconds, isSnare].
 */
export class DrumDuckEnvelope {
  private env = 0.0;
  private lastTrigger = 0.0;
  private readonly processResult = { duckingScalar: 0.0, isSnare: 0.0 };

  process(
    sidechain: Float32Array | null,
    drumDuckDepth: number,
    currentTime: number,
    blockFrames: number,
    sampleRate: number
  ): { duckingScalar: number; isSnare: number } {
    if (!(drumDuckDepth > 0 && sidechain)) {
      this.processResult.duckingScalar = 0.0;
      this.processResult.isSnare = 0.0;
      return this.processResult;
    }

    const triggerTime = sidechain[0];
    const drumVelocity = sidechain[1];
    const drumDecay = sidechain[2];
    const isSnare = sidechain[3];

    if (triggerTime > this.lastTrigger && currentTime >= triggerTime) {
      this.env = 1.0;
      this.lastTrigger = triggerTime;
    }

    const releaseFrames = Math.max(1, sampleRate * drumDecay);
    const releaseMult = Math.exp(-1.0 / releaseFrames);

    const duckingScalar = this.env * drumDuckDepth * drumVelocity;

    // Fast attack (instant here since it's triggered per hit), exponential release
    for (let i = 0; i < blockFrames; i++) {
      this.env *= releaseMult;
    }

    this.processResult.duckingScalar = duckingScalar;
    this.processResult.isSnare = isSnare;
    return this.processResult;
  }

  /** Master-bus gain reduction applied post-retrieve, weighted toward vowels. */
  applyMasterDuck(outputs: Float32Array[][], duckingScalar: number, isVowel: number): void {
    if (duckingScalar <= 0) return;

    // consonants already sit out of the way; vowels take the duck
    const vowelWeight = 0.25 + 0.75 * isVowel;
    const masterDuck = 1.0 - duckingScalar * vowelWeight;

    for (let channel = 0; channel < outputs[0].length; channel++) {
      const outCh = outputs[0][channel];
      if (!outCh) continue;
      for (let i = 0; i < outCh.length; i++) {
        outCh[i] *= masterDuck;
      }
    }
  }
}
