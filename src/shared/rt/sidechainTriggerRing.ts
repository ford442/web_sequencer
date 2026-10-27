/**
 * Sidechain trigger ring: main thread → singing-voice worklet.
 *
 * The step clock posts notes up to STEP_LOOKAHEAD_MS before they sound, and
 * a step with retrigger > 1 posts several at once. A single shared slot lost
 * every trigger that a later one overwrote before the worklet reached its
 * time (#1350 follow-up). This is a single-producer / single-consumer ring of
 * fixed-stride events instead; the reader parks future events in a
 * preallocated pending pool and fires them when the audio clock gets there.
 *
 * Layout (one SharedArrayBuffer):
 *   Int32[0] write count (wraps; compared with `| 0` arithmetic)
 *   Int32[1] stride, Int32[2] slots, Int32[3] reserved
 *   Float64[slots * stride] from byte 16. Field 0 of every event is its time
 *   on the AudioContext clock, in seconds.
 *
 * The writer fills a slot with plain stores, then publishes it with
 * Atomics.store on the count; the reader's Atomics.load of the count orders
 * those stores before its own reads.
 */

const HEADER_INTS = 4;
const HEADER_BYTES = HEADER_INTS * Int32Array.BYTES_PER_ELEMENT;
const WRITE_COUNT = 0;
const STRIDE = 1;
const SLOTS = 2;

/** A due event older than this is dropped unfired (worklet attached late, or was suspended). */
export const SIDECHAIN_STALE_SECONDS = 0.25;

/** Enough for 40 ms of lookahead at any realistic retrigger / chord density. */
export const SIDECHAIN_RING_SLOTS = 64;

/** [time, velocity 0..1, duration s] */
export const BASS_TRIGGER_STRIDE = 3;
/** [time, velocity 0..1, decay s, isSnare 0|1] */
export const DRUM_TRIGGER_STRIDE = 4;

export function createSidechainRing(stride: number, slots: number = SIDECHAIN_RING_SLOTS): SharedArrayBuffer {
  if (!(stride >= 1 && slots >= 1)) throw new Error(`sidechain ring needs stride and slots >= 1 (got ${stride}, ${slots})`);
  const sab = new SharedArrayBuffer(HEADER_BYTES + slots * stride * Float64Array.BYTES_PER_ELEMENT);
  const header = new Int32Array(sab, 0, HEADER_INTS);
  header[STRIDE] = stride;
  header[SLOTS] = slots;
  return sab;
}

/** True for a buffer laid out by createSidechainRing (and not the old bare Float32 slot). */
export function isSidechainRing(sab: unknown): sab is SharedArrayBuffer {
  if (typeof SharedArrayBuffer === 'undefined' || !(sab instanceof SharedArrayBuffer)) return false;
  if (sab.byteLength < HEADER_BYTES) return false;
  const header = new Int32Array(sab, 0, HEADER_INTS);
  const stride = header[STRIDE];
  const slots = header[SLOTS];
  return stride >= 1 && slots >= 1 && sab.byteLength === HEADER_BYTES + slots * stride * Float64Array.BYTES_PER_ELEMENT;
}

export class SidechainRingWriter {
  private readonly header: Int32Array;
  private readonly data: Float64Array;
  readonly stride: number;
  private readonly slots: number;

  constructor(sab: SharedArrayBuffer) {
    if (!isSidechainRing(sab)) throw new Error('not a sidechain trigger ring');
    this.header = new Int32Array(sab, 0, HEADER_INTS);
    this.stride = this.header[STRIDE];
    this.slots = this.header[SLOTS];
    this.data = new Float64Array(sab, HEADER_BYTES, this.slots * this.stride);
  }

  /** Publishes one event; `values.length` must equal the stride. */
  push(values: ArrayLike<number>): void {
    const count = Atomics.load(this.header, WRITE_COUNT);
    const base = ((count >>> 0) % this.slots) * this.stride;
    for (let i = 0; i < this.stride; i++) this.data[base + i] = values[i] ?? 0;
    Atomics.store(this.header, WRITE_COUNT, (count + 1) | 0);
  }
}

