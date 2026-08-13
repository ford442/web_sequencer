/**
 * Map between DOMHighResTimeStamp (performance.now) and AudioContext.currentTime.
 * Anchored at construction; drift trim via optional offset updates.
 */

export class AudioTimeMap {
  private anchorDom: number;
  private anchorAudio: number;
  /** Extra ms drift correction applied to dom→audio mapping. */
  private driftMs = 0;

  constructor(context: AudioContext) {
    this.anchorDom = typeof performance !== 'undefined' ? performance.now() : 0;
    this.anchorAudio = context.currentTime;
  }

  /** Re-anchor when context resumes after suspend. */
  reanchor(context: AudioContext): void {
    this.anchorDom = typeof performance !== 'undefined' ? performance.now() : 0;
    this.anchorAudio = context.currentTime;
    this.driftMs = 0;
  }

  /** Trim drift: predicted audio time vs observed (seconds). */
  applyDriftCorrection(errorSeconds: number, alpha = 0.1): void {
    this.driftMs += errorSeconds * 1000 * alpha;
  }

  domToAudio(domTime: number): number {
    const deltaSec = (domTime - this.anchorDom + this.driftMs) / 1000;
    return this.anchorAudio + deltaSec;
  }

  audioToDom(audioTime: number): number {
    const deltaSec = audioTime - this.anchorAudio;
    return this.anchorDom + deltaSec * 1000 - this.driftMs;
  }

  nowAudio(context: AudioContext): number {
    const dom = typeof performance !== 'undefined' ? performance.now() : Date.now();
    return Math.max(context.currentTime, this.domToAudio(dom));
  }
}
