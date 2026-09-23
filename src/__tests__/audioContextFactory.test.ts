import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAudioContext } from '../hooks/audioEngine/audioContextFactory';
import { LATENCY_MODE_STORAGE_KEY } from '../utils/audioLatencyMode';
import {
  RENDER_SIZE_HINT_STORAGE_KEY,
  SAMPLE_RATE_STORAGE_KEY,
  getLastLiveSampleRate,
  recordLiveSampleRate,
  resolveExportSampleRate,
} from '../utils/audioContextPolicy';
import { AUDIO_OUTPUT_STORAGE_KEY } from '../utils/audioOutputDevice';

/**
 * A constructor whose prototype advertises the Chromium-only members, the way
 * `renderQuantumSize` / `sinkId` feature detection sees a real Chrome 125+.
 */
function chromiumCtor(
  impl: (this: Record<string, unknown>, options: Record<string, unknown>) => void,
) {
  const spy = vi.fn().mockImplementation(impl);
  Object.defineProperty(spy.prototype, 'renderQuantumSize', { value: undefined, writable: true, configurable: true });
  Object.defineProperty(spy.prototype, 'sinkId', { value: '', writable: true, configurable: true });
  Object.defineProperty(spy.prototype, 'setSinkId', { value: () => Promise.resolve(), configurable: true });
  return spy;
}

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

  it('omits renderSizeHint / sinkId where the browser lacks them', () => {
    localStorage.setItem(RENDER_SIZE_HINT_STORAGE_KEY, '256');
    localStorage.setItem(AUDIO_OUTPUT_STORAGE_KEY, JSON.stringify({ groupId: 'g', label: 'Interface', deviceId: 'dev-1' }));
    const ctorSpy = mockAudioContextCtor(48000);
    window.AudioContext = ctorSpy as unknown as typeof AudioContext;

    const created = createAudioContext('interactive', 'native');

    expect(ctorSpy).toHaveBeenCalledWith({ latencyHint: 'interactive' });
    expect(created.requestedRenderSizeHint).toBeNull();
    expect(created.renderQuantumSize).toBeNull();
    expect(created.constructorSinkId).toBeNull();
  });

  it('passes the stored renderSizeHint and records the quantum the browser picked', () => {
    localStorage.setItem(RENDER_SIZE_HINT_STORAGE_KEY, '256');
    const ctorSpy = chromiumCtor(function (this) {
      this.sampleRate = 48000;
      this.renderQuantumSize = 256;
    });
    window.AudioContext = ctorSpy as unknown as typeof AudioContext;

    const created = createAudioContext('interactive', 'native');

    expect(ctorSpy).toHaveBeenCalledWith({ latencyHint: 'interactive', renderSizeHint: 256 });
    expect(created.requestedRenderSizeHint).toBe(256);
    expect(created.renderQuantumSize).toBe(256);
    expect(created.optionFallback).toBeNull();
  });

  it('opens on the stored output device via the sinkId constructor option', () => {
    localStorage.setItem(AUDIO_OUTPUT_STORAGE_KEY, JSON.stringify({ groupId: 'g', label: 'Interface', deviceId: 'dev-1' }));
    const ctorSpy = chromiumCtor(function (this, options) {
      this.sampleRate = 48000;
      this.sinkId = options.sinkId ?? '';
    });
    window.AudioContext = ctorSpy as unknown as typeof AudioContext;

    const created = createAudioContext('interactive', 48000);

    expect(ctorSpy).toHaveBeenCalledWith({ latencyHint: 'interactive', sampleRate: 48000, sinkId: 'dev-1' });
    expect(created.constructorSinkId).toBe('dev-1');
  });

  it('drops a rejected sinkId / renderSizeHint before giving up the sample rate', () => {
    localStorage.setItem(RENDER_SIZE_HINT_STORAGE_KEY, 'hardware');
    localStorage.setItem(AUDIO_OUTPUT_STORAGE_KEY, JSON.stringify({ groupId: 'g', label: 'Gone', deviceId: 'stale' }));
    const ctorSpy = chromiumCtor(function (this, options) {
      if (options.sinkId) {
        const err = new Error('device not found');
        err.name = 'NotFoundError';
        throw err;
      }
      this.sampleRate = 48000;
    });
    window.AudioContext = ctorSpy as unknown as typeof AudioContext;

    const created = createAudioContext('balanced', 48000);

    expect(ctorSpy).toHaveBeenCalledTimes(2);
    expect(ctorSpy).toHaveBeenNthCalledWith(2, { latencyHint: 'balanced', sampleRate: 48000 });
    expect(created.optionFallback).toBe('ctor-threw-options:renderSizeHint+sinkId:NotFoundError');
    expect(created.sampleRateFallback).toBeNull();
    expect(created.constructorSinkId).toBeNull();
  });

  it('records the live rate so offline renders resolve native to it', () => {
    recordLiveSampleRate(null);
    const ctorSpy = mockAudioContextCtor(96000);
    window.AudioContext = ctorSpy as unknown as typeof AudioContext;

    createAudioContext('interactive', 'native');

    expect(getLastLiveSampleRate()).toBe(96000);
    expect(resolveExportSampleRate('native')).toBe(96000);
    expect(resolveExportSampleRate(44100)).toBe(44100);
    recordLiveSampleRate(null);
    expect(resolveExportSampleRate('native')).toBe(44100);
  });
});
