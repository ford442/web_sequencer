import { describe, it, expect } from 'vitest';
import {
  EngineTelemetry,
  serializeEngineReport,
  getBrowserCapabilities,
  reportFilename,
  browserDownloadProvider,
  P95_MIN_SAMPLES,
  type BrowserCapabilities,
  type SubsystemReport,
  type DownloadProvider,
} from '../engineTelemetry';

const fakeCaps: BrowserCapabilities = {
  webgpu: true,
  audioWorklet: true,
  wasmSimd: false,
  pyodide: false,
  secureContext: true,
  tier: 'medium',
};

function fakeSubsystem(overrides: Partial<SubsystemReport> = {}): SubsystemReport {
  return {
    resolution: { backend: 'wasm', reason: 'fallback', ts: 1000 },
    p50: 1.2,
    p95: 2.4,
    sampleCount: 200,
    p95Reliable: true,
    last: [1, 2, 3],
    errors: { count: 0, lastError: undefined, lastTs: null },
    resolutionHistory: [{ backend: 'webgpu', ts: 1 }, { backend: 'wasm', ts: 2 }],
    ...overrides,
  };
}

const fakeRuntime = {
  masterBudgetPercent: 42,
  totalUnderruns: 3,
  outputLatencyMs: 12.5,
  glitches: [],
  worklets: {
    clock: { cpuPercent: 5, underruns: 0, lastProcessUs: 100, lastQuantumUs: 2666, lastUpdate: Date.now() },
  },
  degradations: [],
  offlineRenderThreadCount: null as number | null,
  offlineRenderOversample: null as number | null,
  offlineRenderLatencyMs: null as number | null,
  gpuRenderLatencyMs: null as number | null,
  gpuReadbackBytes: null as number | null,
  gpuFallbackReason: null as string | null,
  gpuUsedGpu: null as boolean | null,
  gpuAvailable: null as boolean | null,
  highFidRequested: null as string | null,
  highFidActiveEngine: null as string | null,
  highFidRealtimeModel: null as string | null,
  highFidFallbackReason: null as string | null,
  sampleRate: null as number | null,
  baseLatencyMs: null as number | null,
  latencyHint: null as string | null,
  transportSync: null,
};

describe('serializeEngineReport', () => {
  it('wraps the snapshot + capabilities into a versioned report', () => {
    const snapshot = { synthA: fakeSubsystem() };
    const parsed: unknown = JSON.parse(serializeEngineReport(snapshot, fakeCaps, fakeRuntime));
    expect((parsed as { version: number }).version).toBe(1);
    expect(typeof (parsed as { exportedAt: string }).exportedAt).toBe('string');
    expect(new Date((parsed as { exportedAt: string }).exportedAt).toString()).not.toBe('Invalid Date');
    expect(typeof (parsed as { sessionDurationMs: number }).sessionDurationMs).toBe('number');
    expect((parsed as { capabilities: typeof fakeCaps }).capabilities).toEqual(fakeCaps);
    expect((parsed as { subsystems: { synthA: { resolution: { backend: string }; p50: number } } }).subsystems.synthA.resolution.backend).toBe('wasm');
    expect((parsed as { subsystems: { synthA: { p50: number } } }).subsystems.synthA.p50).toBe(1.2);
    expect((parsed as { runtime: { masterBudgetPercent: number } }).runtime.masterBudgetPercent).toBe(42);
  });

  it('never leaks a raw userAgent string', () => {
    const json = serializeEngineReport({ s: fakeSubsystem() }, fakeCaps, fakeRuntime);
    expect(json).not.toContain('"userAgent"');
    const parsed: unknown = JSON.parse(json);
    expect('userAgent' in (parsed as object)).toBe(false);
  });
});

describe('reportFilename', () => {
  it('produces a filesystem-safe filename (no colons or dots in the timestamp)', () => {
    const name = reportFilename(new Date('2026-06-01T12:34:56.789Z'));
    expect(name).toBe('hyphon-engine-report-2026-06-01T12-34-56-789Z.json');
  });
});

