import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAudioContext } from '../hooks/audioEngine/audioContextFactory';
import { LATENCY_MODE_STORAGE_KEY } from '../utils/audioLatencyMode';

describe('createAudioContext', () => {
  const originalAudioContext = window.AudioContext;

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    window.AudioContext = originalAudioContext;
  });

  it('constructs the context with an explicit latencyHint option', () => {
    const ctorSpy = vi.fn().mockImplementation(function (this: unknown) { /* noop */ });
    window.AudioContext = ctorSpy as unknown as typeof AudioContext;

    createAudioContext('playback');

    expect(ctorSpy).toHaveBeenCalledTimes(1);
    expect(ctorSpy).toHaveBeenCalledWith({ latencyHint: 'playback' });
  });

  it('defaults to the persisted latency mode when none is passed explicitly', () => {
    localStorage.setItem(LATENCY_MODE_STORAGE_KEY, 'balanced');
    const ctorSpy = vi.fn().mockImplementation(function (this: unknown) { /* noop */ });
    window.AudioContext = ctorSpy as unknown as typeof AudioContext;

    createAudioContext();

    expect(ctorSpy).toHaveBeenCalledWith({ latencyHint: 'balanced' });
  });

  it('falls back to interactive when no latency mode has ever been stored', () => {
    const ctorSpy = vi.fn().mockImplementation(function (this: unknown) { /* noop */ });
    window.AudioContext = ctorSpy as unknown as typeof AudioContext;

    createAudioContext();

    expect(ctorSpy).toHaveBeenCalledWith({ latencyHint: 'interactive' });
  });

  it('throws when AudioContext is unavailable', () => {
    // @ts-expect-error deliberately removing the constructor for this test
    window.AudioContext = undefined;
    // @ts-expect-error webkit fallback also unavailable
    window.webkitAudioContext = undefined;

    expect(() => createAudioContext('interactive')).toThrow(/AudioContext is not available/);
  });
});
