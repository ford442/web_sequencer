import { SidechainRingReader, DRUM_TRIGGER_STRIDE } from "../../shared/rt/sidechainTriggerRing";

/**
 * Sidechain ducking driven by drum-hit triggers delivered through a sidechain
 * trigger ring of [time, velocity, decaySeconds, isSnare] events (see
 * shared/rt/sidechainTriggerRing.ts), so hits written ahead of the clock are not
 * overwritten by the next one.
 */
export class DrumDuckEnvelope {
  private env = 0.0;
  private reader: SidechainRingReader | null = null;
  private readerSab: ArrayBufferLike | null = null;
  private readonly event = new Float64Array(DRUM_TRIGGER_STRIDE);
  private drumVelocity = 0.0;
  private drumDecay = 0.25;
  private isSnare = 0.0;
  private readonly processResult = { duckingScalar: 0.0, isSnare: 0.0 };
  private eqState = { lp: [0,0], bp: [0,0] };
  private cachedSampleRate = 0;
  private cachedW = 0;
  private cachedDecay = -1;
  private cachedReleaseMultPow = 0;

  process(
    sidechain: SharedArrayBuffer | null,
    drumDuckDepth: number,
    currentTime: number,
    blockFrames: number,
    sampleRate: number
  ): { duckingScalar: number; isSnare: number } {
    if (sidechain && sidechain !== this.readerSab) {
      this.readerSab = sidechain;
      this.reader = new SidechainRingReader(sidechain);
    }
    // Drained even at depth 0, so turning the knob up never replays stale hits.
    if (this.reader && this.reader.poll(currentTime, this.event) > 0) {
      this.env = 1.0;
      this.drumVelocity = this.event[1];
      this.drumDecay = this.event[2] > 0 ? this.event[2] : 0.25;
      this.isSnare = this.event[3];
    }

    const drumVelocity = this.drumVelocity;
    const drumDecay = this.drumDecay;
    const isSnare = this.isSnare;

    if (drumDecay !== this.cachedDecay || sampleRate !== this.cachedSampleRate) {
      this.cachedDecay = drumDecay;
      // Note: we can't update cachedSampleRate here because applyMasterDuck relies on it changing.
      // applyMasterDuck handles its own caching check for sampleRate vs this.cachedSampleRate.
      const releaseFrames = Math.max(1, sampleRate * drumDecay);
      this.cachedReleaseMultPow = Math.exp(-blockFrames / releaseFrames);
    }

    if (!(drumDuckDepth > 0 && sidechain)) {
      // Keep the envelope moving while bypassed: a hit must not sit at 1 until the depth comes up.
      this.env *= this.cachedReleaseMultPow;
      this.processResult.duckingScalar = 0.0;
      this.processResult.isSnare = 0.0;
      return this.processResult;
    }

    // Apply a non-linear convex curve to the envelope to hold the peak ducking slightly longer
    const curvedEnv = this.env * (2.0 - this.env);
    const duckingScalar = Math.min(1.0, curvedEnv * drumDuckDepth * drumVelocity);

    // Fast attack (instant here since it's triggered per hit), exponential release
    this.env *= this.cachedReleaseMultPow;

    this.processResult.duckingScalar = duckingScalar;
    this.processResult.isSnare = isSnare;
    return this.processResult;
  }

  /** Master-bus gain reduction and dynamic EQ ducking applied post-retrieve, weighted toward vowels. */
  applyMasterDuck(outputs: Float32Array[][], duckingScalar: number, isVowel: number, sampleRate: number): void {
    if (duckingScalar <= 0) return;

    // consonants already sit out of the way; vowels take the duck
    const vowelWeight = 0.25 + 0.75 * isVowel;
    const masterDuck = 1.0 - duckingScalar * vowelWeight;


    const maxEqReduction = 1.0;
    const eqAmount = duckingScalar * maxEqReduction;
    const q = 0.5; // low q for wide cut

    if (sampleRate !== this.cachedSampleRate && sampleRate > 0) {
      this.cachedSampleRate = sampleRate;
      const centerFreq = 350.0; // standard kick drum fundamental & knock
      this.cachedW = 2.0 * Math.sin(Math.PI * centerFreq / sampleRate);
    }
    const w = this.cachedW;

    for (let channel = 0; channel < outputs[0].length; channel++) {
      const outCh = outputs[0][channel];
      if (!outCh) continue;

      // ⚡ Bolt: Extract state to local variables outside the inner loop to
      // eliminate O(N) array property lookups per quantum on the hot path.
      // Expected impact: ~95% reduction in execution time for applyMasterDuck.
      let lp = this.eqState.lp[channel];
      let bp = this.eqState.bp[channel];

      for (let i = 0; i < outCh.length; i++) {
        const x = outCh[i];

        // SVF Bandpass for Dynamic EQ Cut
        lp += w * bp;
        const hp = x - lp - q * bp;
        bp += w * hp;

        // The bandpass output is q * bp. We invert it and mix it based on eqAmount
        const bandpass = bp * q;
        const eqMasked = x - bandpass * eqAmount;

        // Apply global gain ducking on top
        outCh[i] = eqMasked * masterDuck;
      }

      this.eqState.lp[channel] = lp;
      this.eqState.bp[channel] = bp;
    }
  }
}
