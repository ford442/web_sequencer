import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../EventBus';
import { VoiceEventRoute } from '../VoiceEventRoute';
import { EventType, createEventRecord, type EventRecord } from '@/shared/rt/eventLayout';
import { formatEventRing, eventRingBytes } from '@/shared/rt/eventRing';
import { EVENT_BATCH_MESSAGE, EventInbox, type EventPort, type RingTransport } from '@/shared/rt/eventTransport';

/**
 * #1497 P2: one voice worklet's route. It starts on batched messages and moves
 * into the voice's own native ring when the worklet offers one, and it writes
 * the notes, params and stops an engine façade sends.
 */

function voiceRing(): RingTransport {
  const memory = new SharedArrayBuffer(16384);
  formatEventRing(memory, 4096, 16);
  return { kind: 'ring', buffer: memory, byteOffset: 4096 };
}

function setup(voiceRingRoute = true, sharedMemory = true) {
  const bus = new EventBus({ autoFlush: false });
  const posted: unknown[] = [];
  const port: EventPort = { postMessage: vi.fn((m: unknown) => posted.push(m)) };
  const route = new VoiceEventRoute(bus);
  const transport = route.open(port, { sampleRate: 48000, sharedMemory, voiceRing: voiceRingRoute });
  let inbox = new EventInbox(transport);
  /** What the worklet's side holds: batches delivered, then drained. */
  const received = (): EventRecord[] => {
    bus.flushAll();
    for (const m of posted.splice(0)) inbox.receive(m);
    const out: EventRecord[] = [];
    for (let e = createEventRecord(); inbox.pop(e); e = createEventRecord()) out.push(e);
    return out;
  };
  const useInbox = (next: EventInbox) => {
    inbox = next;
  };
  return { bus, route, transport, posted, port, received, useInbox };
}

describe('VoiceEventRoute', () => {
  it('a voice-ring route opens on batched messages; a ring route on a ring of its own where memory is shared', () => {
    expect(setup(true).transport).toEqual({ kind: 'message', capacity: 256 });
    const own = setup(false, true).transport;
    expect(own.kind).toBe('ring');
    expect(own.kind === 'ring' && own.buffer.byteLength).toBe(eventRingBytes(256));
    expect(setup(false, false).transport.kind).toBe('message');
  });

  it('stamps notes and params with frames on the context clock; no audioTime is frame 0', () => {
    const { route, received } = setup();
    route.noteOn(57, 100, 2);
    route.noteOff(57, 2.5);
    route.param(3, 0.25, 2.25);
    route.param(4, 0.75);
    expect(received().map((e) => [e.frame, e.type, e.target, e.value])).toEqual([
      [96000, EventType.NoteOn, 57, 100],
      [120000, EventType.NoteOff, 57, 0],
      [108000, EventType.Param, 3, 0.25],
      [0, EventType.Param, 4, 0.75],
    ]);
  });

  it('a stop is CANCEL_NOTES, then (with release) ALL_NOTES_OFF on the next block', () => {
    const { route, received } = setup();
    route.stop(true);
    route.stop(false);
    expect(received().map((e) => [e.frame, e.type])).toEqual([
      [0, EventType.CancelNotes],
      [0, EventType.AllNotesOff],
      [0, EventType.CancelNotes],
    ]);
  });

  it('adopt moves the route into the offered voice ring: nothing is posted after that', () => {
    const { route, posted, received, useInbox } = setup();
    route.noteOn(60, 1, 1); // before ready: batched
    const offer = voiceRing();
    expect(route.adopt(offer)).toBe(true);
    expect(route.inPlace).toBe(true);
    expect(posted.map((m) => (m as { type: string }).type)).toEqual([EVENT_BATCH_MESSAGE]); // flushed by the rebind
    expect(received().map((e) => e.target)).toEqual([60]);

    route.noteOn(62, 1, 1);
    useInbox(new EventInbox(offer)); // the C++ voice's side of its ring
    expect(received().map((e) => e.target)).toEqual([62]);
    expect(posted).toEqual([]);
  });

  it('a missing or bad offer leaves the route on messages', () => {
    const { route } = setup();
    expect(route.adopt(undefined)).toBe(false);
    expect(route.adopt({ kind: 'ring', buffer: new SharedArrayBuffer(64), byteOffset: 0 })).toBe(false);
    expect(route.inPlace).toBe(false);
    route.close();
    expect(route.adopt(voiceRing())).toBe(false); // closed
  });

  it('close flushes what is staged and stops writing; reopening starts over', () => {
    const { route, posted, port } = setup();
    route.noteOn(60, 1);
    route.close();
    expect(posted).toHaveLength(1);
    expect(route.isOpen).toBe(false);
    expect(route.noteOn(61, 1)).toBe(false);
    route.open(port, { sampleRate: 44100, sharedMemory: false, voiceRing: true });
    expect(route.isOpen && route.frameAt(1)).toBe(44100);
  });
});
