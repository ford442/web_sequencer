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
