import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EngineTelemetry, engineTelemetry } from '../utils/engineTelemetry';
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
      const end = reporter.beginProcess(128);
      end();
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
