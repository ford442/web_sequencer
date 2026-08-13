import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AudioTimeMap } from '../audioTimeMap';

describe('AudioTimeMap', () => {
  beforeEach(() => {
    vi.stubGlobal('performance', { now: () => 1000 });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps dom time to audio time relative to anchor', () => {
    const ctx = { currentTime: 5 } as AudioContext;
    const map = new AudioTimeMap(ctx);
    expect(map.domToAudio(1000)).toBeCloseTo(5, 5);
    expect(map.domToAudio(1500)).toBeCloseTo(5.5, 5);
  });

  it('round-trips audio to dom', () => {
    const ctx = { currentTime: 2 } as AudioContext;
    const map = new AudioTimeMap(ctx);
    const dom = map.audioToDom(3);
    expect(map.domToAudio(dom)).toBeCloseTo(3, 5);
  });
});
