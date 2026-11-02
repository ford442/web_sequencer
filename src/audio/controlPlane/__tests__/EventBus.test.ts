import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventBus } from '../EventBus';
import { EventInbox, MessageEventSink, RingEventSink, type EventPort } from '@/shared/rt/eventTransport';
import { EventField, EventType, createEventFields } from '@/shared/rt/eventLayout';

/** #1497 P1: the main-thread bus that owns every engine route's writer. */

function messageRoute(bus: EventBus) {
  const postMessage = vi.fn<EventPort['postMessage']>();
  const sink = new MessageEventSink({ postMessage }, 8);
  return { route: bus.open(sink), sink, postMessage };
}

const batchCounts = (postMessage: ReturnType<typeof vi.fn>) =>
  postMessage.mock.calls.map(([m]) => (m as { count: number }).count);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('EventBus', () => {
  it('routes are never 0, and a closed route is reused', () => {
    const bus = new EventBus({ autoFlush: false });
    const a = bus.open(new RingEventSink(4));
    const b = bus.open(new RingEventSink(4));
    expect(a).toBeGreaterThan(0);
    expect(b).not.toBe(a);
    bus.close(a);
    bus.close(a); // twice is harmless
    expect(bus.transport(a)).toBeNull();
    expect(bus.open(new RingEventSink(4))).toBe(a);
  });

  it('a push to a closed or unknown route is refused and counted', () => {
    const bus = new EventBus({ autoFlush: false });
    expect(bus.push(0, 1, EventType.Trigger, 0, 1)).toBe(false);
    expect(bus.push(99, 1, EventType.Trigger, 0, 1)).toBe(false);
    expect(bus.unrouted).toBe(2);
  });

  it('message routes: one batch per route per task, flushed in a microtask', async () => {
    const bus = new EventBus();
    const kick = messageRoute(bus);
    const bass = messageRoute(bus);
    for (let i = 0; i < 3; i++) bus.push(kick.route, i, EventType.Trigger, 0, 1);
    bus.push(bass.route, 5, EventType.NoteOn, 36, 1);
    expect(kick.postMessage).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(batchCounts(kick.postMessage)).toEqual([3]);
    expect(batchCounts(bass.postMessage)).toEqual([1]);

    bus.push(kick.route, 9, EventType.Trigger, 0, 1); // the next task gets its own batch
    await Promise.resolve();
    expect(batchCounts(kick.postMessage)).toEqual([3, 1]);
  });

  it('ring routes schedule nothing', () => {
    const queue = vi.spyOn(globalThis, 'queueMicrotask');
    const bus = new EventBus();
    const route = bus.open(new RingEventSink(8));
    for (let i = 0; i < 4; i++) expect(bus.push(route, i, EventType.Trigger, 0, 1)).toBe(true);
    expect(queue).not.toHaveBeenCalled();
  });

  it('flush(route) posts now, so a port message sent next arrives after the records', () => {
    const bus = new EventBus();
    const { route, postMessage } = messageRoute(bus);
    bus.push(route, 1, EventType.Trigger, 0, 1);
    bus.flush(route);
    expect(batchCounts(postMessage)).toEqual([1]);
  });

  it('close() flushes what the route still stages', () => {
    const bus = new EventBus({ autoFlush: false });
    const { route, postMessage } = messageRoute(bus);
    bus.push(route, 1, EventType.Trigger, 0, 1);
    bus.push(route, 2, EventType.Trigger, 0, 1);
    bus.close(route);
    expect(batchCounts(postMessage)).toEqual([2]);
    expect(bus.push(route, 3, EventType.Trigger, 0, 1)).toBe(false);
  });

  it('commit() queues the stage like push() would, then clears it', () => {
    const bus = new EventBus({ autoFlush: false });
    const sink = new RingEventSink(4);
    const route = bus.open(sink);
    const inbox = new EventInbox(sink.transport);
    const s = bus.stage;
    s[EventField.frame] = 4800;
    s[EventField.type] = EventType.Trigger;
    s[EventField.target] = 2;
    s[EventField.value] = 0.5;
    s[EventField.a3] = 7;
    expect(bus.commit(route)).toBe(true);
    expect(Array.from(s)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    bus.push(route, 4800, EventType.Trigger, 2, 0.5, 0, 0, 0, 7);
    const a = createEventFields();
    const b = createEventFields();
    expect(inbox.popInto(a) && inbox.popInto(b)).toBe(true);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('commit() to a closed route is refused, counted, and still clears the stage', () => {
    const bus = new EventBus({ autoFlush: false });
    bus.stage[EventField.type] = EventType.NoteOn;
    expect(bus.commit(3)).toBe(false);
    expect(bus.unrouted).toBe(1);
    expect(bus.stage[EventField.type]).toBe(0);
  });

  it('commit() schedules the fallback flush like push()', async () => {
    const bus = new EventBus();
    const { route, postMessage } = messageRoute(bus);
    bus.stage[EventField.type] = EventType.Trigger;
    bus.commit(route);
    bus.commit(route);
    await Promise.resolve();
    expect(batchCounts(postMessage)).toEqual([2]);
  });

  it('reports what a full ring refused', () => {
    const bus = new EventBus();
    const route = bus.open(new RingEventSink(2));
    for (let i = 0; i < 5; i++) bus.push(route, i, EventType.Trigger, 0, 1);
    expect(bus.dropped(route)).toBe(3);
  });

  it('rebind moves a route onto another sink: what the old one staged goes first (#1497 P2)', () => {
    const bus = new EventBus({ autoFlush: false });
    const { route, postMessage } = messageRoute(bus);
    bus.push(route, 10, EventType.Trigger, 0, 1);
    const ring = new RingEventSink(4);
    expect(bus.rebind(route, ring)).toBe(true);
    expect(batchCounts(postMessage)).toEqual([1]); // flushed on the way out
    bus.push(route, 20, EventType.Trigger, 0, 1);
    bus.flushAll();
    expect(batchCounts(postMessage)).toEqual([1]); // the new sink posts nothing
    expect(bus.transport(route)).toBe(ring.transport);
    const inbox = new EventInbox(ring.transport);
    const out = createEventFields();
    expect(inbox.popInto(out) && out[EventField.frame]).toBe(20);
    expect(bus.rebind(0, ring)).toBe(false);
    bus.close(route);
    expect(bus.rebind(route, ring)).toBe(false);
  });
});
