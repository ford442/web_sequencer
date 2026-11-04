/**
 * Event ring: a single-producer / single-consumer queue of control-plane
 * records (#1497), the 32-byte hyphon::Event layout from eventLayout.ts.
 *
 * It replaces a port message per note / param / trigger. The main thread
 * writes records straight into shared memory and the worklet drains them at
 * block start, so nothing is structured-cloned and nothing allocates. The same
 * class also backs the worklet side of the postMessage fallback
 * (eventTransport.ts), on a plain ArrayBuffer whose two ends share a thread.
 *
 * A ring can sit anywhere in a buffer (`byteOffset`): in a SharedArrayBuffer
 * of its own (createEventRing), or in place inside hyphon_native's shared
 * memory, where hyphon::EventRing laid it out (#1497 P2). Then the main thread
 * writes a voice's own native ring and the C++ consumer takes the records
 * from there, with no copy in between.
 *
 * Layout (EventRingWord, generated from emscripten/core/event_schema.json for
 * this file and hyphon::EventRingHeader alike):
 *   Int32[0]   write count   producer; uint32, wraps
 *   Int32[1]   dropped       producer: pushes refused because the ring was full
 *   Int32[2]   high water    producer: most records ever unread at once
 *   Int32[16]  read count    consumer; on its own 64-byte line
 *   Int32[24]  magic, Int32[25] schema version, Int32[26] capacity
 *   records from byte 128, EVENT_BYTES each; capacity is a power of two
 *
 * Overflow: a full ring refuses the newest record and counts it in `dropped`.
 * It never overwrites a record the consumer has not read, which is the
 * hyphon::EventRing policy too.
 *
 * Ordering: the writer fills a slot with plain stores, then publishes it with
 * Atomics.store on the write count. The reader's Atomics.load of the count
 * orders those stores before its own reads. The read count works the same way
 * in the other direction, so a slot is never rewritten while it is being read.
 *
 * Real-time shared code (src/shared/rt/tsconfig.json): ES2022 only.
 */

import {
  EVENT_BYTES,
  EVENT_RING_HEADER_BYTES,
  EVENT_RING_MAGIC,
  EVENT_SCHEMA_VERSION,
  EventReader,
  EventRingWord,
  EventWriter,
  type EventRecord,
} from './eventLayout';

export { EVENT_RING_HEADER_BYTES };
/** Enough for a bar of dense steps at the 40 ms step lookahead, with headroom. */
export const EVENT_RING_DEFAULT_CAPACITY = 256;

const HEADER_INTS = EVENT_RING_HEADER_BYTES / Int32Array.BYTES_PER_ELEMENT;
const WRITE = EventRingWord.write;
const DROPPED = EventRingWord.dropped;
const HIGH_WATER = EventRingWord.highWater;
const READ = EventRingWord.read;
const MAGIC = EventRingWord.magic;
const VERSION = EventRingWord.version;
const CAPACITY = EventRingWord.capacity;

const isPowerOfTwo = (n: number) => Number.isInteger(n) && n >= 2 && (n & (n - 1)) === 0;

/** Bytes a ring of `capacity` records takes. */
export function eventRingBytes(capacity: number): number {
  return EVENT_RING_HEADER_BYTES + capacity * EVENT_BYTES;
}

/**
 * Lay an empty ring of `capacity` records out at `byteOffset` of `buffer`,
 * as hyphon::EventRing's constructor does: counts zeroed, then the magic,
 * the schema version and the capacity. The bytes must be the ring's alone.
 */
export function formatEventRing(buffer: ArrayBufferLike, byteOffset: number, capacity: number): void {
  if (!isPowerOfTwo(capacity) || capacity > 0x40000000) {
    throw new Error(`event ring capacity must be a power of two >= 2 (got ${capacity})`);
  }
  if (!Number.isInteger(byteOffset) || byteOffset < 0 || byteOffset % 8 !== 0 ||
      byteOffset + eventRingBytes(capacity) > buffer.byteLength) {
    throw new Error(`an event ring of ${capacity} does not fit at byte ${byteOffset} of ${buffer.byteLength}`);
  }
  const header = new Int32Array(buffer, byteOffset, HEADER_INTS);
  header.fill(0);
  header[MAGIC] = EVENT_RING_MAGIC;
  header[VERSION] = EVENT_SCHEMA_VERSION;
  header[CAPACITY] = capacity;
}

/**
 * A new, empty ring. `shared` (the default) puts it in a SharedArrayBuffer
 * that both threads can see. A plain ArrayBuffer is for a ring whose two ends
 * live on one thread.
 */
export function createEventRing(capacity: number = EVENT_RING_DEFAULT_CAPACITY, shared = true): ArrayBufferLike {
  if (!isPowerOfTwo(capacity) || capacity > 0x40000000) {
    throw new Error(`event ring capacity must be a power of two >= 2 (got ${capacity})`);
  }
  if (shared && typeof SharedArrayBuffer === 'undefined') {
    throw new Error('SharedArrayBuffer is unavailable: use the postMessage event sink');
  }
  const bytes = eventRingBytes(capacity);
  const buffer = shared ? new SharedArrayBuffer(bytes) : new ArrayBuffer(bytes);
  formatEventRing(buffer, 0, capacity);
  return buffer;
}

function isBuffer(buffer: unknown): buffer is ArrayBufferLike {
  return (
    buffer instanceof ArrayBuffer ||
    (typeof SharedArrayBuffer !== 'undefined' && buffer instanceof SharedArrayBuffer)
  );
}

