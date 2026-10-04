/**
 * Bass envelope follower sidechaining driven by bass note triggers delivered through a shared
 * Float32Array [triggerTime, velocity, duration].
 */
export class BassEnvelopeFollower {
  private env = 0.0;
  private lastTrigger = 0.0;
  private currentDuration = 0.0;
  private currentVelocity = 0.0;

  process(
    sidechain: Float32Array | null,
    currentTime: number,
    blockFrames: number,
    sampleRate: number
  ): number {
    if (!sidechain) {
      return 0.0;
    }

    const triggerTime = sidechain[0];
    const velocity = sidechain[1];
    const duration = sidechain[2];

    // Check for a new trigger
    if (triggerTime > this.lastTrigger && currentTime >= triggerTime) {
      this.env = 1.0;
      this.lastTrigger = triggerTime;
      this.currentDuration = duration;
      this.currentVelocity = velocity;
    }

    // Determine if we are in the "hold" phase or "release" phase
    const timeSinceTrigger = currentTime - this.lastTrigger;

    // Fixed release time of 100ms
    const releaseSeconds = 0.1;
    const releaseFrames = Math.max(1, sampleRate * releaseSeconds);
    const releaseMult = Math.exp(-1.0 / releaseFrames);

    // If we are past the note duration, start decaying
    let currentBlockEnv = this.env;
    if (timeSinceTrigger > this.currentDuration) {
       for (let i = 0; i < blockFrames; i++) {
         this.env *= releaseMult;
       }
       currentBlockEnv = this.env;
    }

    // Return the final modulated envelope value (0.0 to 1.0) scaled by velocity
    return currentBlockEnv * this.currentVelocity;
  }
}
