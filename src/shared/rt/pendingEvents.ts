/**
 * PendingEventQueue: records a JS worklet has taken from its EventInbox but
 * whose frame has not come yet (#1497 follow-up P1).
 *
 * The native voices keep their own queue in C++ (hyphon::EventQueue). A
 * worklet that renders in JS (the PCF) holds its records here instead: it
 * drains the inbox at block start, then takes each record whose frame has
 * come and splits the block there, so a parameter lands on its frame and not
 * on the block it happened to arrive in.
 *
 * Records stay sorted by frame, ties in arrival order, so two changes to one
 * param on one frame keep the order they were sent in. Storage is one
 * Float64Array of EventField records: push and shift allocate nothing. A full
 * queue refuses the newest record and counts it, as the rings do.
 *
 * Real-time shared code (src/shared/rt/tsconfig.json): ES2022 only.
 */

import { EVENT_FIELD_COUNT, EventField } from './eventLayout';

const F = EVENT_FIELD_COUNT;

/** Records a queue holds unless told otherwise: well over a lookahead window of automation. */
export const PENDING_EVENTS_DEFAULT_CAPACITY = 256;

export class PendingEventQueue {
  readonly capacity: number;
  private readonly data: Float64Array;
  /** First live record. */
  private start = 0;
  private count = 0;
  private droppedCount = 0;

  constructor(capacity: number = PENDING_EVENTS_DEFAULT_CAPACITY) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error(`pending event capacity must be >= 1 (got ${capacity})`);
    this.capacity = capacity;
    this.data = new Float64Array(capacity * F);
  }

  /** Records waiting. */
  get size(): number {
    return this.count;
  }

  /** Records refused because the queue was full. */
  get dropped(): number {
    return this.droppedCount;
  }

  /** Frame of the earliest record, or +Infinity when there is none. */
  nextFrame(): number {
    return this.count === 0 ? Infinity : this.data[this.start * F + EventField.frame];
  }

  /**
   * Queue `fields` (EventField order) behind every record on the same or an
   * earlier frame. False when the queue was full and it was dropped.
   */
  push(fields: Float64Array): boolean {
    const data = this.data;
    if (this.start + this.count === this.capacity) {
      if (this.start === 0) {
        this.droppedCount++;
        return false;
      }
      data.copyWithin(0, this.start * F, (this.start + this.count) * F);
      this.start = 0;
    }
    const frame = fields[EventField.frame];
    // Walk back from the end: records usually arrive in frame order.
    let slot = this.start + this.count;
    while (slot > this.start && data[(slot - 1) * F + EventField.frame] > frame) slot--;
    const end = this.start + this.count;
    if (slot < end) data.copyWithin((slot + 1) * F, slot * F, end * F);
    const w = slot * F;
    for (let i = 0; i < F; i++) data[w + i] = fields[i];
    this.count++;
    return true;
  }

  /** The earliest record into `out` (EventField order), removed. False when there is none. */
  shift(out: Float64Array): boolean {
    if (this.count === 0) return false;
    const r = this.start * F;
    for (let i = 0; i < F; i++) out[i] = this.data[r + i];
    this.count--;
    this.start = this.count === 0 ? 0 : this.start + 1;
    return true;
  }

  /** Drop every waiting record. */
  clear(): void {
    this.start = 0;
    this.count = 0;
  }
}
