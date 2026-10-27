import { SidechainRingReader, BASS_TRIGGER_STRIDE } from "../../shared/rt/sidechainTriggerRing";

/** Attack ramp to the note's velocity; an instant step made the grain size jump audibly. */
export const BASS_ENV_ATTACK_SECONDS = 0.01;
/** Default release after the note's duration. */
export const BASS_ENV_RELEASE_SECONDS = 0.1;

/**
 * Bass envelope follower for the granular grain-size modulation
 * (GranularEngine.initGrain / rb_fx: size *= 1 - env * bassEnvDepth).
 *
 * Triggers arrive through a sidechain trigger ring of [time, velocity 0..1,
 * duration s] events (see shared/rt/sidechainTriggerRing.ts), so dense bass lines
 * written ahead of the audio clock are not lost. Per block: linear attack to
 * the velocity, hold for the note's duration, exponential release.
 */
export class BassEnvelopeFollower {
  private reader: SidechainRingReader | null = null;
  private readerSab: ArrayBufferLike | null = null;
  private readonly event = new Float64Array(BASS_TRIGGER_STRIDE);

  private env = 0.0;
  private peak = 0.0;
  private holdUntil = -Infinity;
  private attacking = false;

  private readonly attackSeconds: number;
  private releaseSeconds: number;
  private cachedSampleRate = 0;
  private cachedBlockFrames = 0;
  private cachedReleaseSeconds = 0;
  private cachedReleaseMultPow = 0;

  constructor(options: { attackSeconds?: number; releaseSeconds?: number } = {}) {
    this.attackSeconds = Math.max(0, options.attackSeconds ?? BASS_ENV_ATTACK_SECONDS);
    this.releaseSeconds = Math.max(0.001, options.releaseSeconds ?? BASS_ENV_RELEASE_SECONDS);
  }

  setReleaseSeconds(seconds: number): void {
    if (seconds > 0) this.releaseSeconds = seconds;
  }

  /** Current envelope (0..1), for tests. */
  get value(): number {
    return this.env;
  }

  /** Returns the envelope (0..1) for the block starting at `currentTime`. */
  process(
    sidechain: SharedArrayBuffer | null,
    currentTime: number,
    blockFrames: number,
    sampleRate: number
  ): number {
    if (!sidechain) return 0.0;
    if (sidechain !== this.readerSab) {
      this.readerSab = sidechain;
      this.reader = new SidechainRingReader(sidechain);
    }

    if (this.reader!.poll(currentTime, this.event) > 0) {
      const velocity = this.event[1];
      const duration = this.event[2];
      this.peak = velocity > 0 ? Math.min(1, velocity) : 0;
      this.holdUntil = this.event[0] + (duration > 0 ? duration : 0);
      this.attacking = true;
    }

    if (
      sampleRate !== this.cachedSampleRate ||
      blockFrames !== this.cachedBlockFrames ||
      this.releaseSeconds !== this.cachedReleaseSeconds
    ) {
      this.cachedSampleRate = sampleRate;
      this.cachedBlockFrames = blockFrames;
      this.cachedReleaseSeconds = this.releaseSeconds;
      const releaseFrames = Math.max(1, sampleRate * this.releaseSeconds);
      this.cachedReleaseMultPow = Math.pow(Math.exp(-1.0 / releaseFrames), blockFrames);
    }

    if (this.attacking) {
      // Linear slew toward the peak at full scale per attackSeconds (up or down on a retrigger).
      const step = this.attackSeconds > 0 ? blockFrames / (sampleRate * this.attackSeconds) : 1;
      const delta = this.peak - this.env;
      if (Math.abs(delta) <= step) {
        this.env = this.peak;
        this.attacking = false;
      } else {
        this.env += delta > 0 ? step : -step;
      }
    } else if (currentTime >= this.holdUntil) {
      this.env *= this.cachedReleaseMultPow;
      if (this.env < 1e-6) this.env = 0;
    }

    return this.env;
  }
}
