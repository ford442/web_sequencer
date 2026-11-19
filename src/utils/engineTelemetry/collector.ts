// Telemetry collector: per-subsystem resolutions/latencies plus runtime counters.

import { getBrowserCapabilities } from './capabilities';
import {
  browserDownloadProvider,
  reportFilename,
  serializeEngineReport,
  type DownloadProvider,
} from './report';
import type {
  GlitchEvent,
  HyphonNativeHeapTelemetry,
  Resolution,
  RuntimeSnapshot,
  RuntimeTelemetry,
  SubsystemReport,
  TelemetryData,
  WebGpuDeviceTelemetry,
  WorkletPerfReport,
  WorkletPerfSample,
} from './types';
import type { TransportSyncTelemetry } from '../../midi/clock/types';
import type { Wam2RuntimeConstraints, Wam2SlotTelemetry } from '../../audio/wam/types';
import type { WebGpuProbeSnapshot } from '../../engines/backends/webgpuProbe';
import type { HyphonNativeThreading } from '../../audio-worklets/hyphonNativeImports';

function emptyWebGpuDeviceTelemetry(): WebGpuDeviceTelemetry {
  return { losses: 0, recoveries: 0, lastLoss: null, uncapturedErrors: 0, lastError: null };
}

// Bound the per-subsystem fallback-transition log. ~20 * ~50 bytes = negligible.
const MAX_RESOLUTION_HISTORY = 20;
// The latency ring caps at maxLatencySamples (256). Below this many samples a p95
// is anecdotal, so we flag it rather than implying false statistical rigor.
export const P95_MIN_SAMPLES = 128;

function emptyData(): TelemetryData {
  return {
    resolution: null,
    resolutionHistory: [],
    latencies: [],
    errors: { count: 0, lastError: undefined, lastTs: null },
    maxLatencySamples: 256,
    workletCpuHistory: [],
  };
}

function percentile(arr: number[], p: number): number | null {
  if (!arr || arr.length === 0) return null;
  const copy = arr.slice().sort((a, b) => a - b);
  const idx = Math.min(copy.length - 1, Math.floor((p / 100) * (copy.length - 1)));
  return copy[idx] ?? null;
}


const MAX_GLITCH_EVENTS = 64;

/** Reporters post at ~10 Hz; a node silent for this long no longer counts towards the budget. */
const WORKLET_PERF_STALE_MS = 3000;

/** `rubberband#3` → `rubberband`. Per-node keys are `kind` or `kind#n`. */
export function workletBaseName(key: string): string {
  const i = key.indexOf('#');
  return i === -1 ? key : key.slice(0, i);
}
const MAX_DEGRADATION_LOG = 32;

export class EngineTelemetry {
  private data = new Map<string, TelemetryData>();
  private runtime: RuntimeTelemetry = {
    worklets: new Map(),
    glitches: [],
    outputLatencyMs: null,
    masterBudgetPercent: 0,
    totalUnderruns: 0,
    degradations: [],
    offlineRenderThreadCount: null,
    offlineRenderOversample: null,
    offlineRenderLatencyMs: null,
    gpuRenderLatencyMs: null,
    gpuReadbackBytes: null,
    gpuFallbackReason: null,
    gpuUsedGpu: null,
    gpuAvailable: null,
    highFidRequested: null,
    highFidActiveEngine: null,
    highFidRealtimeModel: null,
    highFidFallbackReason: null,
    liveHighFidRequested: null,
    liveHighFidActive: null,
    liveHighFidFallbackReason: null,
    liveHighFidCpuPercent: null,
    liveHighFidOversample: null,
    liveAbArmed: null,
    liveAbEngaged: null,
    liveAbMix: null,
    liveAbStockCpuPercent: null,
    liveAbHighFidCpuPercent: null,
    sampleRate: null,
    requestedSampleRate: null,
    sampleRateFallback: null,
    sinkId: null,
    sinkLabel: null,
    baseLatencyMs: null,
    renderSizeHintRequested: null,
    renderQuantumSize: null,
    contextOptionFallback: null,
    stepLookaheadMs: null,
    latencyHint: null,
    transportSync: null,
    wam2Slots: [],
    wam2Constraints: null,
    webgpuProbe: null,
    webgpuDevice: emptyWebGpuDeviceTelemetry(),
    hyphonNativeHeap: null,
  };
  private lastUnderrunByWorklet = new Map<string, number>();

  registerWorklet(name: string): void {
    if (!this.data.has(name)) {
      this.data.set(name, emptyData());
    }
  }

