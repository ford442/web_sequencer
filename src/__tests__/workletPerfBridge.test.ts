import { describe, it, expect, afterEach } from 'vitest';
import { startGlitchMonitor, stopGlitchMonitor } from '../utils/workletPerfBridge';
import { engineTelemetry } from '../utils/engineTelemetry';

function fakeContext(overrides: Partial<AudioContext> = {}): AudioContext {
  return {
    sampleRate: 48000,
    baseLatency: 0.0058,
    outputLatency: 0.01,
    state: 'running',
    addEventListener: () => {},
    removeEventListener: () => {},
    ...overrides,
  } as unknown as AudioContext;
}

describe('startGlitchMonitor', () => {
  afterEach(() => {
    stopGlitchMonitor();
  });

  it('records sampleRate, baseLatency, and the requested latencyHint into engineTelemetry', () => {
    startGlitchMonitor(fakeContext(), 'playback');

    const runtime = engineTelemetry.getRuntimeSnapshot();
    expect(runtime.sampleRate).toBe(48000);
    expect(runtime.baseLatencyMs).toBeCloseTo(5.8, 5);
    expect(runtime.latencyHint).toBe('playback');
  });

  it('records requested vs actual sample rate when given meta', () => {
    startGlitchMonitor(fakeContext(), {
      latencyHint: 'interactive',
      requestedSampleRate: 48000,
      sampleRateFallback: 'browser-ignored-sampleRate:48000->48000',
    });

    const runtime = engineTelemetry.getRuntimeSnapshot();
    expect(runtime.requestedSampleRate).toBe(48000);
    expect(runtime.sampleRateFallback).toMatch(/browser-ignored/);
    expect(runtime.latencyHint).toBe('interactive');
  });

  it('records a null latencyHint when none is provided', () => {
    startGlitchMonitor(fakeContext());

    expect(engineTelemetry.getRuntimeSnapshot().latencyHint).toBeNull();
  });
});