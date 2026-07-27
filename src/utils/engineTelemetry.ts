// Lightweight runtime telemetry for engine backends

import { engineDegradationStore } from '../stores/engineDegradationStore';

type Resolution = { backend: string; reason?: string; ts: number };

// Bound the per-subsystem fallback-transition log. ~20 * ~50 bytes = negligible.
const MAX_RESOLUTION_HISTORY = 20;
// The latency ring caps at maxLatencySamples (256). Below this many samples a p95
// is anecdotal, so we flag it rather than implying false statistical rigor.
export const P95_MIN_SAMPLES = 128;

type WorkletPerfSample = {
  cpuPercent: number;
  underruns: number;
  processUs: number;
  quantumUs: number;
  blockFrames: number;
  ts: number;
};

type GlitchEvent = {
  kind: string;
  detail?: Record<string, unknown>;
  ts: number;
};

type TelemetryData = {
  resolution?: Resolution | null;
  resolutionHistory: Resolution[];
  latencies: number[];
  errors: { count: number; lastError?: string; lastTs?: number | null };
  maxLatencySamples: number;
  worklet?: WorkletPerfSample;
  workletCpuHistory: number[];
};

type RuntimeTelemetry = {
  worklets: Map<string, WorkletPerfSample>;
  glitches: GlitchEvent[];
  outputLatencyMs: number | null;
  masterBudgetPercent: number;
  totalUnderruns: number;
  degradations: Array<{ step: string; active: boolean; reason: string; ts: number }>;
  offlineRenderThreadCount: number | null;
  offlineRenderOversample: number | null;
  offlineRenderLatencyMs: number | null;
  /** Phase-3 / #976 — last GPU 303 render wall latency (ms). */
  gpuRenderLatencyMs: number | null;
  /** Phase-3 — bytes read back from GPU on last successful gpu-highfid render. */
  gpuReadbackBytes: number | null;
  /** Phase-3 — why GPU path fell back to highfid-cpu (null if GPU used). */
  gpuFallbackReason: string | null;
  /** Phase-3 — whether the last gpu-highfid attempt used the WGSL path. */
  gpuUsedGpu: boolean | null;
  /** Phase-4 — navigator.gpu (or last selection probe) availability. */
  gpuAvailable: boolean | null;
  /** Phase-4 — last requested high-fid / model303 selection. */
  highFidRequested: string | null;
  /** Phase-4 — effective offline engine after fallback (gpu-highfid | highfid-cpu | …). */
  highFidActiveEngine: string | null;
  /** Phase-4 — realtime worklet model used while a high-fid voice is selected. */
  highFidRealtimeModel: string | null;
  /** Phase-4 — selection-time fallback reason (distinct from last render). */
  highFidFallbackReason: string | null;
};

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

// ── Capability snapshot (privacy-preserving) ────────────────────────────────
// Deliberately excludes the raw navigator.userAgent string (User-Agent Reduction
// makes it low-value and a fingerprinting footgun). Only low-entropy Client Hints
// (userAgentData brands/platform) are included when the browser exposes them.

export interface BrowserCapabilities {
  webgpu: boolean;
  audioWorklet: boolean;
  wasmSimd: boolean;
  pyodide: boolean;
  secureContext: boolean;
  tier: 'high' | 'medium' | 'low';
  userAgentData?: { brands?: unknown; platform?: string };
}

// Minimal valid WASM module exercising a v128 (SIMD) result type — used purely to
// feature-detect SIMD support via WebAssembly.validate (zero dependency).
const WASM_SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0,
  65, 0, 253, 15, 253, 98, 11,
]);

export function getBrowserCapabilities(): BrowserCapabilities {
  const nav = typeof navigator !== 'undefined' ? (navigator as unknown as Record<string, unknown>) : undefined;
  const webgpu = !!(nav && nav.gpu);
  const audioWorklet = typeof AudioWorkletNode !== 'undefined';
  let wasmSimd = false;
  try {
    wasmSimd = typeof WebAssembly !== 'undefined' && WebAssembly.validate(WASM_SIMD_PROBE);
  } catch {
    wasmSimd = false;
  }
  const pyodide =
    typeof window !== 'undefined' &&
    ('loadPyodide' in window || !!(window as unknown as Record<string, unknown>).pyodide);
  const secureContext = typeof window !== 'undefined' ? !!window.isSecureContext : false;
  const tier: BrowserCapabilities['tier'] =
    webgpu && audioWorklet && wasmSimd ? 'high' : audioWorklet && wasmSimd ? 'medium' : 'low';

  const caps: BrowserCapabilities = { webgpu, audioWorklet, wasmSimd, pyodide, secureContext, tier };

  const uad = nav && (nav.userAgentData as { brands?: unknown; platform?: string } | undefined);
  if (uad) {
    caps.userAgentData = { brands: uad.brands, platform: uad.platform };
  }
  return caps;
}