  /**
   * Forget a worklet instance's perf state (node disposed). Without this a
   * disposed voice's last sample would keep counting towards the master budget.
   */
  unregisterWorklet(key: string): void {
    this.runtime.worklets.delete(key);
    this.lastUnderrunByWorklet.delete(key);
    const s = this.data.get(key);
    if (s) {
      s.worklet = undefined;
      s.workletCpuHistory.length = 0;
    }
    this.recomputeMasterBudget();
  }

  /**
   * `name` is a per-node key: a worklet kind with several live nodes reports as
   * `kind`, `kind#2`, `kind#3`, … so concurrent voices sum into the master
   * budget instead of overwriting each other (see `workletBaseName`).
   */
  recordWorkletPerf(
    name: string,
    sample: Omit<WorkletPerfSample, 'ts'>,
  ): void {
    let s = this.data.get(name);
    if (!s) {
      s = emptyData();
      this.data.set(name, s);
    }

    const entry: WorkletPerfSample = { ...sample, ts: Date.now() };
    s.worklet = entry;
    s.workletCpuHistory.push(sample.cpuPercent);
    if (s.workletCpuHistory.length > s.maxLatencySamples) {
      s.workletCpuHistory.shift();
    }

    const prevUnderruns = this.lastUnderrunByWorklet.get(name) ?? 0;
    if (sample.underruns > prevUnderruns) {
      this.runtime.totalUnderruns += sample.underruns - prevUnderruns;
    }
    this.lastUnderrunByWorklet.set(name, sample.underruns);
    this.runtime.worklets.set(name, entry);

    this.recomputeMasterBudget();
  }

  recordGlitch(kind: string, detail?: Record<string, unknown>): void {
    this.runtime.glitches.push({ kind, detail, ts: Date.now() });
    if (this.runtime.glitches.length > MAX_GLITCH_EVENTS) {
      this.runtime.glitches.shift();
    }
  }

  recordStepLookahead(ms: number): void {
    this.runtime.stepLookaheadMs = ms;
  }

  recordOutputLatency(latencyMs: number): void {
    this.runtime.outputLatencyMs = latencyMs;
  }

  /**
   * Record the negotiated AudioContext identity at construction time
   * (P0 audio foundation / #1033). Sample rate and base latency are fixed
   * for the life of the context, so this is called once on init.
   */
  recordAudioContextInfo(info: {
    sampleRate: number;
    requestedSampleRate?: number | null;
    sampleRateFallback?: string | null;
    baseLatencyMs: number;
    latencyHint: string | null;
    renderSizeHintRequested?: string | number | null;
    renderQuantumSize?: number | null;
    contextOptionFallback?: string | null;
    sinkId?: string | null;
    sinkLabel?: string | null;
  }): void {
    this.runtime.renderSizeHintRequested = info.renderSizeHintRequested ?? null;
    this.runtime.renderQuantumSize = info.renderQuantumSize ?? null;
    this.runtime.contextOptionFallback = info.contextOptionFallback ?? null;
    this.runtime.sampleRate = info.sampleRate;
    this.runtime.requestedSampleRate = info.requestedSampleRate ?? null;
    this.runtime.sampleRateFallback = info.sampleRateFallback ?? null;
    this.runtime.baseLatencyMs = info.baseLatencyMs;
    this.runtime.latencyHint = info.latencyHint;
    if (info.sinkId !== undefined) this.runtime.sinkId = info.sinkId;
    if (info.sinkLabel !== undefined) this.runtime.sinkLabel = info.sinkLabel;
  }

  recordAudioOutputSink(info: { sinkId: string | null; sinkLabel: string | null }): void {
    this.runtime.sinkId = info.sinkId;
    this.runtime.sinkLabel = info.sinkLabel;
  }

  recordDegradation(step: string, active: boolean, reason: string): void {
    this.runtime.degradations.push({ step, active, reason, ts: Date.now() });
    if (this.runtime.degradations.length > MAX_DEGRADATION_LOG) {
      this.runtime.degradations.shift();
    }
  }

  /**
   * Record metrics from an offline 303 render (worker pool / freeze / export).
   * Does not affect the real-time audio-thread budget.
   */
  recordOfflineRender(meta: {
    threadCount: number;
    oversample: number;
    latencyMs: number;
  }): void {
    this.runtime.offlineRenderThreadCount = meta.threadCount;
    this.runtime.offlineRenderOversample = meta.oversample;
    this.runtime.offlineRenderLatencyMs = meta.latencyMs;
    this.recordLatency('offline303', meta.latencyMs);
    this.registerResolution(
      'offline303',
      `os×${meta.oversample}`,
      `threads=${meta.threadCount}`,
    );
  }

