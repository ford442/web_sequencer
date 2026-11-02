/**
 * Child-process probe for eventBus.perf.test.ts (#1497). It is built with Vite
 * and run under plain `node --expose-gc`, because vitest's module transform
 * (getter-based exports) keeps V8 from optimising the hot loop the way an
 * app bundle is optimised. Prints the heap growth of each scenario as JSON.
 */
import { EventBus } from '../../EventBus';
import { EventInbox, RingEventSink } from '../../../../shared/rt/eventTransport';
import { EventField, createEventFields } from '../../../../shared/rt/eventLayout';
import { DrumkitEvent, VoiceEvent } from '../../../../shared/rt/hyphonNativeExports';

const gc = (globalThis as { gc?: () => void }).gc;
if (!gc) throw new Error('run with --expose-gc');

const RECORDS = 100_000;

/**
 * Least heap growth over `records` records across a few rounds. The first
 * rounds still run code the JIT is optimising, and unoptimised code boxes
 * every double it computes.
 */
function heapGrowth(pump: (records: number) => void): number {
  for (let i = 0; i < 20; i++) pump(RECORDS / 4);
  let least = Infinity;
  for (let round = 0; round < 3; round++) {
    gc!();
    const before = process.memoryUsage().heapUsed;
    pump(RECORDS);
    least = Math.min(least, process.memoryUsage().heapUsed - before);
  }
  return least;
}

function ringRoute() {
  const bus = new EventBus({ autoFlush: false });
  const sink = new RingEventSink(256);
  const route = bus.open(sink);
  return { bus, sink, route, inbox: new EventInbox(sink.transport), out: createEventFields() };
}

const kick = { pitch: 50.5, decay: 0.6, tone: 0.35, volume: 0.9 };
const pans = [0, -0.25, 0.25, 0.5];

/** What a step sends: a hit (pan + trigger, as DrumKitEngine does) and a computed automation value. */
function staged(): { grown: number; dropped: number } {
  const { bus, sink, route, inbox, out } = ringRoute();
  const s = bus.stage;
  const pump = (n: number) => {
    for (let i = 0; i < n; i += 3) {
      const frame = 1_000_000 + i * 137;
      const voice = i & 3;
      s[EventField.frame] = frame;
      s[EventField.type] = DrumkitEvent.SetPan;
      s[EventField.target] = voice;
      s[EventField.value] = pans[voice] * ((i & 15) / 15);
      bus.commit(route);
      s[EventField.frame] = frame;
      s[EventField.type] = VoiceEvent.Trigger;
      s[EventField.target] = voice;
      s[EventField.value] = 1;
      s[EventField.a0] = kick.pitch + (i & 7);
      s[EventField.a1] = kick.decay;
      s[EventField.a2] = kick.tone;
      s[EventField.a3] = kick.volume;
      bus.commit(route);
      s[EventField.frame] = frame + 64;
      s[EventField.type] = VoiceEvent.Param;
      s[EventField.target] = 7;
      s[EventField.value] = (i & 127) / 127;
      bus.commit(route);
      // The worklet drains about once a block.
      if (i % 48 === 0) while (inbox.popInto(out));
    }
    while (inbox.popInto(out));
  };
  return { grown: heapGrowth(pump), dropped: sink.dropped };
}

/** The same records through positional push(): its double arguments are boxed where not inlined. */
function positional(): { grown: number; dropped: number } {
  const { bus, sink, route, inbox, out } = ringRoute();
  const pump = (n: number) => {
    for (let i = 0; i < n; i += 3) {
      const frame = 1_000_000 + i * 137;
      const voice = i & 3;
      bus.push(route, frame, DrumkitEvent.SetPan, voice, pans[voice] * ((i & 15) / 15));
      bus.push(route, frame, VoiceEvent.Trigger, voice, 1, kick.pitch + (i & 7), kick.decay, kick.tone, kick.volume);
      bus.push(route, frame + 64, VoiceEvent.Param, 7, (i & 127) / 127);
      if (i % 48 === 0) while (inbox.popInto(out));
    }
    while (inbox.popInto(out));
  };
  return { grown: heapGrowth(pump), dropped: sink.dropped };
}

/** Integer records through push(): nothing to box. */
function integers(): { grown: number; dropped: number } {
  const { bus, sink, route, inbox, out } = ringRoute();
  const pump = (n: number) => {
    for (let i = 0; i < n; i++) {
      bus.push(route, 1_000_000 + i, VoiceEvent.Trigger, i & 3, 1, 50, 1, 2, 3);
      if ((i & 31) === 31) while (inbox.popInto(out));
    }
    while (inbox.popInto(out));
  };
  return { grown: heapGrowth(pump), dropped: sink.dropped };
}

process.stdout.write(JSON.stringify({ records: RECORDS, staged: staged(), positional: positional(), integers: integers() }));