/**
 * True when `byteOffset` of `buffer` holds a ring of this schema version that
 * fits inside the buffer: one createEventRing or formatEventRing laid out, or
 * a hyphon::EventRing in wasm memory.
 */
export function isEventRing(buffer: unknown, byteOffset = 0): buffer is ArrayBufferLike {
  if (!isBuffer(buffer) || !Number.isInteger(byteOffset) || byteOffset < 0 || byteOffset % 8 !== 0) return false;
  if (byteOffset + EVENT_RING_HEADER_BYTES > buffer.byteLength) return false;
  const header = new Int32Array(buffer, byteOffset, HEADER_INTS);
  const capacity = header[CAPACITY];
  return (
    header[MAGIC] === EVENT_RING_MAGIC &&
    header[VERSION] === EVENT_SCHEMA_VERSION &&
    isPowerOfTwo(capacity) &&
    byteOffset + eventRingBytes(capacity) <= buffer.byteLength
  );
}

/** What both ends can read: fill level and the producer's counters. */
abstract class EventRingEnd {
  readonly buffer: ArrayBufferLike;
  /** Where the ring's header starts in `buffer`. */
  readonly byteOffset: number;
  readonly capacity: number;
  protected readonly header: Int32Array;
  protected readonly mask: number;

  protected constructor(buffer: ArrayBufferLike, byteOffset: number) {
    if (!isEventRing(buffer, byteOffset)) {
      throw new Error(`not an event ring of this schema version at byte ${byteOffset}`);
    }
    this.buffer = buffer;
    this.byteOffset = byteOffset;
    this.header = new Int32Array(buffer, byteOffset, HEADER_INTS);
    this.capacity = this.header[CAPACITY];
    this.mask = this.capacity - 1;
  }

  /** Records written and not yet read. */
  get size(): number {
    return (Atomics.load(this.header, WRITE) - Atomics.load(this.header, READ)) >>> 0;
  }

  /** Pushes refused because the ring was full: the newest record is dropped. */
  get dropped(): number {
    return Atomics.load(this.header, DROPPED) >>> 0;
  }

  /** Most records that were ever unread at once. */
  get highWater(): number {
    return Atomics.load(this.header, HIGH_WATER);
  }
}

/** Producer end. Exactly one per ring. */
export class EventRingWriter extends EventRingEnd {
  private readonly slots: EventWriter;
  private highWaterMark: number;

  constructor(buffer: ArrayBufferLike, byteOffset = 0) {
    super(buffer, byteOffset);
    this.slots = new EventWriter(buffer, byteOffset + EVENT_RING_HEADER_BYTES, this.capacity);
    this.highWaterMark = Atomics.load(this.header, HIGH_WATER);
  }

  /** Queue one record. False, counted in `dropped`, when the ring is full. */
  push(frame: number, type: number, target: number, value: number, a0 = 0, a1 = 0, a2 = 0, a3 = 0): boolean {
    const w = this.claim();
    if (w < 0) return false;
    this.slots.write(w & this.mask, frame, type, target, value, a0, a1, a2, a3);
    this.publish(w);
    return true;
  }

  /**
   * Queue a Float64Array record (EventField order). The hot-path form: values
   * that stay in typed arrays are never boxed. False, counted, when full.
   */
  pushFrom(fields: Float64Array): boolean {
    const w = this.claim();
    if (w < 0) return false;
    this.slots.writeFrom(w & this.mask, fields);
    this.publish(w);
    return true;
  }

  /**
   * Queue record `from` of `source` (the int32 words of a run of records) as
   * is: no decode / encode. False, counted, when the ring is full.
   */
  pushCopy(source: Int32Array, from: number): boolean {
    const w = this.claim();
    if (w < 0) return false;
    this.slots.copyFrom(w & this.mask, source, from);
    this.publish(w);
    return true;
  }

  /** The write count to fill, or -1 (and the drop counted) when the ring is full. */
  private claim(): number {
    const w = Atomics.load(this.header, WRITE) >>> 0;
    const used = (w - (Atomics.load(this.header, READ) >>> 0)) >>> 0;
    if (used >= this.capacity) {
      Atomics.add(this.header, DROPPED, 1);
      return -1;
    }
    if (used + 1 > this.highWaterMark) {
      this.highWaterMark = used + 1;
      Atomics.store(this.header, HIGH_WATER, this.highWaterMark);
    }
    return w;
  }

  private publish(w: number): void {
    Atomics.store(this.header, WRITE, (w + 1) | 0);
  }
}

/** Consumer end. Exactly one per ring. */
export class EventRingReader extends EventRingEnd {
  private readonly slots: EventReader;

  constructor(buffer: ArrayBufferLike, byteOffset = 0) {
    super(buffer, byteOffset);
    this.slots = new EventReader(buffer, byteOffset + EVENT_RING_HEADER_BYTES, this.capacity);
  }

  /**
   * Oldest unread record into `out`. False when the ring is empty. Storing a
   * double into an object field allocates; the audio thread uses popInto.
   */
  pop(out: EventRecord): boolean {
    const r = Atomics.load(this.header, READ);
    if (r === Atomics.load(this.header, WRITE)) return false;
    this.slots.read(r & this.mask, out);
    Atomics.store(this.header, READ, (r + 1) | 0);
    return true;
  }

  /** Oldest unread record into a Float64Array (EventField order); allocates nothing. */
  popInto(out: Float64Array): boolean {
    const r = Atomics.load(this.header, READ);
    if (r === Atomics.load(this.header, WRITE)) return false;
    this.slots.readInto(r & this.mask, out);
    Atomics.store(this.header, READ, (r + 1) | 0);
    return true;
  }
}
