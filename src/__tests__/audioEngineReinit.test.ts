import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  canReinitAudioEngine,
  reinitAudioEngineFromGesture,
  setAudioEngineReinitHandler,
} from '../hooks/audioEngine/audioEngineReinit';

describe('reinitAudioEngineFromGesture', () => {
  const originalAudioContext = window.AudioContext;
  let unregister: (() => void) | null = null;

  afterEach(() => {
    unregister?.();
    unregister = null;
    window.AudioContext = originalAudioContext;
    localStorage.clear();
  });

  it('is a no-op (false) until an engine registers', async () => {
    expect(canReinitAudioEngine()).toBe(false);
    await expect(reinitAudioEngineFromGesture()).resolves.toBe(false);
  });

  it('builds and resumes the new context synchronously, inside the gesture', async () => {
    const order: string[] = [];
    const resume = vi.fn(() => {
      order.push('resume');
      return Promise.resolve();
    });
    const ctor = vi.fn().mockImplementation(function (this: Record<string, unknown>) {
      order.push('construct');
      this.sampleRate = 48000;
      this.state = 'suspended';
      this.resume = resume;
    });
    window.AudioContext = ctor as unknown as typeof AudioContext;
    localStorage.setItem('hyphon.audioLatencyMode', 'playback');

    const handler = vi.fn((created: { context: unknown; latencyHint: string }) => {
      order.push('handler');
      expect(created.latencyHint).toBe('playback');
      return Promise.resolve();
    });
    unregister = setAudioEngineReinitHandler(handler);
    expect(canReinitAudioEngine()).toBe(true);

    const pending = reinitAudioEngineFromGesture();
    // Before the first microtask: the context exists and resume() was called,
    // and the (async) teardown/rebuild has not started yet.
    expect(order).toEqual(['construct', 'resume']);
    expect(ctor).toHaveBeenCalledWith({ latencyHint: 'playback' });

    await expect(pending).resolves.toBe(true);
    expect(order).toEqual(['construct', 'resume', 'handler']);
  });

  it('unregistering only clears the handler it registered', () => {
    const first = setAudioEngineReinitHandler(() => Promise.resolve());
    unregister = setAudioEngineReinitHandler(() => Promise.resolve());
    first();
    expect(canReinitAudioEngine()).toBe(true);
  });
});
