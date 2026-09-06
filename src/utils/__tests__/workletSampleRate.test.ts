import { describe, it, expect } from 'vitest';
import { resolveWorkletSampleRate } from '../workletSampleRate';

describe('resolveWorkletSampleRate', () => {
  it('uses a present positive sampleRate', () => {
    expect(resolveWorkletSampleRate({ sampleRate: 48000 })).toBe(48000);
  });

  it('falls back to 44100 when sampleRate is missing', () => {
    expect(resolveWorkletSampleRate({})).toBe(44100);
  });

  it('falls back to 44100 when sampleRate is 0', () => {
    expect(resolveWorkletSampleRate({ sampleRate: 0 })).toBe(44100);
  });
});