// ── Report shapes ───────────────────────────────────────────────────────────

export interface WorkletPerfReport {
  cpuPercent: number;
  underruns: number;
  lastProcessUs: number;
  lastQuantumUs: number;
  lastUpdate: number | null;
}

export interface SubsystemReport {
  resolution: Resolution | null;
  p50: number | null;
  p95: number | null;
  sampleCount: number;
  p95Reliable: boolean;
  last: number[];
  errors: { count: number; lastError?: string; lastTs?: number | null };
  resolutionHistory: Resolution[];
  worklet?: WorkletPerfReport;
}

export interface RuntimeSnapshot {
  masterBudgetPercent: number;
  totalUnderruns: number;
  outputLatencyMs: number | null;
  glitches: GlitchEvent[];
  worklets: Record<string, WorkletPerfReport>;
  degradations: Array<{ step: string; active: boolean; reason: string; ts: number }>;
  /** Last offline 303 render thread count (Phase-1 / #974). */
  offlineRenderThreadCount: number | null;
  /** Last offline 303 oversample factor (1|2|4). */
  offlineRenderOversample: number | null;
  /** Last offline 303 render wall latency in ms. */
  offlineRenderLatencyMs: number | null;
  /** Last GPU 303 render latency in ms (Phase-3 / #976). */
  gpuRenderLatencyMs: number | null;
  /** Last GPU 303 readback size in bytes. */
  gpuReadbackBytes: number | null;
  /** Why GPU 303 fell back to highfid-cpu (null if GPU succeeded). */
  gpuFallbackReason: string | null;
  /** Whether last gpu-highfid render used WebGPU. */
  gpuUsedGpu: boolean | null;
  /** Whether WebGPU was available at last high-fid selection / probe. */
  gpuAvailable: boolean | null;
  /** Last requested high-fid / model303 id. */
  highFidRequested: string | null;
  /** Effective offline high-fid engine after selection fallback. */
  highFidActiveEngine: string | null;
  /** Realtime worklet model while high-fid is selected. */
  highFidRealtimeModel: string | null;
  /** Selection-time high-fid fallback reason. */
  highFidFallbackReason: string | null;
}

export interface EngineReport {
  version: 1;
  exportedAt: string;
  sessionDurationMs: number;
  capabilities: BrowserCapabilities;
  subsystems: Record<string, SubsystemReport>;
  runtime: RuntimeSnapshot;
}

// ── Download abstraction (injectable so the pure logic stays DOM-free/testable) ─

export interface DownloadProvider {
  triggerDownload(json: string, filename: string): void;
}

export const browserDownloadProvider: DownloadProvider = {
  triggerDownload(json: string, filename: string) {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      // Revoke after the click has been processed by the event loop.
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }
  },
};

export function reportFilename(now: Date = new Date()): string {
  return `hyphon-engine-report-${now.toISOString().replace(/[:.]/g, '-')}.json`;
}

/**
 * Pure serialization of a telemetry snapshot + capability snapshot into a report
 * JSON string. No DOM, no globals beyond Date/performance — unit-testable directly.
 */
export function serializeEngineReport(
  snapshot: Record<string, SubsystemReport>,
  capabilities: BrowserCapabilities,
  runtime: RuntimeSnapshot,
): string {
  const report: EngineReport = {
    version: 1,
    exportedAt: new Date().toISOString(),
    sessionDurationMs: typeof performance !== 'undefined' ? Math.round(performance.now()) : 0,
    capabilities,
    subsystems: snapshot,
    runtime,
  };
  return JSON.stringify(report, null, 2);
}

