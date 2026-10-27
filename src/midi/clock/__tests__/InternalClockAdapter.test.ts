import { describe, it, expect, vi, afterEach } from 'vitest';
import { InternalClockAdapter } from '../InternalClockAdapter';
import { STEP_LOOKAHEAD_MS } from '../types';
import * as engineTelemetry from '../../../utils/engineTelemetry';

const FIREFOX_UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0';

/** A clock-processor node whose port records messages and answers only when told to. */
function stubWorkletNode() {
  const nodes: Array<{
    port: {
      onmessage: ((e: MessageEvent) => void) | null;
      postMessage: ReturnType<typeof vi.fn>;
      addEventListener: ReturnType<typeof vi.fn>;
      removeEventListener: ReturnType<typeof vi.fn>;
    };
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }> = [];
  vi.stubGlobal(
    'AudioWorkletNode',
    class {
      port = {
        onmessage: null as ((e: MessageEvent) => void) | null,
        postMessage: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
      connect = vi.fn();
      disconnect = vi.fn();
      constructor() {
        nodes.push(this as unknown as (typeof nodes)[number]);
      }
    },
  );
  return nodes;
}

describe('InternalClockAdapter', () => {
  const originalUa = navigator.userAgent;

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
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

  describe('worklet that never answers (#1492, Firefox)', () => {
    const makeCtx = () =>
      ({
        state: 'running',
        currentTime: 0,
        resume: vi.fn(),
        audioWorklet: { addModule: vi.fn().mockResolvedValue(undefined) },
        destination: {},
      }) as unknown as AudioContext;

    it('logs the fallback and runs the main-thread clock one lookahead after start', async () => {
      Object.defineProperty(navigator, 'userAgent', { value: FIREFOX_UA, configurable: true });
      vi.useFakeTimers();
      const nodes = stubWorkletNode();
      const fallback = vi.spyOn(engineTelemetry, 'logEngineFallback').mockImplementation(() => {});

      const adapter = new InternalClockAdapter(makeCtx(), 600, 0, 16);
      const steps: Array<[number, number]> = [];
      adapter.onStep((step, audioTime) => steps.push([step, audioTime]));
      await adapter.ensureStarted();

      expect(nodes).toHaveLength(1);
      expect(nodes[0].port.postMessage).toHaveBeenCalledWith({ type: 'start' });
      expect(fallback).not.toHaveBeenCalled();
      expect(steps).toEqual([]);

      vi.advanceTimersByTime(STEP_LOOKAHEAD_MS);

      expect(fallback).toHaveBeenCalledTimes(1);
      expect(fallback).toHaveBeenCalledWith('clock', 'wasm-worklet', expect.stringContaining('main-thread timer'));
      expect(nodes[0].port.postMessage).toHaveBeenLastCalledWith({ type: 'stop' });
      expect(nodes[0].disconnect).toHaveBeenCalled();
      expect(adapter.isRunning()).toBe(true);
      expect(steps).toEqual([[0, 0], [1, 0.025]]);
      adapter.stop();
    });

    it('does not build a second worklet when started again after the fallback', async () => {
      Object.defineProperty(navigator, 'userAgent', { value: FIREFOX_UA, configurable: true });
      vi.useFakeTimers();
      const nodes = stubWorkletNode();
      vi.spyOn(engineTelemetry, 'logEngineFallback').mockImplementation(() => {});

      const adapter = new InternalClockAdapter(makeCtx(), 120, 0, 16);
      await adapter.ensureStarted();
      vi.advanceTimersByTime(STEP_LOOKAHEAD_MS);
      await adapter.ensureStarted();

      expect(nodes).toHaveLength(1);
      adapter.stop();
    });

    it('ignores a step the dropped worklet posts after the fallback', async () => {
      Object.defineProperty(navigator, 'userAgent', { value: FIREFOX_UA, configurable: true });
      vi.useFakeTimers();
      const nodes = stubWorkletNode();
      vi.spyOn(engineTelemetry, 'logEngineFallback').mockImplementation(() => {});

      const adapter = new InternalClockAdapter(makeCtx(), 120, 0, 16);
      const steps: number[] = [];
      adapter.onStep((step) => steps.push(step));
      await adapter.ensureStarted();
      vi.advanceTimersByTime(STEP_LOOKAHEAD_MS);
      const seen = steps.length;

      nodes[0].port.onmessage?.({ data: { type: 'step', step: 7, audioTime: 1, absStep: 7 } } as MessageEvent);

      expect(steps).toHaveLength(seen);
      adapter.stop();
    });

    it('keeps the worklet and never falls back when it posts a step in time', async () => {
      Object.defineProperty(navigator, 'userAgent', { value: FIREFOX_UA, configurable: true });
      vi.useFakeTimers();
      const nodes = stubWorkletNode();
      const fallback = vi.spyOn(engineTelemetry, 'logEngineFallback').mockImplementation(() => {});

      const adapter = new InternalClockAdapter(makeCtx(), 120, 0, 16);
      const steps: number[] = [];
      adapter.onStep((step) => steps.push(step));
      await adapter.ensureStarted();

      nodes[0].port.onmessage?.({ data: { type: 'step', step: 0, audioTime: 0, absStep: 0 } } as MessageEvent);
      vi.advanceTimersByTime(STEP_LOOKAHEAD_MS * 10);

      expect(fallback).not.toHaveBeenCalled();
      expect(nodes[0].disconnect).not.toHaveBeenCalled();
      expect(steps).toEqual([0]);
      adapter.stop();
    });

    it('cancels the watchdog when stopped before the deadline', async () => {
      Object.defineProperty(navigator, 'userAgent', { value: FIREFOX_UA, configurable: true });
      vi.useFakeTimers();
      stubWorkletNode();
      const fallback = vi.spyOn(engineTelemetry, 'logEngineFallback').mockImplementation(() => {});

      const adapter = new InternalClockAdapter(makeCtx(), 120, 0, 16);
      await adapter.ensureStarted();
      adapter.stop();
      vi.advanceTimersByTime(STEP_LOOKAHEAD_MS * 10);

      expect(fallback).not.toHaveBeenCalled();
      expect(adapter.isRunning()).toBe(false);
    });
  });
});
