import { describe, it, expect, vi } from 'vitest';
import { MessageChannel } from 'node:worker_threads';
import {
  EVENT_BATCH_MESSAGE,
  EventInbox,
  MessageEventSink,
  RingEventSink,
  createEngineEventSink,
  createEventInbox,
  isEventBatchMessage,
  type EngineEventSink,
  type EventPort,
} from '../eventTransport';
import { createEventRing } from '../eventRing';
import { EVENT_BYTES, EventType, createEventRecord, type EventRecord } from '../eventLayout';
import { frameAtTime } from '../audioClock';

/**
 * #1497 P1: one EngineEventSink interface, two transports. Whatever the sink,
 * the worklet's inbox yields the same records in the same order.
 */

function drain(inbox: EventInbox): EventRecord[] {
  const out: EventRecord[] = [];
  for (let e = createEventRecord(); inbox.pop(e); e = createEventRecord()) out.push(e);
  return out;
}

/** A sink, the worklet's inbox for it, and delivery of whatever the sink posted. */
function pair(kind: 'ring' | 'message', capacity = 8) {
  const posted: unknown[] = [];
  const port: EventPort = { postMessage: (m) => posted.push(m) };
  const sink: EngineEventSink = kind === 'ring' ? new RingEventSink(capacity) : new MessageEventSink(port, capacity);
  const inbox = new EventInbox(sink.transport);
  const deliver = () => {
    sink.flush();
    for (const m of posted.splice(0)) expect(inbox.receive(m)).toBe(true);
  };
  return { sink, inbox, posted, deliver };
}

describe('EngineEventSink → EventInbox', () => {
  it.each(['ring', 'message'] as const)('%s: same records, same order', (kind) => {
    const { sink, inbox, deliver } = pair(kind);
    sink.push(1000, EventType.Param, 3, 0.5);
    sink.push(1000, EventType.NoteOn, 64, 1, 0, 1, 0.25, 0);
    sink.push(900, EventType.NoteOff, 60, 0);
    deliver();
    expect(inbox.size).toBe(3);
    expect(drain(inbox)).toEqual([
      { frame: 1000, type: 4, target: 3, value: 0.5, a0: 0, a1: 0, a2: 0, a3: 0 },
      { frame: 1000, type: 1, target: 64, value: 1, a0: 0, a1: 1, a2: 0.25, a3: 0 },
      { frame: 900, type: 2, target: 60, value: 0, a0: 0, a1: 0, a2: 0, a3: 0 },
    ]);
  });

  it.each(['ring', 'message'] as const)('%s: pushFrom / popInto carry the same records', (kind) => {
    const { sink, inbox, deliver } = pair(kind);
    const fields = new Float64Array([480, EventType.NoteExpression, 61, 0.25, 1, 0, 0, 0]);
    sink.pushFrom(fields);
    sink.push(481, EventType.NoteOff, 61, 0);
    deliver();
    const out = new Float64Array(8);
    expect(inbox.popInto(out)).toBe(true);
    expect(Array.from(out)).toEqual([480, 8, 61, 0.25, 1, 0, 0, 0]);
    expect(inbox.popInto(out)).toBe(true);
    expect(Array.from(out)).toEqual([481, 2, 61, 0, 0, 0, 0, 0]);
  });

  it('ring: no flush needed, nothing is posted, and overflow drops the newest', () => {
    const { sink, inbox, posted } = pair('ring', 4);
    expect(sink.needsFlush).toBe(false);
    for (let f = 0; f < 6; f++) sink.push(f, EventType.Trigger, 0, 1);
    expect(posted).toEqual([]);
    expect(sink.dropped).toBe(2);
    expect(inbox.dropped).toBe(2);
    expect(drain(inbox).map((e) => e.frame)).toEqual([0, 1, 2, 3]);
  });

  it('message: one transferred batch per flush, none for an empty one', () => {
    const postMessage = vi.fn();
    const sink = new MessageEventSink({ postMessage }, 8);
    sink.flush();
    expect(postMessage).not.toHaveBeenCalled();
    sink.push(1, EventType.Trigger, 0, 1);
    sink.push(2, EventType.Trigger, 1, 1);
    expect(sink.needsFlush).toBe(true);
    expect(postMessage).not.toHaveBeenCalled();
    sink.flush();
    expect(postMessage).toHaveBeenCalledTimes(1);
    const [msg, transfer] = postMessage.mock.calls[0] as [{ type: string; count: number; records: ArrayBuffer }, ArrayBuffer[]];
    expect(msg.type).toBe(EVENT_BATCH_MESSAGE);
    expect(msg.count).toBe(2);
    expect(msg.records.byteLength).toBe(2 * EVENT_BYTES);
    expect(transfer).toEqual([msg.records]);
    expect(sink.needsFlush).toBe(false);
    expect(sink.batches).toBe(1);
  });

  it('message: a full stage flushes early instead of dropping', () => {
    const { sink, inbox, posted } = pair('message', 2);
    for (let f = 0; f < 5; f++) expect(sink.push(f, EventType.Trigger, 0, 1)).toBe(true);
    expect(posted).toHaveLength(2); // two full stages went out mid-tick
    sink.flush();
    expect(sink.dropped).toBe(0);
    // The worklet drains every block, between batches.
    const frames: number[] = [];
    for (const m of posted) {
      inbox.receive(m);
      frames.push(...drain(inbox).map((e) => e.frame));
    }
    expect(frames).toEqual([0, 1, 2, 3, 4]);
    expect(inbox.dropped).toBe(0);
  });

  it('message: batches that pile up past the inbox drop the newest records and count them', () => {
    const { sink, inbox, deliver } = pair('message', 2);
    for (let f = 0; f < 4; f++) sink.push(f, EventType.Trigger, 0, 1); // two batches, the worklet drains neither
    deliver();
    expect(inbox.dropped).toBe(2);
    expect(drain(inbox).map((e) => e.frame)).toEqual([0, 1]);
  });

  it('a real MessagePort carries the batch (transferred) and the shared ring (shared, not copied)', async () => {
    const { port1, port2 } = new MessageChannel();
    try {
      const got: unknown[] = [];
      const arrived = (n: number) =>
        new Promise<void>((resolve) => {
          port2.on('message', (m: unknown) => {
            got.push(m);
            if (got.length === n) resolve();
          });
        });
      const done = arrived(2);
      const ringSink = new RingEventSink(8);
      const msgSink = new MessageEventSink(port1, 8);
      port1.postMessage({ type: 'init', events: ringSink.transport });
      msgSink.push(7, EventType.Trigger, 2, 0.5);
      msgSink.flush();
      await done;

      const ringInbox = createEventInbox((got[0] as { events: unknown }).events)!;
      expect(ringInbox.kind).toBe('ring');
      ringSink.push(42, EventType.NoteOn, 60, 1); // written after the descriptor was posted
      expect(drain(ringInbox).map((e) => e.frame)).toEqual([42]);

      const msgInbox = createEventInbox(msgSink.transport)!;
      expect(msgInbox.receive(got[1])).toBe(true);
      expect(drain(msgInbox)).toEqual([{ frame: 7, type: 5, target: 2, value: 0.5, a0: 0, a1: 0, a2: 0, a3: 0 }]);
    } finally {
      port1.close();
      port2.close();
    }
  });
});

