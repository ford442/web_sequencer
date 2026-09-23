import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveWorkletSampleRate } from '../workletSampleRate';
import {
  hasWorkletSampleRateFallback,
  resetWorkletSampleRateFallbackForTests,
} from '../../audio-worklets/workletPerfReporter';

describe('resolveWorkletSampleRate', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetWorkletSampleRateFallbackForTests();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('uses a present positive sampleRate without logging', () => {
    expect(resolveWorkletSampleRate({ sampleRate: 48000 })).toBe(48000);
    expect(hasWorkletSampleRateFallback()).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it('falls back to 44100 when sampleRate is missing', () => {
    expect(resolveWorkletSampleRate({})).toBe(44100);
  });

  it('falls back to 44100 when sampleRate is 0', () => {
    expect(resolveWorkletSampleRate({ sampleRate: 0 })).toBe(44100);
  });

  it('logs the fallback once via WorkletPerfReporter, not per call', () => {
    resolveWorkletSampleRate({});
    resolveWorkletSampleRate({});
    resolveWorkletSampleRate({ sampleRate: Number.NaN });
    expect(hasWorkletSampleRateFallback()).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/sampleRate missing; assuming 44100 Hz/);
  });
});
