// src/audio-worklets/open303/eventQueue.ts

/** A port message the worklet holds until the audio clock reaches its audioTime. */
export type ScheduledEvent =
    | { kind: 'param'; func: string; value: number; audioTime: number }
    | { kind: 'noteOn'; note: number; velocity: number; audioTime: number }
    | { kind: 'noteOff'; note: number; audioTime: number };

/**
 * Time-ordered queue of note and parameter events waiting for their scheduled
 * audioTime. Notes and params share one queue so events at the same time keep
 * the order they were posted in — a step's drive param lands before its noteOn,
 * and a note's scheduled noteOff before the next step's noteOn (#1344).
 *
 * `drain` runs once per audio block on the real-time thread, so it shifts its
 * backing array in place instead of using Array.shift()/splice() (see #1206 —
 * O(N) shift() per parameter was degrading the audio budget).
 */
export class ScheduledEventQueue {
    private readonly pending: ScheduledEvent[] = [];
    private readonly applyOne: (entry: ScheduledEvent) => void;

    constructor(applyOne: (entry: ScheduledEvent) => void) {
        this.applyOne = applyOne;
    }

    get length(): number {
        return this.pending.length;
    }

    /** Inserts after every entry due at or before `entry.audioTime`, so equal times stay FIFO. */
    schedule(entry: ScheduledEvent): void {
        let i = this.pending.length - 1;
        while (i >= 0 && this.pending[i].audioTime > entry.audioTime) {
            i--;
        }
        this.pending.splice(i + 1, 0, entry);
    }

    /** Applies every entry due by `now`, then compacts the remainder forward. */
    drain(now: number): void {
        const len = this.pending.length;
        if (len === 0) return;

        let processedCount = 0;
        for (let i = 0; i < len; i++) {
            if (this.pending[i].audioTime <= now) {
                this.applyOne(this.pending[i]);
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

    /** Cancels every pending noteOn/noteOff (stop, mute); scheduled params still land. */
    dropNotes(): void {
        let kept = 0;
        for (let i = 0; i < this.pending.length; i++) {
            if (this.pending[i].kind === 'param') {
                this.pending[kept++] = this.pending[i];
            }
        }
        this.pending.length = kept;
    }

    clear(): void {
        this.pending.length = 0;
    }
}