  /**
   * Record metrics from a GPU high-fid 303 render (Phase-3 / #976).
   * Does not affect the real-time audio-thread budget.
   */
  recordGpu303Render(meta: {
    latencyMs: number;
    readbackBytes: number;
    fallbackReason: string | null;
    usedGpu: boolean;
  }): void {
    this.runtime.gpuRenderLatencyMs = meta.latencyMs;
    this.runtime.gpuReadbackBytes = meta.readbackBytes;
    this.runtime.gpuFallbackReason = meta.fallbackReason;
    this.runtime.gpuUsedGpu = meta.usedGpu;
    this.recordLatency('gpu-highfid', meta.latencyMs);
  }

  /**
   * Record a high-fid model selection (Phase-4 / #977) — GPU availability,
   * requested vs effective offline engine, and realtime fallback target.
   */
  recordHighFidSelection(meta: {
    requested: string;
    activeOffline: string;
    realtime: string;
    gpuAvailable: boolean;
    fallbackReason: string | null;
  }): void {
    this.runtime.gpuAvailable = meta.gpuAvailable;
    this.runtime.highFidRequested = meta.requested;
    this.runtime.highFidActiveEngine = meta.activeOffline;
    this.runtime.highFidRealtimeModel = meta.realtime;
    this.runtime.highFidFallbackReason = meta.fallbackReason;
    this.registerResolution(
      'highfid-selection',
      meta.activeOffline,
      meta.fallbackReason
        ? `${meta.requested}: ${meta.fallbackReason}`
        : meta.requested,
    );
    if (meta.fallbackReason) {
      this.recordDegradation('highfid-selection', true, meta.fallbackReason);
    }
  }

  /**
   * Record the state of the live (realtime) high-fid 303 path — Phase-L1.
   * `active: false` with a reason means the CPU/glitch gate handed the voice
   * back to Stock Open303, which is what the HUD badge reflects.
   */
  recordLiveHighFid(meta: {
    requested: string;
    active: boolean;
    reason?: string | null;
    cpuPercent?: number | null;
    oversample?: number | null;
  }): void {
    this.runtime.liveHighFidRequested = meta.requested;
    this.runtime.liveHighFidActive = meta.active;
    this.runtime.liveHighFidFallbackReason = meta.reason ?? null;
    if (meta.cpuPercent != null) this.runtime.liveHighFidCpuPercent = meta.cpuPercent;
    if (meta.oversample != null) this.runtime.liveHighFidOversample = meta.oversample;
    this.registerResolution(
      'live-highfid',
      meta.active ? 'highfid-worklet' : 'stock-open303',
      meta.reason ?? meta.requested,
    );
    if (!meta.active && meta.reason) {
      this.recordDegradation('live-highfid', true, meta.reason);
    }
  }

  /** Live A/B request / routing state — Phase-L2. */
  recordLiveAb(meta: { armed: boolean; engaged: boolean; mix: number }): void {
    this.runtime.liveAbArmed = meta.armed;
    this.runtime.liveAbEngaged = meta.engaged;
    this.runtime.liveAbMix = meta.mix;
  }

  /** Per-side CPU while A/B is engaged — the HUD's two rows (Phase-L2). */
  recordLiveAbCpu(meta: { stockPercent: number | null; highFidPercent: number | null }): void {
    if (meta.stockPercent != null) this.runtime.liveAbStockCpuPercent = meta.stockPercent;
    if (meta.highFidPercent != null) this.runtime.liveAbHighFidCpuPercent = meta.highFidPercent;
  }

  /**
   * Record the shared hyphon_native heap as reported by a voice worklet. Every
   * voice reports the same session, so the latest report wins.
   */
  recordHyphonNativeHeap(stats: unknown): void {
    if (!stats || typeof stats !== 'object') return;
    const s = stats as Record<string, unknown>;
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    const next: HyphonNativeHeapTelemetry = {
      heapCount: num(s.heapCount),
      initialPages: num(s.initialPages),
      currentPages: num(s.currentPages),
      growEvents: num(s.growEvents),
      voices: num(s.voices),
      threading: s.threading === 'pthread' || s.threading === 'st' ? s.threading : 'unknown',
    };
    const prev = this.runtime.hyphonNativeHeap;
    this.runtime.hyphonNativeHeap = next;
    if (next.heapCount > 1 && (!prev || prev.heapCount <= 1)) {
      this.recordDegradation(
        'hyphon-native-heap',
        true,
        `${next.heapCount} hyphon_native heaps allocated in one audio session (expected 1)`,
      );
    }
  }

