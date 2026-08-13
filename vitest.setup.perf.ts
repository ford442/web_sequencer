import { afterAll } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from './src/test/helpers/requireRepoArtifacts';
import { getRecordedPerfSamples } from './src/test/helpers/perfBenchmark';

import './vitest.setup.ts';

afterAll(() => {
  const summary = {
    collectedAt: new Date().toISOString(),
    tier: 'perf',
    samples: getRecordedPerfSamples(),
  };
  const out = join(repoRoot(), 'perf-summary.json');
  writeFileSync(out, JSON.stringify(summary, null, 2));
  process.env.VITEST_PERF_SUMMARY = out;
});
