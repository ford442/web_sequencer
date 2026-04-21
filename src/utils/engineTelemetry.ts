// Lightweight runtime telemetry for engine backends
// Records backend resolution, recent latencies, and error counts.

type Resolution = { backend: string; reason?: string; ts: number };

type TelemetryData = {
  resolution?: Resolution | null;
  latencies: number[];
  errors: { count: number; lastError?: string; lastTs?: number | null };
  maxLatencySamples: number;
};

function percentile(arr: number[], p: number): number | null {
  if (!arr || arr.length === 0) return null;
  const copy = arr.slice().sort((a, b) => a - b);
  const idx = Math.min(copy.length - 1, Math.floor((p / 100) * (copy.length - 1)));
  return copy[idx] ?? null;
}

class EngineTelemetry {
  private data = new Map<string, TelemetryData>();

  registerResolution(subsystem: string, backend: string, reason?: string) {
    let s = this.data.get(subsystem);
    if (!s) s = { latencies: [], errors: { count: 0, lastError: undefined, lastTs: null }, maxLatencySamples: 256 };
    s.resolution = { backend, reason, ts: Date.now() };
    this.data.set(subsystem, s);
  }

  recordLatency(subsystem: string, ms: number) {
    let s = this.data.get(subsystem);
    if (!s) s = { latencies: [], errors: { count: 0, lastError: undefined, lastTs: null }, maxLatencySamples: 256 };
    s.latencies.push(ms);
    if (s.latencies.length > s.maxLatencySamples) s.latencies.shift();
    this.data.set(subsystem, s);
  }

  recordError(subsystem: string, err: unknown) {
    let s = this.data.get(subsystem);
    if (!s) s = { latencies: [], errors: { count: 0, lastError: undefined, lastTs: null }, maxLatencySamples: 256 };
    s.errors.count += 1;
    s.errors.lastError = err instanceof Error ? err.message : String(err);
    s.errors.lastTs = Date.now();
    this.data.set(subsystem, s);
  }

  snapshot() {
    const out: Record<string, any> = {};
    for (const [k, v] of this.data.entries()) {
      const last = v.latencies.slice(-v.maxLatencySamples);
      const p50 = percentile(last, 50);
      const p95 = percentile(last, 95);
      out[k] = {
        resolution: v.resolution || null,
        p50,
        p95,
        last: last.slice(-16),
        errors: { ...v.errors },
      };
    }
    return out;
  }
}

export const engineTelemetry = new EngineTelemetry();