  /** Session WebGPU probe (voices may still use WASM/JS; GPU HUD hard-fails). */
  recordWebGpuProbe(snapshot: WebGpuProbeSnapshot): void {
    this.runtime.webgpuProbe = snapshot;
    this.runtime.gpuAvailable = snapshot.ok;
  }

  /** `uncapturederror` on the shared GPUDevice (validation / OOM / internal). */
  recordWebGpuError(error: { type: string; message: string; deviceLabel: string }): void {
    const t = this.runtime.webgpuDevice;
    t.uncapturedErrors += 1;
    t.lastError = { ...error, ts: Date.now() };
    this.recordError('webgpu-device', `${error.type}: ${error.message}`);
  }

  /** `device.lost` on the shared GPUDevice, and whether a re-probe follows. */
  recordWebGpuDeviceLost(meta: { reason: string; message: string; intentional: boolean; willRecover: boolean }): void {
    const t = this.runtime.webgpuDevice;
    t.losses += 1;
    if (meta.willRecover) t.recoveries += 1;
    t.lastLoss = { reason: meta.reason, message: meta.message, intentional: meta.intentional, ts: Date.now() };
    if (!meta.intentional) {
      this.recordDegradation('webgpu-device-lost', !meta.willRecover, `${meta.reason}: ${meta.message}`);
    }
  }

  private recomputeMasterBudget(): void {
    let sum = 0;
    const now = Date.now();
    for (const [key, w] of this.runtime.worklets) {
      // A node that stopped reporting (context suspended, node torn down
      // without a detach) must not pin the budget at its last sample.
      if (now - w.ts > WORKLET_PERF_STALE_MS) {
        this.runtime.worklets.delete(key);
        continue;
      }
      sum += w.cpuPercent;
    }
    this.runtime.masterBudgetPercent = Math.min(100, sum);
  }

  getRuntimeSnapshot(): RuntimeSnapshot {
    this.recomputeMasterBudget();
    const worklets: Record<string, WorkletPerfReport> = {};
    for (const [name, w] of this.runtime.worklets.entries()) {
      worklets[name] = {
        cpuPercent: w.cpuPercent,
        underruns: w.underruns,
        lastProcessUs: w.processUs,
        lastQuantumUs: w.quantumUs,
        lastUpdate: w.ts,
      };
    }
    return {
      masterBudgetPercent: this.runtime.masterBudgetPercent,
      totalUnderruns: this.runtime.totalUnderruns,
      outputLatencyMs: this.runtime.outputLatencyMs,
      glitches: this.runtime.glitches.slice(),
      worklets,
      degradations: this.runtime.degradations.slice(),
      offlineRenderThreadCount: this.runtime.offlineRenderThreadCount,
      offlineRenderOversample: this.runtime.offlineRenderOversample,
      offlineRenderLatencyMs: this.runtime.offlineRenderLatencyMs,
      gpuRenderLatencyMs: this.runtime.gpuRenderLatencyMs,
      gpuReadbackBytes: this.runtime.gpuReadbackBytes,
      gpuFallbackReason: this.runtime.gpuFallbackReason,
      gpuUsedGpu: this.runtime.gpuUsedGpu,
      gpuAvailable: this.runtime.gpuAvailable,
      highFidRequested: this.runtime.highFidRequested,
      highFidActiveEngine: this.runtime.highFidActiveEngine,
      highFidRealtimeModel: this.runtime.highFidRealtimeModel,
      highFidFallbackReason: this.runtime.highFidFallbackReason,
      liveHighFidRequested: this.runtime.liveHighFidRequested,
      liveHighFidActive: this.runtime.liveHighFidActive,
      liveHighFidFallbackReason: this.runtime.liveHighFidFallbackReason,
      liveHighFidCpuPercent: this.runtime.liveHighFidCpuPercent,
      liveHighFidOversample: this.runtime.liveHighFidOversample,
      liveAbArmed: this.runtime.liveAbArmed,
      liveAbEngaged: this.runtime.liveAbEngaged,
      liveAbMix: this.runtime.liveAbMix,
      liveAbStockCpuPercent: this.runtime.liveAbStockCpuPercent,
      liveAbHighFidCpuPercent: this.runtime.liveAbHighFidCpuPercent,
      sampleRate: this.runtime.sampleRate,
      requestedSampleRate: this.runtime.requestedSampleRate,
      sampleRateFallback: this.runtime.sampleRateFallback,
      sinkId: this.runtime.sinkId,
      sinkLabel: this.runtime.sinkLabel,
      baseLatencyMs: this.runtime.baseLatencyMs,
      latencyHint: this.runtime.latencyHint,
      renderSizeHintRequested: this.runtime.renderSizeHintRequested,
      renderQuantumSize: this.runtime.renderQuantumSize,
      contextOptionFallback: this.runtime.contextOptionFallback,
      stepLookaheadMs: this.runtime.stepLookaheadMs,
      transportSync: this.runtime.transportSync,
      wam2Slots: this.runtime.wam2Slots.slice(),
      wam2Constraints: this.runtime.wam2Constraints,
      webgpuProbe: this.runtime.webgpuProbe,
      webgpuDevice: {
        ...this.runtime.webgpuDevice,
        lastLoss: this.runtime.webgpuDevice.lastLoss ? { ...this.runtime.webgpuDevice.lastLoss } : null,
        lastError: this.runtime.webgpuDevice.lastError ? { ...this.runtime.webgpuDevice.lastError } : null,
      },
      hyphonNativeHeap: this.runtime.hyphonNativeHeap ? { ...this.runtime.hyphonNativeHeap } : null,
    };
  }

