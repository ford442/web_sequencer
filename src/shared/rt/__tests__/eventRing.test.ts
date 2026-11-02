import { describe, it, expect } from 'vitest';
import {
  EVENT_RING_HEADER_BYTES,
  EventRingReader,
  EventRingWriter,
  createEventRing,
  eventRingBytes,
  formatEventRing,
  isEventRing,
} from '../eventRing';
import {
  EVENT_BYTES,
  EVENT_FIELD_COUNT,
  EventField,
  EventOffset,
  EventReader,
  EventType,
  EventWriter,
  EVENT_RING_MAGIC,
  EVENT_SCHEMA_VERSION,
  EventRingWord,
  createEventFields,
  createEventRecord,
  isNoteEventType,
  type EventRecord,
} from '../eventLayout';

/** #1497 P1: the SPSC ring of 32-byte control-plane records. */

function ring(capacity: number, shared = true) {
  const buffer = createEventRing(capacity, shared);
  return { buffer, writer: new EventRingWriter(buffer), reader: new EventRingReader(buffer) };
}

function popAll(reader: EventRingReader): EventRecord[] {
  const out: EventRecord[] = [];
  for (let e = createEventRecord(); reader.pop(e); e = createEventRecord()) out.push(e);
  return out;
}

describe('event record layout (generated from emscripten/core/event_schema.json)', () => {
  it('is the 32-byte hyphon::Event: int64 frame, u16 type, u16 target, f32 value, f32 args[4]', () => {
    expect(EVENT_BYTES).toBe(32);
    expect(EventOffset).toEqual({ frame: 0, type: 8, target: 10, value: 12, args: 16 });
  });

  it('keeps the wire ids the native engines already switch on', () => {
    expect(EventType).toMatchObject({ NoteOn: 1, NoteOff: 2, AllNotesOff: 3, Param: 4, Trigger: 5, Engine: 0x100 });
    expect([EventType.ParamRamp, EventType.Mute, EventType.NoteExpression]).toEqual([6, 7, 8]);
  });

  it('a stop cancels exactly the types that start or end a sound', () => {
    const cancelled = Object.values(EventType).filter(isNoteEventType);
    expect(cancelled).toEqual([EventType.NoteOn, EventType.NoteOff, EventType.Trigger]);
  });

  it('writes the bytes a C++ reader expects (little-endian, frame as int64)', () => {
    const buf = new ArrayBuffer(EVENT_BYTES);
    new EventWriter(buf).write(0, 2 ** 33 + 7, EventType.Trigger, 3, 0.5, 1, 2, 3, 4);
    const view = new DataView(buf);
    expect(view.getBigInt64(0, true)).toBe(2n ** 33n + 7n);
    expect(view.getUint16(8, true)).toBe(5);
    expect(view.getUint16(10, true)).toBe(3);
    expect(view.getFloat32(12, true)).toBe(0.5);
    expect([16, 20, 24, 28].map((o) => view.getFloat32(o, true))).toEqual([1, 2, 3, 4]);
  });

  it('round-trips frames across the 32-bit boundary, negative frames and NaN (→ frame 0)', () => {
    const buf = new ArrayBuffer(EVENT_BYTES * 6);
    const w = new EventWriter(buf);
    const r = new EventReader(buf);
    const frames = [0, 1, 2 ** 32 - 1, 2 ** 32, 2 ** 40 + 12345, -5];
    frames.forEach((f, i) => w.write(i, f, 1, 0, 0));
    expect(frames.map((_, i) => r.frameAt(i))).toEqual(frames);
    w.write(0, Number.NaN, 1, 0, 0);
    expect(r.frameAt(0)).toBe(0);
  });

  it('refuses views that are misaligned or do not fit', () => {
    expect(() => new EventWriter(new ArrayBuffer(64), 4)).toThrow(/8-aligned/);
    expect(() => new EventReader(new ArrayBuffer(64), 0, 3)).toThrow(/do not fit/);
  });
});