export class SidechainRingReader {
  private readonly header: Int32Array;
  private readonly data: Float64Array;
  readonly stride: number;
  private readonly slots: number;
  private readCount: number;

  // Events read from the ring whose time has not come yet.
  private readonly pending: Float64Array;
  private pendingCount = 0;
  private readonly pendingCap: number;

  /** Events lost to a ring overrun or a full pending pool (telemetry / tests). */
  dropped = 0;
  /** Events that were due long ago when first seen, removed unfired. */
  stale = 0;

  constructor(sab: SharedArrayBuffer, pendingCap: number = SIDECHAIN_RING_SLOTS) {
    if (!isSidechainRing(sab)) throw new Error('not a sidechain trigger ring');
    this.header = new Int32Array(sab, 0, HEADER_INTS);
    this.stride = this.header[STRIDE];
    this.slots = this.header[SLOTS];
    this.data = new Float64Array(sab, HEADER_BYTES, this.slots * this.stride);
    this.pendingCap = pendingCap;
    this.pending = new Float64Array(pendingCap * this.stride);
    // Read whatever the ring still holds: notes can be written before the worklet's
    // first block. poll() drops the ones that are already stale.
    const write = Atomics.load(this.header, WRITE_COUNT);
    this.readCount = (write >>> 0) > this.slots ? (write - this.slots) | 0 : 0;
  }

  /**
   * Drains the ring, removes every pending event due at `now`, and copies the
   * latest-timed of them into `out` (length >= stride). Returns how many fired;
   * several in one block collapse into the last, which retriggers the envelope.
   * Events more than SIDECHAIN_STALE_SECONDS behind `now` are removed unfired.
   */
  poll(now: number, out: Float64Array): number {
    this.drain();
    const stride = this.stride;
    const p = this.pending;
    let fired = 0;
    let bestTime = -Infinity;
    let i = 0;
    while (i < this.pendingCount) {
      const base = i * stride;
      const t = p[base];
      if (t < now - SIDECHAIN_STALE_SECONDS) {
        this.stale++;
        this.removePending(i);
      } else if (t <= now) {
        if (t >= bestTime) {
          bestTime = t;
          for (let k = 0; k < stride; k++) out[k] = p[base + k];
        }
        fired++;
        this.removePending(i);
      } else {
        i++;
      }
    }
    return fired;
  }

  /** Pending (future) events, for tests. */
  get pendingEvents(): number {
    return this.pendingCount;
  }

  private drain(): void {
    const write = Atomics.load(this.header, WRITE_COUNT);
    let unread = (write - this.readCount) | 0;
    if (unread === 0) return;
    if (unread < 0 || unread > this.slots) {
      // Overrun: the oldest slots were already overwritten.
      const lost = unread < 0 ? 0 : unread - this.slots;
      this.dropped += lost;
      this.readCount = (write - Math.min(Math.max(unread, 0), this.slots)) | 0;
      unread = (write - this.readCount) | 0;
    }
    const stride = this.stride;
    for (let n = 0; n < unread; n++) {
      const base = (((this.readCount + n) >>> 0) % this.slots) * stride;
      this.addPending(base);
    }
    this.readCount = write;
  }

  private addPending(srcBase: number): void {
    const stride = this.stride;
    let slot = this.pendingCount;
    if (slot === this.pendingCap) {
      // Pool full: replace the earliest event (the most likely to be stale).
      let earliest = 0;
      for (let i = 1; i < this.pendingCount; i++) {
        if (this.pending[i * stride] < this.pending[earliest * stride]) earliest = i;
      }
      slot = earliest;
      this.dropped++;
    } else {
      this.pendingCount++;
    }
    const dst = slot * stride;
    for (let k = 0; k < stride; k++) this.pending[dst + k] = this.data[srcBase + k];
  }

  private removePending(i: number): void {
    const stride = this.stride;
    const last = this.pendingCount - 1;
    if (i !== last) this.pending.copyWithin(i * stride, last * stride, last * stride + stride);
    this.pendingCount = last;
  }
}
