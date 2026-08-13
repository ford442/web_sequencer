import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import { repoRoot } from './requireRepoArtifacts';

export interface PerfBenchmarkOptions {
  /** Warm-up iterations before timing (default 200). */
  warmup?: number;
  /** Number of timed sample runs (default 9). */
  samples?: number;
  /** Inner-loop iterations per sample (default 1000). */
  iterations?: number;
}

export interface PerfBenchmarkResult {
  medianMs: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
  samples: number[];
  iterations: number;
}

export interface PerfBudgetOptions {
  name: string;
  /** Hard functional ceiling from PERFORMANCE_BUDGET.md (ms). */
  absoluteCeilingMs?: number;
  /** Max ratio vs committed baseline median (default 1.25). */
  regressionRatio?: number;
}

interface PerfBaselineEntry {
  medianMs: number;
  runner?: string;
  note?: string;
}

type PerfBaselineFile = Record<string, PerfBaselineEntry>;

const perfSamples: Array<{ name: string; result: PerfBenchmarkResult }> = [];

/** Samples collected during a perf run (read by scripts/collect-vitest-perf.mjs). */
export function getRecordedPerfSamples(): typeof perfSamples {
  return perfSamples;
}

export function recordPerfSample(name: string, result: PerfBenchmarkResult): void {
  perfSamples.push({ name, result });
  const summary = `[perf] ${name}: median=${result.medianMs.toFixed(4)}ms p95=${result.p95Ms.toFixed(4)}ms`;
  console.log(summary);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

/**
 * Time `fn` over multiple samples; returns median and p95 per inner iteration.
 */
export function benchmarkMedian(
  fn: () => void,
  opts: PerfBenchmarkOptions = {},
): PerfBenchmarkResult {
  const warmup = opts.warmup ?? 200;
  const samples = opts.samples ?? 9;
  const iterations = opts.iterations ?? 1000;

  for (let i = 0; i < warmup; i += 1) fn();

  const sampleMs: number[] = [];
  for (let s = 0; s < samples; s += 1) {
    const start = performance.now();
    for (let i = 0; i < iterations; i += 1) fn();
    sampleMs.push((performance.now() - start) / iterations);
  }

  const sorted = [...sampleMs].sort((a, b) => a - b);
  return {
    medianMs: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
    samples: sampleMs,
    iterations,
  };
}

function loadBaseline(name: string): PerfBaselineEntry | null {
  const path = join(repoRoot(), 'src/test/perf-baselines', `${name}.json`);
  if (!existsSync(path)) return null;
  const data = JSON.parse(readFileSync(path, 'utf8')) as PerfBaselineFile | PerfBaselineEntry;
  if ('medianMs' in data && typeof data.medianMs === 'number') {
    return data as PerfBaselineEntry;
  }
  return (data as PerfBaselineFile)[name] ?? null;
}

/**
 * Assert perf result stays within absolute ceiling and optional baseline regression band.
 */
export function assertPerfBudget(
  result: PerfBenchmarkResult,
  opts: PerfBudgetOptions,
): void {
  const ratio = opts.regressionRatio ?? 1.25;

  if (opts.absoluteCeilingMs !== undefined) {
    expect(
      result.medianMs,
      `${opts.name}: median ${result.medianMs.toFixed(4)}ms exceeds ceiling ${opts.absoluteCeilingMs}ms`,
    ).toBeLessThanOrEqual(opts.absoluteCeilingMs);
  }

  const baseline = loadBaseline(opts.name);
  if (baseline) {
    const limit = baseline.medianMs * ratio;
    expect(
      result.medianMs,
      `${opts.name}: median ${result.medianMs.toFixed(4)}ms exceeds baseline ${baseline.medianMs}ms * ${ratio}`,
    ).toBeLessThanOrEqual(limit);
  }
}

export interface CompareBenchmarkResult {
  name: string;
  jsTime: number;
  wasmTime: number;
  speedup: number;
  iterations: number;
}

/**
 * Compare JS vs WASM implementations with warm-up and median timing.
 */
export function compareBenchmark(
  name: string,
  jsFn: () => void,
  wasmFn: () => void,
  iterations: number,
  opts: { warmup?: number; samples?: number } = {},
): CompareBenchmarkResult {
  const jsResult = benchmarkMedian(jsFn, {
    warmup: opts.warmup ?? 10,
    samples: opts.samples ?? 5,
    iterations,
  });
  const wasmResult = benchmarkMedian(wasmFn, {
    warmup: opts.warmup ?? 10,
    samples: opts.samples ?? 5,
    iterations,
  });

  const speedup = jsResult.medianMs / wasmResult.medianMs;
  const out = {
    name,
    jsTime: jsResult.medianMs * iterations,
    wasmTime: wasmResult.medianMs * iterations,
    speedup,
    iterations,
  };

  recordPerfSample(`bench.${name}`, {
    ...jsResult,
    medianMs: wasmResult.medianMs,
    p95Ms: wasmResult.p95Ms,
  });

  console.log(
    `${name}: JS=${jsResult.medianMs.toFixed(4)}ms/iter, ` +
      `WASM=${wasmResult.medianMs.toFixed(4)}ms/iter, ` +
      `Speedup=${speedup.toFixed(2)}x`,
  );

  return out;
}
