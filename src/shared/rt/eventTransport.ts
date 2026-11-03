/**
 * The control plane's transport (#1497): how one engine's records get from the
 * main thread into its worklet.
 *
 *   main thread                                         worklet
 *   EngineEventSink.push
 *     RingEventSink     → SAB event ring ─────────────→ EventInbox.pop
 *     MessageEventSink  → one batch message per flush → EventInbox.receive
 *                                                         → local ring → pop
 *
 * Producers see only EngineEventSink, so they never branch on the transport.
 * The worklet sees only EventInbox and drains it at block start the same way
 * either way. Use the ring where SharedArrayBuffer can reach the worklet (the
 * pthread hyphon_native profile: crossOriginIsolated, not WebKit). Everywhere
 * else the message sink batches a tick's records into one postMessage, where
 * there used to be one message per note.
 *
 * A ring transport can also name a ring inside a bigger shared buffer
 * (`byteOffset`): a voice's own native ring in hyphon_native's memory, which
 * its worklet offers once the voice exists (#1497 P2). A RingEventSink on it
 * writes the voice's ring in place and nothing on the worklet side copies the
 * records: the C++ voice takes them at block start.
 *
 * Send `sink.transport` to the worklet once, with the engine's init message,
 * and build the worklet's inbox from it with createEventInbox.
 *
 * Real-time shared code (src/shared/rt/tsconfig.json): ES2022 only.
 */

import { EVENT_BYTES, EventWriter, type EventRecord } from './eventLayout';
import {
  EVENT_RING_DEFAULT_CAPACITY,
  EventRingReader,
  EventRingWriter,
  createEventRing,
  isEventRing,
} from './eventRing';

/** `type` of the fallback's batch message. */
export const EVENT_BATCH_MESSAGE = 'hyphon-rt-events';

/**
 * A ring in shared memory: a SharedArrayBuffer of its own, or a voice's ring
 * at `byteOffset` of hyphon_native's shared memory (#1497 P2).
 */
export interface RingTransport {
  kind: 'ring';
  buffer: SharedArrayBuffer;
  /** Where the ring's header starts in `buffer`; 0 when omitted. */
  byteOffset?: number;
}

/** How a worklet receives an engine's records. Structured-cloneable. */
export type EventTransport = RingTransport | { kind: 'message'; capacity: number };

/** One flush of the postMessage fallback: `count` records, packed. */
export interface EventBatchMessage {
  type: typeof EVENT_BATCH_MESSAGE;
  count: number;
  /** count * EVENT_BYTES bytes, transferred. */
  records: ArrayBuffer;
}

/** The one MessagePort method the fallback needs. */
export interface EventPort {
  postMessage(message: unknown, transfer: ArrayBuffer[]): void;
}

/** Producer side of one engine's transport. */
export interface EngineEventSink {
  /** What the worklet needs to build its inbox (createEventInbox). */
  readonly transport: EventTransport;
  /**
   * Queue one record. False when it was dropped (and counted). A double passed
   * here is boxed wherever the JIT does not inline the call; hot producers
   * use pushFrom.
   */
  push(frame: number, type: number, target: number, value: number, a0?: number, a1?: number, a2?: number, a3?: number): boolean;
  /** push() from a Float64Array record (EventField order): no boxing. */
  pushFrom(fields: Float64Array): boolean;
  /**
   * Hand everything pushed since the last flush to the worklet. Call it at the
   * end of a producer's tick, and before any port message that must arrive
   * after these records (a transport stop). A no-op for the ring.
   */
  flush(): void;
  /** Records refused because the transport was full. */
  readonly dropped: number;
  /** True when flush() has work to do. */
  readonly needsFlush: boolean;
}

/**
 * Records go straight into a SharedArrayBuffer ring; nothing is posted. Given
 * a capacity, the sink makes a ring of its own. Given a RingTransport, it
 * writes that ring in place: a voice's native ring that its worklet offered
 * (parseRingTransport). The sink is then that ring's one producer.
 */