const MAX_GLITCH_EVENTS = 64;
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
  };
  private lastUnderrunByWorklet = new Map<string, number>();

  registerWorklet(name: string): void {
    if (!this.data.has(name)) {
      this.data.set(name, emptyData());
    }
  }

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

  recordOutputLatency(latencyMs: number): void {
    this.runtime.outputLatencyMs = latencyMs;
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

  private recomputeMasterBudget(): void {
    let sum = 0;
    for (const w of this.runtime.worklets.values()) {
      sum += w.cpuPercent;
    }
    this.runtime.masterBudgetPercent = Math.min(100, sum);
  }

  getRuntimeSnapshot(): RuntimeSnapshot {
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
    };
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

/**
 * Resolve a path under Vite's `public/` directory to an absolute URL.
 *
 * Public assets live at the deployment root (e.g. dist/hyphon_native.wasm), but
 * application code is bundled under assets/. A bare `./foo` string breaks both
 * dynamic import() (resolved relative to assets/index.js) and subdirectory
 * deploys (e.g. https://host/hyphon/). Using document.baseURI + BASE_URL yields
 * a stable absolute URL in every context.
 */
export function resolvePublicAsset(relativePath: string): string {
  const base =
    typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL
      ? import.meta.env.BASE_URL
      : './';

  const normalized = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;

  if (typeof window !== 'undefined' && window.location?.href) {
    try {
      const assetRoot = new URL(base, window.location.href);
      return new URL(normalized, assetRoot).href;
    } catch {
      // fall through to relative path
    }
  }

  return `${base}${normalized}`;
}

/**
 * Loud fallback signal: always logs a concrete reason to the console and
 * records it in engineTelemetry before any JS-voice fallback is used.
 */
/** Throttle user-visible fallback warnings — one per subsystem per interval. */
export const ENGINE_FALLBACK_WARN_THROTTLE_MS = 10_000;

const lastUserWarnAt = new Map<string, number>();
const activeFallbacks = new Map<string, { requestedBackend: string; reason: string }>();

/**
 * Parse hyphon_native.js glue to recover minified WASM export names.
 * Used when hyphon_wasm_export_map.json is missing or stale (wasm-opt renames).
 */
export function parseHyphonGlueExportMap(glueSource: string): Record<string, string> {
  const map: Record<string, string> = {};
  const patterns = [
    /Module\["(_[^"]+)"\]=wasmExports\["([^"]+)"\]/g,
    /(_[a-zA-Z0-9_]+)=Module\["\1"\]=wasmExports\["([^"]+)"\]/g,
  ];
  for (const re of patterns) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(glueSource)) !== null) {
      map[match[1].slice(1)] = match[2];
    }
  }
  return map;
}

/**
 * Load the WASM export map: JSON first, then glue-source fallback.
 */
export async function loadHyphonWasmExportMap(): Promise<Record<string, string>> {
  const jsonUrl = resolvePublicAsset('hyphon_wasm_export_map.json');
  try {
    const response = await fetch(jsonUrl);
    if (response.ok) {
      const fromJson = (await response.json()) as Record<string, string>;
      if (fromJson && Object.keys(fromJson).length > 0) {
        return fromJson;
      }
    }
  } catch {
    /* try glue fallback */
  }

  const glueUrl = resolvePublicAsset('hyphon_native.js');
  try {
    const response = await fetch(glueUrl);
    if (response.ok) {
      const glue = await response.text();
      const fromGlue = parseHyphonGlueExportMap(glue);
      if (Object.keys(fromGlue).length > 0) {
        console.warn(
          `[EngineTelemetry] hyphon_wasm_export_map.json empty or missing; recovered ${Object.keys(fromGlue).length} exports from glue`,
        );
        return fromGlue;
      }
    }
  } catch {
    /* fall through */
  }

  return {};
}

/** Active engine fallbacks for UI/diagnostics (subsystem → reason). */
export function getActiveEngineFallbacks(): ReadonlyMap<string, { requestedBackend: string; reason: string }> {
  return activeFallbacks;
}

export function clearEngineFallbackWarning(subsystem: string): void {
  activeFallbacks.delete(subsystem);
  lastUserWarnAt.delete(subsystem);
}

/**
 * Throttled, user-visible warning when a selected engine degrades to JS fallback.
 * Dispatches `hyphon-engine-fallback` on window for optional UI hooks.
 */
export function emitUserEngineFallbackWarning(
  subsystem: string,
  requestedBackend: string,
  reason: string,
): void {
  const now = Date.now();
  const last = lastUserWarnAt.get(subsystem) ?? 0;
  if (now - last < ENGINE_FALLBACK_WARN_THROTTLE_MS) return;
  lastUserWarnAt.set(subsystem, now);

  activeFallbacks.set(subsystem, { requestedBackend, reason });
  const message =
    `Hyphon: "${subsystem}" engine could not load (${reason}). ` +
    `Audio will use the basic JavaScript oscillator instead of "${requestedBackend}".`;

  console.warn(`[Hyphon Engine Warning] ${message}`);

  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(
        new CustomEvent('hyphon-engine-fallback', {
          detail: { subsystem, requestedBackend, reason, message },
        }),
      );
    } catch {
      /* DOM may be unavailable in tests */
    }
  }
}

export function logEngineFallback(
  subsystem: string,
  requestedBackend: string,
  reason: string,
  err?: unknown,
): void {
  const errMsg =
    err instanceof Error ? err.message : err != null ? String(err) : undefined;
  const fullReason = errMsg ? `${reason}: ${errMsg}` : reason;
  console.error(
    `[EngineFallback] ${subsystem}: requested "${requestedBackend}" → JS fallback (${fullReason})`,
  );
  emitUserEngineFallbackWarning(subsystem, requestedBackend, fullReason);
  try {
    engineTelemetry.registerResolution(subsystem, 'fallback', fullReason);
    if (err != null) engineTelemetry.recordError(subsystem, err);
    engineDegradationStore.reportEngineFallback(subsystem, requestedBackend, fullReason);
  } catch {
    /* telemetry must never break audio init */
  }
}
