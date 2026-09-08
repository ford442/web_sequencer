import { describe, it, expect, vi, afterEach } from 'vitest';
import { InternalClockAdapter } from '../InternalClockAdapter';

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
});