describe('transport descriptors and messages', () => {
  it('createEngineEventSink: the ring only when asked for and possible', () => {
    const port = { postMessage: vi.fn() };
    expect(createEngineEventSink(port, { ring: true })).toBeInstanceOf(RingEventSink);
    expect(createEngineEventSink(port, { ring: false })).toBeInstanceOf(MessageEventSink);
    vi.stubGlobal('SharedArrayBuffer', undefined);
    try {
      expect(createEngineEventSink(port, { ring: true })).toBeInstanceOf(MessageEventSink);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('createEventInbox accepts only what a sink sends', () => {
    expect(createEventInbox(undefined)).toBeNull();
    expect(createEventInbox({ kind: 'ring', buffer: new SharedArrayBuffer(64) })).toBeNull();
    expect(createEventInbox({ kind: 'ring', buffer: createEventRing(4, false) })).toBeNull(); // not shared
    expect(createEventInbox({ kind: 'message', capacity: 0 })).toBeNull();
    expect(createEventInbox({ kind: 'message', capacity: 3 })?.kind).toBe('message');
    expect(createEventInbox({ kind: 'ring', buffer: createEventRing(4) })?.kind).toBe('ring');
  });

  it('receive() passes every other message through', () => {
    const inbox = new EventInbox({ kind: 'message', capacity: 4 });
    expect(inbox.receive({ type: 'noteOn', data: {} })).toBe(false);
    expect(inbox.receive(null)).toBe(false);
    expect(isEventBatchMessage({ type: EVENT_BATCH_MESSAGE, count: 2, records: new ArrayBuffer(EVENT_BYTES) })).toBe(false);
    expect(isEventBatchMessage({ type: EVENT_BATCH_MESSAGE, count: 1, records: new ArrayBuffer(EVENT_BYTES) })).toBe(true);
  });
});

describe('frameAtTime', () => {
  it('is the worklet conversion: round(t * rate), and frame 0 for anything unusable', () => {
    expect(frameAtTime(1.25, 48000)).toBe(60000);
    expect(frameAtTime(1 / 3, 44100)).toBe(14700);
    for (const t of [0, -1, Number.NaN, Infinity, undefined, '1']) expect(frameAtTime(t, 48000)).toBe(0);
  });
});
