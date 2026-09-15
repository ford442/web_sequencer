import { describe, it, expect } from 'vitest';
import { DrumTriggerQueue } from '../audio-worklets/drumkit/triggerQueue';

describe('DrumTriggerQueue', () => {
  it('applies due triggers on the audio clock and holds future ones', () => {
    const q = new DrumTriggerQueue();
    const applied: number[] = [];
    q.schedule({ audioTime: 1.0, voice: 0, velocity: 1, a: 0, b: 0, c: 0, d: 0 });
    q.schedule({ audioTime: 0.5, voice: 1, velocity: 1, a: 0, b: 0, c: 0, d: 0 });
    q.drain(0.75, (e) => applied.push(e.voice));
    expect(applied).toEqual([1]);
    expect(q.length).toBe(1);
    q.drain(1.0, (e) => applied.push(e.voice));
    expect(applied).toEqual([1, 0]);
    expect(q.length).toBe(0);
  });
});
