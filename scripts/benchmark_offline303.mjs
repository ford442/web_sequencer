#!/usr/bin/env node
/**
 * Phase-5 offline 303 performance benchmark (#978).
 *
 * Measures wall-clock time for representative offline renders at 1×/2×/4×
 * oversample and records GPU dispatch latency when WebGPU is available.
 *
 * Usage:
 *   pnpm exec vite-node scripts/benchmark_offline303.mjs
 *   pnpm exec vite-node scripts/benchmark_offline303.mjs --json /tmp/303-bench.json
 *
 * CI uploads the JSON artifact via .github/workflows/303-quality-benchmarks.yml
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderOfflineHighFid303Pattern } from '../src/audio/offline/OfflineHighFid303Engine.ts';
import { renderOffline303Pattern } from '../src/audio/offline/OfflineOpen303Engine.ts';
import {
  makeCanonical64StepPattern,
  render303OfflineWithMeta,
  terminateOffline303Pool,
} from '../src/audio/OfflineRenderer.ts';
import { renderGpuHighFid303 } from '../src/engines/WebGpu303Engine.ts';

function parseArgs(argv) {
  const out = { jsonPath: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--json' && argv[i + 1]) {
      out.jsonPath = resolve(argv[++i]);
    }
  }
  return out;
}

const CANONICAL_4 = {
  steps: [
    { note: 36, velocity: 90 },
    { note: 36, accent: true, slide: true, velocity: 120 },
    { note: 39, velocity: 90 },
    { note: 43, accent: true, slide: true, velocity: 120 },
  ],
  stepDurationSec: 0.152,
  params: {
    cutoff: 0.35,
    resonance: 0.7,
    envMod: 0.55,
    decay: 0.5,
    accent: 0.7,
    volume: 0.8,
  },
};

function benchSync(name, fn, reps = 5) {
  fn();
  const t0 = performance.now();
  for (let i = 0; i < reps; i++) fn();
  const ms = (performance.now() - t0) / reps;
  return { name, latencyMs: Math.round(ms * 100) / 100, reps };
}

async function benchAsync(name, fn, reps = 3) {
  await fn();
  const t0 = performance.now();
  for (let i = 0; i < reps; i++) await fn();
  const ms = (performance.now() - t0) / reps;
  return { name, latencyMs: Math.round(ms * 100) / 100, reps };
}

const args = parseArgs(process.argv);
const results = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  cases: [],
  gpu: null,
};

for (const os of [1, 2, 4]) {
  results.cases.push(
    benchSync(`highfid-cpu-canonical-4step-${os}x`, () =>
      renderOfflineHighFid303Pattern(CANONICAL_4, {
        oversample: os,
        sampleRate: 48000,
        blockSize: 128,
      }),
    ),
  );
  results.cases.push(
    benchSync(`stock-open303-canonical-4step-${os}x`, () =>
      renderOffline303Pattern('stock-open303', CANONICAL_4, {
        oversample: os,
        sampleRate: 48000,
        blockSize: 128,
      }),
    ),
  );
}

const stress = makeCanonical64StepPattern(130);
results.cases.push(
  benchSync('highfid-cpu-stress-64step-4x', () =>
    renderOfflineHighFid303Pattern(stress, { oversample: 4, sampleRate: 48000 }),
  ),
);

terminateOffline303Pool();
results.cases.push(
  await benchAsync('worker-pool-highfid-64step-4x', async () => {
    const meta = await render303OfflineWithMeta('highfid-cpu', stress, {
      oversample: 4,
      threadCount: 2,
      sync: false,
    });
    if (!meta.buffer.length) throw new Error('empty buffer');
  }),
);

const gpuMeta = await renderGpuHighFid303(CANONICAL_4, {
  oversample: 4,
  sampleRate: 48000,
});
results.gpu = {
  usedGpu: gpuMeta.usedGpu,
  latencyMs: Math.round(gpuMeta.latencyMs * 100) / 100,
  readbackBytes: gpuMeta.readbackBytes ?? 0,
  fallbackReason: gpuMeta.fallbackReason ?? null,
  frames: gpuMeta.buffer.length,
};

console.log('=== TB-303 offline benchmark ===');
for (const c of results.cases) {
  console.log(`${c.name.padEnd(36)} ${String(c.latencyMs).padStart(8)} ms (avg of ${c.reps})`);
}
console.log(
  `gpu-highfid: usedGpu=${results.gpu.usedGpu} latency=${results.gpu.latencyMs} ms readback=${results.gpu.readbackBytes} B fallback=${results.gpu.fallbackReason ?? 'none'}`,
);

if (args.jsonPath) {
  writeFileSync(args.jsonPath, JSON.stringify(results, null, 2) + '\n');
  console.log(`Wrote ${args.jsonPath}`);
}