  recordTransportSync(telemetry: TransportSyncTelemetry): void {
    this.runtime.transportSync = telemetry;
  }

  recordWam2Slots(slots: Wam2SlotTelemetry[]): void {
    this.runtime.wam2Slots = slots.slice();
  }

  recordWam2Constraints(constraints: Wam2RuntimeConstraints): void {
    this.runtime.wam2Constraints = constraints;
  }

  registerResolution(subsystem: string, backend: string, reason?: string) {
    let s = this.data.get(subsystem);
    if (!s) {
      s = emptyData();
      this.data.set(subsystem, s);
    }
    const res: Resolution = { backend, reason, ts: Date.now() };
    s.resolution = res;
    s.resolutionHistory.push(res);
    if (s.resolutionHistory.length > MAX_RESOLUTION_HISTORY) s.resolutionHistory.shift();
  }

  recordLatency(subsystem: string, ms: number) {
    let s = this.data.get(subsystem);
    if (!s) {
      s = emptyData();
      this.data.set(subsystem, s);
    }
    s.latencies.push(ms);
    if (s.latencies.length > s.maxLatencySamples) s.latencies.shift();
  }

  recordError(subsystem: string, err: unknown) {
    let s = this.data.get(subsystem);
    if (!s) {
      s = emptyData();
      this.data.set(subsystem, s);
    }
    s.errors.count += 1;
    s.errors.lastError = err instanceof Error ? err.message : String(err);
    s.errors.lastTs = Date.now();
  }

  snapshot(): Record<string, SubsystemReport> {
    const out: Record<string, SubsystemReport> = {};
    for (const [k, v] of this.data.entries()) {
      const last = v.latencies.slice(-v.maxLatencySamples);
      const report: SubsystemReport = {
        resolution: v.resolution || null,
        p50: percentile(last, 50),
        p95: percentile(last, 95),
        sampleCount: last.length,
        p95Reliable: last.length >= P95_MIN_SAMPLES,
        last: last.slice(-16),
        errors: { ...v.errors },
        resolutionHistory: v.resolutionHistory.slice(),
      };
      if (v.worklet) {
        report.worklet = {
          cpuPercent: v.worklet.cpuPercent,
          underruns: v.worklet.underruns,
          lastProcessUs: v.worklet.processUs,
          lastQuantumUs: v.worklet.quantumUs,
          lastUpdate: v.worklet.ts,
        };
      } else if (v.workletCpuHistory.length > 0) {
        const cpuLast = v.workletCpuHistory.slice(-v.maxLatencySamples);
        report.worklet = {
          cpuPercent: percentile(cpuLast, 50) ?? 0,
          underruns: this.lastUnderrunByWorklet.get(k) ?? 0,
          lastProcessUs: 0,
          lastQuantumUs: 0,
          lastUpdate: null,
        };
      }
      out[k] = report;
    }
    return out;
  }

  /** Serialize the current state to a report JSON string. */
  generateReportJSON(): string {
    return serializeEngineReport(
      this.snapshot(),
      getBrowserCapabilities(),
      this.getRuntimeSnapshot(),
    );
  }

  /** Trigger a manual export (download). Provider is injectable for testing. */
  exportReport(provider: DownloadProvider = browserDownloadProvider): void {
    provider.triggerDownload(this.generateReportJSON(), reportFilename());
  }
}

export const engineTelemetry = new EngineTelemetry();
