// Lightweight runtime telemetry for engine backends
// Records backend resolution, recent latencies, and error counts.
// Also produces an exportable, privacy-preserving session report (see issue #699).

type Resolution = { backend: string; reason?: string; ts: number };

// Bound the per-subsystem fallback-transition log. ~20 * ~50 bytes = negligible.
const MAX_RESOLUTION_HISTORY = 20;
// The latency ring caps at maxLatencySamples (256). Below this many samples a p95
// is anecdotal, so we flag it rather than implying false statistical rigor.
export const P95_MIN_SAMPLES = 128;

type TelemetryData = {
  resolution?: Resolution | null;
  resolutionHistory: Resolution[];
  latencies: number[];
  errors: { count: number; lastError?: string; lastTs?: number | null };
  maxLatencySamples: number;
};

function emptyData(): TelemetryData {
  return {
    resolution: null,
    resolutionHistory: [],
    latencies: [],
    errors: { count: 0, lastError: undefined, lastTs: null },
    maxLatencySamples: 256,
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

export interface SubsystemReport {
  resolution: Resolution | null;
  p50: number | null;
  p95: number | null;
  sampleCount: number;
  p95Reliable: boolean;
  last: number[];
  errors: { count: number; lastError?: string; lastTs?: number | null };
  resolutionHistory: Resolution[];
}

export interface EngineReport {
  version: 1;
  exportedAt: string;
  sessionDurationMs: number;
  capabilities: BrowserCapabilities;
  subsystems: Record<string, SubsystemReport>;
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
): string {
  const report: EngineReport = {
    version: 1,
    exportedAt: new Date().toISOString(),
    sessionDurationMs: typeof performance !== 'undefined' ? Math.round(performance.now()) : 0,
    capabilities,
    subsystems: snapshot,
  };
  return JSON.stringify(report, null, 2);
}

export class EngineTelemetry {
  private data = new Map<string, TelemetryData>();

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
      out[k] = {
        resolution: v.resolution || null,
        p50: percentile(last, 50),
        p95: percentile(last, 95),
        sampleCount: last.length,
        p95Reliable: last.length >= P95_MIN_SAMPLES,
        last: last.slice(-16),
        errors: { ...v.errors },
        resolutionHistory: v.resolutionHistory.slice(),
      };
    }
    return out;
  }

  /** Serialize the current state to a report JSON string. */
  generateReportJSON(): string {
    return serializeEngineReport(this.snapshot(), getBrowserCapabilities());
  }

  /** Trigger a manual export (download). Provider is injectable for testing. */
  exportReport(provider: DownloadProvider = browserDownloadProvider): void {
    provider.triggerDownload(this.generateReportJSON(), reportFilename());
  }
}

export const engineTelemetry = new EngineTelemetry();

/** Resolve an absolute URL for a `public/` asset (respects Vite `base`). */
export function resolvePublicAsset(relativePath: string): string {
  const base =
    typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL
      ? import.meta.env.BASE_URL
      : './';
  const normalized = relativePath.replace(/^\//, '');

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
  try {
    engineTelemetry.registerResolution(subsystem, 'fallback', fullReason);
    if (err != null) engineTelemetry.recordError(subsystem, err);
  } catch {
    /* telemetry must never break audio init */
  }
}
