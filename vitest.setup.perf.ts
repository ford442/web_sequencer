import { afterAll } from 'vitest';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from './src/test/helpers/requireRepoArtifacts';
import { getRecordedPerfSamples } from './src/test/helpers/perfBenchmark';

import './vitest.setup.ts';

const SUMMARY_PATH = join(repoRoot(), 'perf-summary.json');

/**
 * Vitest resets its module registry per test FILE even under `singleFork` +
 * `fileParallelism: false` (`isolate: true` is the default), so this setup
 * file — and the `perfSamples` array in perfBenchmark.ts it reads via
 * `getRecordedPerfSamples()` — re-executes fresh for every perf test file.
 * Without the guard below, each file's `afterAll` would overwrite
 * perf-summary.json with only THAT file's samples, and whichever file happens
 * to finish last (often one with zero recorded samples, e.g.
 * useAudioEngine.perf.test.tsx) silently wins — discarding every other file's
 * data even on an all-green run. `globalThis` is the one thing that survives
 * Vitest's per-file module reset within the same forked process, so it is
 * used here to clear any stale summary exactly once per `vitest run` and then
 * accumulate every file's samples into it instead of replacing it.
 */
const RUN_MARKER = Symbol.for('hyphon.perfSummaryRunStarted');
const globalWithMarker = globalThis as typeof globalThis & { [RUN_MARKER]?: boolean };
if (!globalWithMarker[RUN_MARKER]) {
  globalWithMarker[RUN_MARKER] = true;
  try {
    unlinkSync(SUMMARY_PATH);
  } catch {
    // No stale file from a previous run — nothing to remove.
  }
}

afterAll(() => {
  const existing = existsSync(SUMMARY_PATH)
    ? (JSON.parse(readFileSync(SUMMARY_PATH, 'utf8')) as { samples?: unknown[] })
    : { samples: [] };
  const samples = [...(existing.samples ?? []), ...getRecordedPerfSamples()];

  const summary = {
    collectedAt: new Date().toISOString(),
    tier: 'perf',
    samples,
  };
  writeFileSync(SUMMARY_PATH, JSON.stringify(summary, null, 2));
  process.env.VITEST_PERF_SUMMARY = SUMMARY_PATH;
});
