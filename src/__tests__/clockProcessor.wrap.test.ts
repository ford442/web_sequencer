// Drives the real clock-processor worklet (stubbed AudioWorklet globals) to
// check variable-length wrap, the absolute step counter, and swing parity.

import { describe, it, expect, beforeAll } from 'vitest';

interface StepMsg { type: 'step'; step: number; audioTime: number; absStep: number }

class StubPort {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  readonly sent: StepMsg[] = [];
  // The processor reuses one message object, so copy on post.
  postMessage(data: unknown) {
    const msg = data as { type?: string };
    if (msg?.type === 'step') this.sent.push({ ...(data as StepMsg) });
  }
  send(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }
}

class StubProcessor {
  readonly port = new StubPort();
}

// 1600 Hz at 60 BPM → 400 samples per straight 16th.
const SAMPLE_RATE = 1600;
const BASE = 400;
const registered = new Map<string, new () => StubProcessor>();

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.AudioWorkletProcessor = StubProcessor;
  g.sampleRate = SAMPLE_RATE;
  g.currentTime = 0;
  g.currentFrame = 0;
  g.registerProcessor = (name: string, ctor: new () => StubProcessor) => registered.set(name, ctor);
  await import('../audio-worklets/clock-processor');
});

type Clock = StubProcessor & { process: (i: Float32Array[][], o: Float32Array[][], p: Record<string, Float32Array>) => boolean };

function makeClock(steps: number, swing = 0): Clock {
  const Ctor = registered.get('clock-processor');
  if (!Ctor) throw new Error('clock-processor not registered');
  const clock = new Ctor() as Clock;
  clock.port.send({ type: 'setTempo', tempo: 60 });
  clock.port.send({ type: 'setSwing', swing });
  clock.port.send({ type: 'setSteps', steps });
  clock.port.send({ type: 'start' });
  return clock;
}

/** Run until `count` steps have fired; returns the step messages. */
const frames = new WeakMap<Clock, number>();
function runSteps(clock: Clock, count: number): StepMsg[] {
  const out = [[new Float32Array(128)]];
  const g = globalThis as Record<string, unknown>;
  let frame = frames.get(clock) ?? 0;
  let guard = 0;
  while (clock.port.sent.length < count && guard++ < 100_000) {
    g.currentTime = frame / SAMPLE_RATE; // block start time, as the worklet scope provides
    clock.process([], out, {});
    frame += 128;
  }
  frames.set(clock, frame);
  return clock.port.sent.slice(0, count);
}

/** Sample offset of each step, derived from audioTime. */
const sampleTimes = (msgs: StepMsg[]) => msgs.map((m) => Math.round(m.audioTime * SAMPLE_RATE));

describe('clock-processor pattern length', () => {
  it.each([12, 16])('wraps at %i steps while absStep keeps counting', (steps) => {
    const msgs = runSteps(makeClock(steps), steps * 2 + 3);
    msgs.forEach((m, i) => {
      expect(m.absStep).toBe(i);
      expect(m.step).toBe(i % steps);
    });
  });

  it('shrinking the length mid-run never emits a step past the new end', () => {
    const clock = makeClock(32);
    runSteps(clock, 20); // next step would be 20
    clock.port.send({ type: 'setSteps', steps: 16 });
    const after = runSteps(clock, 40).slice(20);
    for (const m of after) expect(m.step).toBeLessThan(16);
    // absStep never resets on a length change
    expect(after[0].absStep).toBe(20);
  });

  it('keeps swing alternating across the wrap of an odd-length pattern', () => {
    const msgs = runSteps(makeClock(7, 1), 16);
    const t = sampleTimes(msgs);
    for (let i = 1; i < t.length; i++) {
      // swing=1: the step after an even absStep comes 1.5 base later, after an odd one 0.5 base later.
      const expected = (i - 1) % 2 === 0 ? BASE * 1.5 : BASE * 0.5;
      expect(Math.abs(t[i] - t[i - 1] - expected)).toBeLessThanOrEqual(1);
    }
  });
});

describe('clock-processor lookahead (#1344 P5)', () => {
  /** Steps with the block-start time they were posted in. */
  function runPosted(lookahead: number, swing: number, count: number) {
    const clock = makeClock(16, swing);
    if (lookahead > 0) clock.port.send({ type: 'setLookahead', lookahead });
    const g = globalThis as Record<string, unknown>;
    const out = [[new Float32Array(128)]];
    const posted: Array<{ audioTime: number; postedAt: number; absStep: number }> = [];
    let frame = 0;
    while (posted.length < count) {
      g.currentTime = frame / SAMPLE_RATE;
      const before = clock.port.sent.length;
      clock.process([], out, {});
      for (const m of clock.port.sent.slice(before)) {
        posted.push({ audioTime: m.audioTime, postedAt: frame / SAMPLE_RATE, absStep: m.absStep });
      }
      frame += 128;
    }
    return posted.slice(0, count);
  }

  it('posts each step early but stamps it with the same time, swing included', () => {
    for (const swing of [0, 0.4]) {
      const plain = runPosted(0, swing, 24);
      const ahead = runPosted(0.25, swing, 24);
      // Same frame (audioTime differs only in the last float bits: blockStart +
      // offset is split differently when the step goes out from an earlier block).
      const frameOf = (t: number) => Math.round(t * SAMPLE_RATE);
      expect(ahead.map((m) => frameOf(m.audioTime))).toEqual(plain.map((m) => frameOf(m.audioTime)));
      expect(ahead.map((m) => m.absStep)).toEqual(plain.map((m) => m.absStep));
      for (const m of ahead) {
        // Each block posts the steps up to its end + the lookahead, so a step
        // goes out 0.25 s to 0.25 s + one block early — or, inside the first
        // window, on the first block after START.
        const lead = m.audioTime - m.postedAt;
        expect(lead).toBeGreaterThanOrEqual(Math.min(0.25, m.audioTime) - 1e-9);
        expect(lead).toBeLessThan(0.25 + 128 / SAMPLE_RATE);
      }
      // Without lookahead a step is posted in the block it falls in.
      for (const m of plain) {
        expect(m.audioTime - m.postedAt).toBeGreaterThanOrEqual(0);
        expect(m.audioTime - m.postedAt).toBeLessThan(128 / SAMPLE_RATE);
      }
    }
  });
});
