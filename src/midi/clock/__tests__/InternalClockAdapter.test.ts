import { describe, it, expect, vi, afterEach } from 'vitest';
import { InternalClockAdapter } from '../InternalClockAdapter';
import { STEP_LOOKAHEAD_MS } from '../types';

describe('InternalClockAdapter', () => {
  const originalUa = navigator.userAgent;

  afterEach(() => {
    Object.defineProperty(navigator, 'userAgent', {
      value: originalUa,
      configurable: true,
    });
    vi.useRealTimers();
  });

  it('skips AudioWorklet addModule on WebKit and runs a main-thread clock', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      value:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      configurable: true,
    });

    const addModule = vi.fn();
    const ctx = {
      state: 'running',
      currentTime: 0,
      resume: vi.fn(),
      audioWorklet: { addModule },
      destination: {},
    } as unknown as AudioContext;

    const adapter = new InternalClockAdapter(ctx, 120, 0, 32);
    await adapter.ensureStarted();

    expect(addModule).not.toHaveBeenCalled();
    expect(adapter.isRunning()).toBe(true);
    adapter.stop();
    expect(adapter.isRunning()).toBe(false);
  });

  it('posts main-thread clock steps up to STEP_LOOKAHEAD_MS early, stamped with their own time (#1344 P5)', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      value:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      configurable: true,
    });
    vi.useFakeTimers();
    const ctx = {
      state: 'running',
      currentTime: 0,
      resume: vi.fn(),
      audioWorklet: { addModule: vi.fn() },
      destination: {},
    } as unknown as AudioContext;

    // 600 BPM: a sixteenth is 25 ms, so steps 0 and 1 both fall inside the window.
    const adapter = new InternalClockAdapter(ctx, 600, 0, 16);
    const steps: Array<[number, number]> = [];
    adapter.onStep((step, audioTime) => steps.push([step, audioTime]));
    await adapter.ensureStarted();

    expect(STEP_LOOKAHEAD_MS).toBeGreaterThan(25);
    expect(steps).toEqual([[0, 0], [1, 0.025]]);
    adapter.stop();
  });
});
