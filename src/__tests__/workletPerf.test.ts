import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EngineTelemetry, engineTelemetry } from '../utils/engineTelemetry';
import { attachWorkletPerf } from '../utils/workletPerfBridge';
import { performanceBudget, BUDGET_OVERLOAD_THRESHOLD, DEGRADE_ORDER } from '../utils/performanceBudget';
import { engineDegradationStore } from '../stores/engineDegradationStore';

describe('EngineTelemetry worklet perf', () => {
  it('aggregates per-worklet CPU into master budget', () => {
    const t = new EngineTelemetry();
    t.recordWorkletPerf('clock', {
      cpuPercent: 12,
      underruns: 0,
      processUs: 300,
      quantumUs: 2500,
      blockFrames: 128,
    });
    t.recordWorkletPerf('open303', {
      cpuPercent: 35,
      underruns: 1,
      processUs: 900,
      quantumUs: 2500,
      blockFrames: 128,
    });

    const runtime = t.getRuntimeSnapshot();
    expect(runtime.masterBudgetPercent).toBe(47);
    expect(runtime.totalUnderruns).toBe(1);
    expect(runtime.worklets.open303?.cpuPercent).toBe(35);
  });

  it('increments total underruns when worklet reports new underruns', () => {
    const t = new EngineTelemetry();
    t.recordWorkletPerf('rubberband', {
      cpuPercent: 90,
      underruns: 1,
      processUs: 4000,
      quantumUs: 2500,
      blockFrames: 128,
    });
    expect(t.getRuntimeSnapshot().totalUnderruns).toBe(1);

    t.recordWorkletPerf('rubberband', {
      cpuPercent: 95,
      underruns: 4,
      processUs: 5000,
      quantumUs: 2500,
      blockFrames: 128,
    });
    expect(t.getRuntimeSnapshot().totalUnderruns).toBe(4);
  });

  it('sums concurrent nodes of the same worklet kind into the master budget', () => {
    const t = new EngineTelemetry();
    const sample = (cpuPercent: number) => ({
      cpuPercent,
      underruns: 0,
      processUs: 100,
      quantumUs: 2500,
      blockFrames: 128,
    });
    t.recordWorkletPerf('rubberband', sample(20));
    t.recordWorkletPerf('rubberband#1', sample(25));
    t.recordWorkletPerf('rubberband#2', sample(30));
    expect(t.getRuntimeSnapshot().masterBudgetPercent).toBe(75);

    t.unregisterWorklet('rubberband#1');
    const runtime = t.getRuntimeSnapshot();
    expect(runtime.masterBudgetPercent).toBe(50);
    expect(Object.keys(runtime.worklets).sort()).toEqual(['rubberband', 'rubberband#2']);
  });

  it('stops counting a node that has gone silent', () => {
    vi.useFakeTimers();
    try {
      const t = new EngineTelemetry();
      t.recordWorkletPerf('rubberband', {
        cpuPercent: 70, underruns: 0, processUs: 1, quantumUs: 1, blockFrames: 128,
      });
      expect(t.getRuntimeSnapshot().masterBudgetPercent).toBe(70);
      vi.advanceTimersByTime(10_000);
      expect(t.getRuntimeSnapshot().masterBudgetPercent).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('records glitches and includes them in runtime snapshot', () => {
    const t = new EngineTelemetry();
    t.recordGlitch('latency-spike', { deltaMs: 25 });
    const runtime = t.getRuntimeSnapshot();
    expect(runtime.glitches).toHaveLength(1);
    expect(runtime.glitches[0].kind).toBe('latency-spike');
  });
});

describe('WorkletPerfReporter synthetic stress', () => {
  let frame = 0;
  const messages: unknown[] = [];
  const fakePort = {
    postMessage: (msg: unknown) => messages.push(msg),
  } as unknown as MessagePort;

  beforeEach(() => {
    frame = 0;
    messages.length = 0;
    vi.stubGlobal('sampleRate', 48000);
    vi.stubGlobal('currentFrame', 0);
    Object.defineProperty(globalThis, 'currentFrame', {
      get: () => frame,
      configurable: true,
    });
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => {
      clock += 5; // each call adds 5ms — exceeds 128/48000 ≈ 2.67ms quantum
      return clock;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('increments underrun counter under synthetic slow process stress', async () => {
    const { WorkletPerfReporter } = await import('../audio-worklets/workletPerfReporter');
    const reporter = new WorkletPerfReporter(fakePort, 'stress-test', 10);

    for (let i = 0; i < 20; i++) {
      reporter.beginProcess(128);
      reporter.endProcess();
      frame += 512;
    }

    const perfMsg = messages.find(
      (m) => m && typeof m === 'object' && (m as { type?: string }).type === 'worklet-perf',
    ) as { underruns?: number; cpuPercent?: number } | undefined;

    expect(perfMsg).toBeDefined();
    expect(perfMsg?.underruns).toBeGreaterThan(0);
    expect(perfMsg?.cpuPercent).toBeGreaterThan(80);
  });
});

describe('performanceBudget auto-degrade', () => {
  beforeEach(() => {
    performanceBudget.resetForTests();
    engineDegradationStore.clear('perf-spectral-pan');
  });

  it('documents degrade order with spectral-pan first', () => {
    expect(DEGRADE_ORDER[0]).toBe('spectral-pan');
    expect(DEGRADE_ORDER).toContain('granular-quality');
  });

  it('disables spectral pan when budget exceeds threshold', () => {
    engineTelemetry.recordWorkletPerf('rubberband', {
      cpuPercent: BUDGET_OVERLOAD_THRESHOLD + 5,
      underruns: 0,
      processUs: 3000,
      quantumUs: 2500,
      blockFrames: 128,
    });
    performanceBudget.evaluate();

    expect(performanceBudget.getSpectralPanMultiplier()).toBe(0);
    expect(engineDegradationStore.getIssue('perf-spectral-pan')?.status).toBe('active');
  });
});

describe('attachWorkletPerf per-node keys', () => {
  function fakeNode() {
    const listeners = new Set<(e: MessageEvent) => void>();
    const node = {
      port: {
        addEventListener: (_: string, fn: (e: MessageEvent) => void) => listeners.add(fn),
        removeEventListener: (_: string, fn: (e: MessageEvent) => void) => listeners.delete(fn),
      },
    } as unknown as AudioWorkletNode;
    const emit = (cpuPercent: number) =>
      listeners.forEach((fn) => fn({
        data: {
          type: 'worklet-perf', name: 'bridge-test', cpuPercent, underruns: 0,
          processUs: 1, quantumUs: 1, blockFrames: 128, sampleRateFallback: false,
        },
      } as MessageEvent));
    return { node, emit };
  }

  it('reports each node under its own key and reuses a freed slot', () => {
    const a = fakeNode();
    const b = fakeNode();
    const detachA = attachWorkletPerf(a.node, 'bridge-test');
    const detachB = attachWorkletPerf(b.node, 'bridge-test');
    a.emit(10);
    b.emit(25);

    let runtime = engineTelemetry.getRuntimeSnapshot();
    expect(runtime.worklets['bridge-test']?.cpuPercent).toBe(10);
    expect(runtime.worklets['bridge-test#1']?.cpuPercent).toBe(25);

    detachB();
    runtime = engineTelemetry.getRuntimeSnapshot();
    expect(runtime.worklets['bridge-test#1']).toBeUndefined();

    const c = fakeNode();
    const detachC = attachWorkletPerf(c.node, 'bridge-test');
    c.emit(5);
    expect(engineTelemetry.getRuntimeSnapshot().worklets['bridge-test#1']?.cpuPercent).toBe(5);

    detachA();
    detachC();
    expect(engineTelemetry.getRuntimeSnapshot().worklets['bridge-test']).toBeUndefined();
  });
});