describe('getBrowserCapabilities', () => {
  it('returns a structured capability snapshot without a raw userAgent', () => {
    const caps = getBrowserCapabilities();
    expect(typeof caps.webgpu).toBe('boolean');
    expect(typeof caps.audioWorklet).toBe('boolean');
    expect(typeof caps.wasmSimd).toBe('boolean');
    expect(['high', 'medium', 'low']).toContain(caps.tier);
    expect('userAgent' in caps).toBe(false);
  });
});

describe('EngineTelemetry.snapshot', () => {
  it('flags p95 as unreliable below the sample threshold and reliable at/above it', () => {
    const t = new EngineTelemetry();
    for (let i = 0; i < P95_MIN_SAMPLES - 1; i++) t.recordLatency('synthA', i % 5);
    expect(t.snapshot().synthA.sampleCount).toBe(P95_MIN_SAMPLES - 1);
    expect(t.snapshot().synthA.p95Reliable).toBe(false);

    t.recordLatency('synthA', 1); // now exactly P95_MIN_SAMPLES
    expect(t.snapshot().synthA.sampleCount).toBe(P95_MIN_SAMPLES);
    expect(t.snapshot().synthA.p95Reliable).toBe(true);
  });

  it('bounds the resolution history at 20 entries and keeps the most recent', () => {
    const t = new EngineTelemetry();
    for (let i = 0; i < 25; i++) t.registerResolution('open303', `backend-${i}`);
    const snap = t.snapshot().open303;
    expect(snap.resolutionHistory.length).toBe(20);
    expect(snap.resolutionHistory[snap.resolutionHistory.length - 1].backend).toBe('backend-24');
    expect(snap.resolution?.backend).toBe('backend-24');
  });

  it('caps the latency ring at maxLatencySamples (256)', () => {
    const t = new EngineTelemetry();
    for (let i = 0; i < 300; i++) t.recordLatency('sampler', i);
    expect(t.snapshot().sampler.sampleCount).toBe(256);
  });

  it('records high-fid selection into the runtime snapshot (Phase-4)', () => {
    const t = new EngineTelemetry();
    t.recordHighFidSelection({
      requested: 'gpu-highfid',
      activeOffline: 'highfid-cpu',
      realtime: 'stock-open303',
      gpuAvailable: false,
      fallbackReason: 'WebGPU unavailable',
    });
    const runtime = t.getRuntimeSnapshot();
    expect(runtime.gpuAvailable).toBe(false);
    expect(runtime.highFidRequested).toBe('gpu-highfid');
    expect(runtime.highFidActiveEngine).toBe('highfid-cpu');
    expect(runtime.highFidRealtimeModel).toBe('stock-open303');
    expect(runtime.highFidFallbackReason).toBe('WebGPU unavailable');
  });

  it('records AudioContext sample rate, base latency, and latencyHint into the runtime snapshot', () => {
    const t = new EngineTelemetry();
    expect(t.getRuntimeSnapshot().sampleRate).toBeNull();

    t.recordAudioContextInfo({ sampleRate: 48000, baseLatencyMs: 5.8, latencyHint: 'playback' });

    const runtime = t.getRuntimeSnapshot();
    expect(runtime.sampleRate).toBe(48000);
    expect(runtime.baseLatencyMs).toBe(5.8);
    expect(runtime.latencyHint).toBe('playback');
  });
});

describe('EngineTelemetry.exportReport', () => {
  it('routes a JSON report and filename through an injected DownloadProvider', () => {
    const t = new EngineTelemetry();
    t.registerResolution('synthA', 'webgpu');
    t.recordLatency('synthA', 1.5);

    const calls: Array<{ json: string; filename: string }> = [];
    const provider: DownloadProvider = {
      triggerDownload: (json, filename) => calls.push({ json, filename }),
    };

    t.exportReport(provider);

    expect(calls).toHaveLength(1);
    expect(calls[0].filename).toMatch(/^hyphon-engine-report-.*\.json$/);
    const parsed: unknown = JSON.parse(calls[0].json);
    expect((parsed as { version: number }).version).toBe(1);
    expect((parsed as { subsystems: { synthA: { resolution: { backend: string } } } }).subsystems.synthA.resolution.backend).toBe('webgpu');
  });

  it('exposes a browser download provider', () => {
    expect(typeof browserDownloadProvider.triggerDownload).toBe('function');
  });
});