describe('event ring', () => {
  it('lays out a 128-byte header and power-of-two slots', () => {
    expect(eventRingBytes(8)).toBe(EVENT_RING_HEADER_BYTES + 8 * EVENT_BYTES);
    const { buffer } = ring(8);
    expect(buffer).toBeInstanceOf(SharedArrayBuffer);
    expect(isEventRing(buffer)).toBe(true);
    expect(isEventRing(createEventRing(4, false))).toBe(true);
    expect(() => createEventRing(6)).toThrow(/power of two/);
    expect(() => createEventRing(1)).toThrow(/power of two/);
  });

  it('rejects buffers it did not lay out', () => {
    expect(isEventRing(new SharedArrayBuffer(eventRingBytes(8)))).toBe(false); // no magic
    expect(isEventRing({})).toBe(false);
    const { buffer } = ring(8);
    const truncated = new SharedArrayBuffer(buffer.byteLength - EVENT_BYTES);
    new Int32Array(truncated).set(new Int32Array(buffer, 0, 32));
    expect(isEventRing(truncated)).toBe(false);
    expect(() => new EventRingReader(truncated)).toThrow(/not an event ring/);
  });

  it('is FIFO: records come out in push order, same-frame ones included', () => {
    const { writer, reader } = ring(8);
    writer.push(100, EventType.Param, 7, 0.25);
    writer.push(100, EventType.NoteOn, 60, 0.8, 0.1, 1, 0, 0.5);
    writer.push(40, EventType.NoteOff, 60, 0); // earlier frame, later push: the consumer sorts
    expect(reader.size).toBe(3);
    expect(popAll(reader)).toEqual([
      { frame: 100, type: 4, target: 7, value: 0.25, a0: 0, a1: 0, a2: 0, a3: 0 },
      { frame: 100, type: 1, target: 60, value: Math.fround(0.8), a0: Math.fround(0.1), a1: 1, a2: 0, a3: 0.5 },
      { frame: 40, type: 2, target: 60, value: 0, a0: 0, a1: 0, a2: 0, a3: 0 },
    ]);
    expect(reader.size).toBe(0);
    expect(reader.pop(createEventRecord())).toBe(false);
  });

  it('wraps around the slot array without losing or reordering a record', () => {
    const { writer, reader } = ring(4);
    const seen: number[] = [];
    let next = 0;
    for (let round = 0; round < 25; round++) {
      for (let i = 0; i < 3; i++) expect(writer.push(next++, EventType.Trigger, 0, 1)).toBe(true);
      for (const e of popAll(reader)) seen.push(e.frame);
    }
    expect(seen).toEqual(Array.from({ length: 75 }, (_, i) => i));
    expect(writer.dropped).toBe(0);
  });

  it('wraps the uint32 read / write counts too', () => {
    const { buffer, writer, reader } = ring(4);
    const header = new Int32Array(buffer, 0, 32);
    header[0] = -2; // write count 0xFFFFFFFE
    header[16] = -2; // read count, the same: empty
    const frames: number[] = [];
    for (let i = 0; i < 6; i++) {
      writer.push(i, EventType.Trigger, 0, 1);
      if (i % 2 === 1) for (const e of popAll(reader)) frames.push(e.frame);
    }
    expect(frames).toEqual([0, 1, 2, 3, 4, 5]);
    expect(header[0] >>> 0).toBe(4); // wrapped past 2^32
  });

  it('overflow drops the newest record and counts it; nothing unread is overwritten', () => {
    const { writer, reader } = ring(4);
    const accepted = [0, 1, 2, 3, 4, 5].map((f) => writer.push(f, EventType.Trigger, 0, 1));
    expect(accepted).toEqual([true, true, true, true, false, false]);
    expect(writer.dropped).toBe(2);
    expect(reader.dropped).toBe(2); // the consumer sees the producer's counter
    expect(writer.highWater).toBe(4);
    expect(popAll(reader).map((e) => e.frame)).toEqual([0, 1, 2, 3]);
    expect(writer.push(6, EventType.Trigger, 0, 1)).toBe(true);
    expect(popAll(reader).map((e) => e.frame)).toEqual([6]);
    expect(writer.dropped).toBe(2);
  });

  it('pushFrom / popInto: the Float64Array form carries the same record in EventField order', () => {
    expect(Object.keys(EventField)).toEqual(Object.keys(createEventRecord()));
    expect(EVENT_FIELD_COUNT).toBe(8);
    const { writer, reader } = ring(4);
    const fields = createEventFields();
    fields.set([2 ** 34 + 3, EventType.ParamRamp, 12, 0.5, 4800, 0, 0, -1]);
    expect(writer.pushFrom(fields)).toBe(true);
    writer.push(9, EventType.Trigger, 1, 0.75, 1, 2, 3, 4);
    const out = createEventFields();
    expect(reader.popInto(out)).toBe(true);
    expect(Array.from(out)).toEqual([2 ** 34 + 3, 6, 12, 0.5, 4800, 0, 0, -1]);
    expect(reader.popInto(out)).toBe(true);
    expect(Array.from(out)).toEqual([9, 5, 1, 0.75, 1, 2, 3, 4]);
    expect(reader.popInto(out)).toBe(false);
  });

  it('pushFrom honours the overflow policy too', () => {
    const { writer } = ring(2);
    const fields = createEventFields();
    expect([0, 1, 2].map(() => writer.pushFrom(fields))).toEqual([true, true, false]);
    expect(writer.dropped).toBe(1);
  });

  it('pushCopy moves a record bit for bit', () => {
    const src = new ArrayBuffer(EVENT_BYTES * 2);
    new EventWriter(src).write(1, 2 ** 35, EventType.NoteExpression, 61, -0.75, 2, 0, 0, 9);
    const { writer, reader } = ring(2, false);
    writer.pushCopy(new Int32Array(src), 1);
    expect(popAll(reader)).toEqual([
      { frame: 2 ** 35, type: 8, target: 61, value: -0.75, a0: 2, a1: 0, a2: 0, a3: 9 },
    ]);
  });
});