export class RingEventSink implements EngineEventSink {
  readonly transport: RingTransport;
  readonly needsFlush = false;
  private readonly ring: EventRingWriter;

  constructor(ring: number | RingTransport = EVENT_RING_DEFAULT_CAPACITY) {
    if (typeof ring === 'number') {
      const buffer = createEventRing(ring, true) as SharedArrayBuffer;
      this.ring = new EventRingWriter(buffer);
      this.transport = { kind: 'ring', buffer };
    } else {
      const byteOffset = ring.byteOffset ?? 0;
      this.ring = new EventRingWriter(ring.buffer, byteOffset);
      this.transport = { kind: 'ring', buffer: ring.buffer, byteOffset };
    }
  }


  push(frame: number, type: number, target: number, value: number, a0 = 0, a1 = 0, a2 = 0, a3 = 0): boolean {
    return this.ring.push(frame, type, target, value, a0, a1, a2, a3);
  }

  pushFrom(fields: Float64Array): boolean {
    return this.ring.pushFrom(fields);
  }

  flush(): void {}

  get dropped(): number {
    return this.ring.dropped;
  }

  /** Most records the worklet had not drained yet, at any push. */
  get highWater(): number {
    return this.ring.highWater;
  }
}

/**
 * The fallback where no SharedArrayBuffer reaches the worklet (the
 * single-threaded hyphon_native profile: WebKit, pages that are not
 * crossOriginIsolated). Records are staged in place, and flush() posts them as
 * one transferred buffer. A full stage flushes early instead of dropping.
 */
export class MessageEventSink implements EngineEventSink {
  readonly transport: EventTransport;
  readonly dropped = 0;
  /** Batches posted, for tests and telemetry. */
  batches = 0;
  private readonly port: EventPort;
  private readonly capacity: number;
  private readonly staging: ArrayBuffer;
  private readonly writer: EventWriter;
  private count = 0;

  constructor(port: EventPort, capacity: number = EVENT_RING_DEFAULT_CAPACITY) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error(`event batch capacity must be >= 1 (got ${capacity})`);
    this.port = port;
    this.capacity = capacity;
    this.staging = new ArrayBuffer(capacity * EVENT_BYTES);
    this.writer = new EventWriter(this.staging);
    this.transport = { kind: 'message', capacity };
  }

  get needsFlush(): boolean {
    return this.count > 0;
  }

  push(frame: number, type: number, target: number, value: number, a0 = 0, a1 = 0, a2 = 0, a3 = 0): boolean {
    if (this.count === this.capacity) this.flush();
    this.writer.write(this.count++, frame, type, target, value, a0, a1, a2, a3);
    return true;
  }

  pushFrom(fields: Float64Array): boolean {
    if (this.count === this.capacity) this.flush();
    this.writer.writeFrom(this.count++, fields);
    return true;
  }

  flush(): void {
    if (this.count === 0) return;
    const records = this.staging.slice(0, this.count * EVENT_BYTES);
    const message: EventBatchMessage = { type: EVENT_BATCH_MESSAGE, count: this.count, records };
    this.count = 0;
    this.batches++;
    this.port.postMessage(message, [records]);
  }
}

/** The sink choice in one place: the ring when the caller allows it and SharedArrayBuffer exists. */
export function createEngineEventSink(
  port: EventPort,
  options: { ring: boolean; capacity?: number },
): EngineEventSink {
  const capacity = options.capacity ?? EVENT_RING_DEFAULT_CAPACITY;
  if (options.ring && typeof SharedArrayBuffer !== 'undefined') return new RingEventSink(capacity);
  return new MessageEventSink(port, capacity);
}

/** True for a batch posted by MessageEventSink. */
export function isEventBatchMessage(data: unknown): data is EventBatchMessage {
  if (typeof data !== 'object' || data === null) return false;
  const m = data as Partial<EventBatchMessage>;
  return (
    m.type === EVENT_BATCH_MESSAGE &&
    m.records instanceof ArrayBuffer &&
    Number.isInteger(m.count) &&
    (m.count as number) >= 0 &&
    (m.count as number) * EVENT_BYTES <= m.records.byteLength
  );
}

