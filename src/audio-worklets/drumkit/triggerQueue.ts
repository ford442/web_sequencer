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
    let i = this.pending.length - 1;
    while (i >= 0 && this.pending[i].audioTime > entry.audioTime) {
      i--;
    }
    this.pending.splice(i + 1, 0, entry);
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