describe('event ring at an offset (#1497 P2: a voice\'s ring inside hyphon_native memory)', () => {
  /** A "wasm memory" with a ring laid out mid-buffer, guard bytes all around. */
  function inMemory(byteOffset: number, capacity: number) {
    const memory = new SharedArrayBuffer(byteOffset + eventRingBytes(capacity) + 256);
    new Uint8Array(memory).fill(0xa5);
    formatEventRing(memory, byteOffset, capacity);
    return memory;
  }

  it('the header words come from the schema: the layout hyphon::EventRingHeader asserts', () => {
    expect(EVENT_RING_HEADER_BYTES).toBe(128);
    expect(EventRingWord).toEqual({ write: 0, dropped: 1, highWater: 2, read: 16, magic: 24, version: 25, capacity: 26 });
    expect(EVENT_RING_MAGIC).toBe(0x31564548); // 'HEV1'
    const header = new Int32Array(createEventRing(8), 0, 32);
    expect([header[24], header[25], header[26]]).toEqual([EVENT_RING_MAGIC, EVENT_SCHEMA_VERSION, 8]);
  });

  it('formatEventRing lays a ring out where the C++ constructor would, and nowhere else', () => {
    const memory = inMemory(4096, 8);
    expect(isEventRing(memory, 4096)).toBe(true);
    expect(isEventRing(memory)).toBe(false); // offset 0 holds no ring
    const bytes = new Uint8Array(memory);
    expect(bytes[4095]).toBe(0xa5);
    expect(bytes[4096 + eventRingBytes(8)]).toBe(0xa5);
    expect(() => formatEventRing(memory, 4100, 8)).toThrow(/does not fit/); // not 8-aligned
    expect(() => formatEventRing(memory, memory.byteLength - 64, 8)).toThrow(/does not fit/);
    expect(() => formatEventRing(memory, 0, 3)).toThrow(/power of two/);
  });

  it('isEventRing at an offset: the ring must fit the buffer and sit 8-aligned', () => {
    const memory = inMemory(1024, 4);
    expect(isEventRing(memory, 1024)).toBe(true);
    expect(isEventRing(memory, 1028)).toBe(false);
    expect(isEventRing(memory, -8)).toBe(false);
    expect(isEventRing(memory, 1.5)).toBe(false);
    expect(isEventRing(memory, memory.byteLength)).toBe(false);
    // A capacity that would run past the end of the buffer.
    new Int32Array(memory, 1024, 32)[EventRingWord.capacity] = 1 << 20;
    expect(isEventRing(memory, 1024)).toBe(false);
  });

  it('a writer and a reader at an offset are FIFO across wrap-around and touch only the ring', () => {
    const memory = inMemory(2048, 4);
    const writer = new EventRingWriter(memory, 2048);
    const reader = new EventRingReader(memory, 2048);
    expect([writer.byteOffset, writer.capacity]).toEqual([2048, 4]);
    const frames: number[] = [];
    for (let i = 0; i < 10; i++) {
      writer.push(2 ** 33 + i, EventType.Param, i, 0.5, 1, 2, 3, 4);
      for (const e of popAll(reader)) frames.push(e.frame - 2 ** 33);
    }
    expect(frames).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const bytes = new Uint8Array(memory);
    expect(bytes.subarray(0, 2048).every((b) => b === 0xa5)).toBe(true);
    expect(bytes.subarray(2048 + eventRingBytes(4)).every((b) => b === 0xa5)).toBe(true);
    // The counts sit where the C++ consumer reads them.
    const header = new Int32Array(memory, 2048, 32);
    expect([header[EventRingWord.write], header[EventRingWord.read]]).toEqual([10, 10]);
  });

  it('a writer refuses a buffer offset that holds no ring', () => {
    const memory = inMemory(1024, 4);
    expect(() => new EventRingWriter(memory, 0)).toThrow(/not an event ring/);
    expect(() => new EventRingReader(memory, 1032)).toThrow(/not an event ring/);
  });
});
