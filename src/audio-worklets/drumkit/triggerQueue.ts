/**
 * Time-ordered drum trigger queue drained on the audio clock (AudioWorklet
 * currentTime), not React / rAF time.
 */

export interface ScheduledDrumTrigger {
  audioTime: number;
  voice: number;
  velocity: number;
  a: number;
  b: number;
  c: number;
  d: number;
}

export class DrumTriggerQueue {
  private readonly pending: ScheduledDrumTrigger[] = [];

  get length(): number {
    return this.pending.length;
  }

  schedule(entry: ScheduledDrumTrigger): void {
    this.pending.push(entry);
    this.pending.sort((a, b) => a.audioTime - b.audioTime);
  }

  drain(now: number, apply: (entry: ScheduledDrumTrigger) => void): void {
    const len = this.pending.length;
    if (len === 0) return;

    let processedCount = 0;
    for (let i = 0; i < len; i++) {
      if (this.pending[i].audioTime <= now) {
        apply(this.pending[i]);
        processedCount++;
      } else {
        break;
      }
    }

    if (processedCount === 0) return;
    if (processedCount === len) {
      this.pending.length = 0;
      return;
    }

    const remaining = len - processedCount;
    for (let i = 0; i < remaining; i++) {
      this.pending[i] = this.pending[i + processedCount];
    }
    this.pending.length = remaining;
  }
}
