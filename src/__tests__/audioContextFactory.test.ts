import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAudioContext } from '../hooks/audioEngine/audioContextFactory';
import { LATENCY_MODE_STORAGE_KEY } from '../utils/audioLatencyMode';
import { SAMPLE_RATE_STORAGE_KEY } from '../utils/audioContextPolicy';

function mockAudioContextCtor(actualSampleRate: number) {
  return vi.fn().mockImplementation(function (this: { sampleRate: number }) {
    this.sampleRate = actualSampleRate;
  });
}

describe('createAudioContext', () => {
  const originalAudioContext = window.AudioContext;

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    window.AudioContext = originalAudioContext;
  });

  it('constructs the context with an explicit latencyHint option', () => {
    const ctorSpy = mockAudioContextCtor(48000);
    window.AudioContext = ctorSpy as unknown as typeof AudioContext;

    const created = createAudioContext('playback');

    expect(ctorSpy).toHaveBeenCalledTimes(1);
    expect(ctorSpy).toHaveBeenCalledWith({ latencyHint: 'playback' });
    expect(created.actualSampleRate).toBe(48000);
    expect(created.requestedSampleRate).toBeNull();
    expect(created.sampleRateFallback).toBeNull();
  });

  it('defaults to the persisted latency mode when none is passed explicitly', () => {
    localStorage.setItem(LATENCY_MODE_STORAGE_KEY, 'balanced');
    const ctorSpy = mockAudioContextCtor(44100);
    window.AudioContext = ctorSpy as unknown as typeof AudioContext;

    createAudioContext();

    expect(ctorSpy).toHaveBeenCalledWith({ latencyHint: 'balanced' });
  });

  it('falls back to interactive when no latency mode has ever been stored', () => {
    const ctorSpy = mockAudioContextCtor(44100);
    window.AudioContext = ctorSpy as unknown as typeof AudioContext;

    createAudioContext();

    expect(ctorSpy).toHaveBeenCalledWith({ latencyHint: 'interactive' });
  });

  it('passes sampleRate when the stored preference is 48000', () => {
    localStorage.setItem(SAMPLE_RATE_STORAGE_KEY, '48000');
    const ctorSpy = mockAudioContextCtor(48000);
    window.AudioContext = ctorSpy as unknown as typeof AudioContext;

    const created = createAudioContext();

    expect(ctorSpy).toHaveBeenCalledWith({ latencyHint: 'interactive', sampleRate: 48000 });
    expect(created.requestedSampleRate).toBe(48000);
    expect(created.actualSampleRate).toBe(48000);
    expect(created.sampleRateFallback).toBeNull();
  });

  it('retries without sampleRate when the constructor throws', () => {
    const ctorSpy = vi.fn()
      .mockImplementationOnce(() => {
        throw new Error('unsupported sampleRate');
      })
      .mockImplementation(function (this: { sampleRate: number }) {
        this.sampleRate = 44100;
      });
    window.AudioContext = ctorSpy as unknown as typeof AudioContext;

    const created = createAudioContext('interactive', 48000);

    expect(ctorSpy).toHaveBeenCalledTimes(2);
    expect(ctorSpy).toHaveBeenNthCalledWith(1, { latencyHint: 'interactive', sampleRate: 48000 });
    expect(ctorSpy).toHaveBeenNthCalledWith(2, { latencyHint: 'interactive' });
    expect(created.sampleRateFallback).toMatch(/ctor-threw-sampleRate:48000/);
    expect(created.actualSampleRate).toBe(44100);
    expect(created.requestedSampleRate).toBe(48000);
  });

  it('keeps the context when the browser ignores the requested sampleRate', () => {
    const ctorSpy = mockAudioContextCtor(44100);
    window.AudioContext = ctorSpy as unknown as typeof AudioContext;

    const created = createAudioContext('interactive', 48000);

    expect(ctorSpy).toHaveBeenCalledTimes(1);
    expect(created.actualSampleRate).toBe(44100);
    expect(created.requestedSampleRate).toBe(48000);
    expect(created.sampleRateFallback).toMatch(/browser-ignored-sampleRate/);
  });

  it('throws when AudioContext is unavailable', () => {
    // @ts-expect-error deliberately removing the constructor for this test
    window.AudioContext = undefined;
    // @ts-expect-error webkit fallback also unavailable
    window.webkitAudioContext = undefined;

    expect(() => createAudioContext('interactive')).toThrow(/AudioContext is not available/);
  });
});
