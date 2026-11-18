import { describe, expect, it } from 'vitest';
import { EventField, EventType, createEventFields } from '../eventLayout';
import { PendingEventQueue } from '../pendingEvents';

/** A PARAM_SET record on `frame`: target `id`, value `value`. */
function record(frame: number, id: number, value: number): Float64Array {
  const f = createEventFields();
  f[EventField.frame] = frame;
  f[EventField.type] = EventType.Param;
  f[EventField.target] = id;
  f[EventField.value] = value;
  return f;
}

/** Everything left in the queue as [frame, target, value], earliest first. */
function drain(q: PendingEventQueue): number[][] {
  const out: number[][] = [];
  const f = createEventFields();
  while (q.shift(f)) out.push([f[EventField.frame], f[EventField.target], f[EventField.value]]);
  return out;
}

describe('PendingEventQueue', () => {
  it('hands records back earliest frame first, ties in arrival order', () => {
    const q = new PendingEventQueue(8);
    q.push(record(300, 0, 1));
    q.push(record(100, 0, 2));
    q.push(record(300, 0, 3)); // same frame as the first: after it
    q.push(record(200, 1, 4));
    q.push(record(100, 1, 5)); // same frame as the second: after it
    expect(q.size).toBe(5);
    expect(q.nextFrame()).toBe(100);
    expect(drain(q)).toEqual([
      [100, 0, 2],
      [100, 1, 5],
      [200, 1, 4],
      [300, 0, 1],
      [300, 0, 3],
    ]);
    expect(q.size).toBe(0);
    expect(q.nextFrame()).toBe(Infinity);
  });

  it('reuses the space shifted records leave, and counts what does not fit', () => {
    const q = new PendingEventQueue(4);
    for (let i = 0; i < 4; i++) expect(q.push(record(i, 0, i))).toBe(true);
    expect(q.push(record(9, 0, 9))).toBe(false);
    expect(q.dropped).toBe(1);

    const f = createEventFields();
    q.shift(f);
    q.shift(f);
    // Two slots free at the front: the queue compacts instead of dropping.
    expect(q.push(record(1, 1, 10))).toBe(true);
    expect(q.push(record(5, 1, 11))).toBe(true);
    expect(q.dropped).toBe(1);
    expect(drain(q)).toEqual([
      [1, 1, 10],
      [2, 0, 2],
      [3, 0, 3],
      [5, 1, 11],
    ]);
  });

  it('clear() drops everything waiting', () => {
    const q = new PendingEventQueue(4);
    q.push(record(10, 0, 1));
    q.push(record(20, 0, 2));
    q.clear();
    expect(q.size).toBe(0);
    expect(drain(q)).toEqual([]);
    q.push(record(5, 0, 3));
    expect(drain(q)).toEqual([[5, 0, 3]]);
  });

  it('rejects a capacity it cannot hold', () => {
    expect(() => new PendingEventQueue(0)).toThrow();
    expect(() => new PendingEventQueue(1.5)).toThrow();
  });
});
