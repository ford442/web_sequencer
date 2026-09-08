// src/audio-worklets/open303/parameterQueue.ts

export interface ScheduledParam {
    func: string;
    value: number;
    audioTime: number;
}

/**
 * Time-ordered queue of parameter changes waiting for their scheduled
 * audioTime. `drain` runs once per audio block on the real-time thread, so it
 * shifts its backing array in place instead of using Array.shift()/splice()
 * (see #1206 — O(N) shift() per parameter was degrading the audio budget).
 */
export class ParameterQueue {
    private readonly pending: ScheduledParam[] = [];
    private readonly applyOne: (exports: Record<string, any>, entry: ScheduledParam) => void;

    constructor(applyOne: (exports: Record<string, any>, entry: ScheduledParam) => void) {
        this.applyOne = applyOne;
    }

    get length(): number {
        return this.pending.length;
    }

    schedule(entry: ScheduledParam): void {
        this.pending.push(entry);
        this.pending.sort((a, b) => a.audioTime - b.audioTime);
    }

    /** Applies every entry due by `now`, then compacts the remainder forward. */
    drain(now: number, exports: Record<string, any>): void {
        const len = this.pending.length;
        if (len === 0) return;

        let processedCount = 0;
        for (let i = 0; i < len; i++) {
            if (this.pending[i].audioTime <= now) {
                this.applyOne(exports, this.pending[i]);
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