/**
 * Worklet side of one engine's transport. pop() drains it at block start
 * whichever transport it was built on. The message fallback lands each batch
 * in a local ring first, so it has the same order and overflow policy as the
 * shared ring: a full ring drops the newest record and counts it.
 */
export class EventInbox {
  readonly kind: EventTransport['kind'];
  private readonly reader: EventRingReader;
  /** Message fallback: where receive() lands batches. */
  private readonly local: EventRingWriter | null;

  constructor(transport: EventTransport) {
    this.kind = transport.kind;
    if (transport.kind === 'ring') {
      this.reader = new EventRingReader(transport.buffer, transport.byteOffset ?? 0);
      this.local = null;
    } else {
      // The worklet drains every block, so a batch's capacity is plenty.
      let capacity = 2;
      while (capacity < transport.capacity) capacity *= 2;
      const buffer = createEventRing(capacity, false);
      this.reader = new EventRingReader(buffer);
      this.local = new EventRingWriter(buffer);
    }
  }

  /**
   * Port handler hook: true when `data` was an event batch, which is now
   * queued. Call it first in the worklet's onmessage.
   */
  receive(data: unknown): boolean {
    if (!isEventBatchMessage(data)) return false;
    const local = this.local;
    if (!local) return true; // a ring inbox has no use for a batch
    const words = new Int32Array(data.records, 0, data.count * (EVENT_BYTES / Int32Array.BYTES_PER_ELEMENT));
    for (let i = 0; i < data.count; i++) local.pushCopy(words, i);
    return true;
  }

  /** Oldest queued record into `out`. False when there is none. */
  pop(out: EventRecord): boolean {
    return this.reader.pop(out);
  }

  /** pop() into a Float64Array (EventField order): what process() uses, allocation-free. */
  popInto(out: Float64Array): boolean {
    return this.reader.popInto(out);
  }

  /** Records queued and not yet popped. */
  get size(): number {
    return this.reader.size;
  }

  /** Records dropped because the ring was full: by the producer (ring) or receive() (message). */
  get dropped(): number {
    return this.reader.dropped;
  }

  /** Most records that were ever queued at once. */
  get highWater(): number {
    return this.reader.highWater;
  }
}

/**
 * A ring descriptor that arrived in a port message, checked: a
 * SharedArrayBuffer holding a ring of this schema version at its byteOffset.
 * Null for anything else: no descriptor, a plain ArrayBuffer (which a port
 * would have copied, not shared) or a stale layout.
 */
export function parseRingTransport(transport: unknown): RingTransport | null {
  if (typeof transport !== 'object' || transport === null) return null;
  const t = transport as { kind?: unknown; buffer?: unknown; byteOffset?: unknown };
  if (t.kind !== 'ring') return null;
  if (typeof SharedArrayBuffer === 'undefined' || !(t.buffer instanceof SharedArrayBuffer)) return null;
  const byteOffset = t.byteOffset === undefined ? 0 : t.byteOffset;
  if (typeof byteOffset !== 'number' || !isEventRing(t.buffer, byteOffset)) return null;
  return { kind: 'ring', buffer: t.buffer, byteOffset };
}

/**
 * An inbox for a transport descriptor that arrived in a port message, or null
 * when `transport` is not one (an old main thread, or no control plane).
 */
export function createEventInbox(transport: unknown): EventInbox | null {
  const ring = parseRingTransport(transport);
  if (ring) return new EventInbox(ring);
  if (typeof transport !== 'object' || transport === null) return null;
  const t = transport as { kind?: unknown; capacity?: unknown };
  if (t.kind === 'message' && typeof t.capacity === 'number' && Number.isInteger(t.capacity) && t.capacity >= 1) {
    return new EventInbox({ kind: 'message', capacity: Math.min(t.capacity, 1 << 16) });
  }
  return null;
}
