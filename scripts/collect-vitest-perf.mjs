#!/usr/bin/env node
/**
 * Collect perf samples written to perf-summary.json after test:perf.
 * Vitest tests log [perf] lines; this script can also merge a hand-off file
 * when VITEST_PERF_SUMMARY is set by a custom reporter hook.
 */
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const outPath = process.argv[2] ?? 'perf-summary.json';
// `vitest.setup.perf.ts`'s afterAll hook writes real samples straight to this
// same path (it also sets process.env.VITEST_PERF_SUMMARY, but that only
// affects the vitest worker process, never this separate `node` invocation —
// whether run as the second half of `test:perf` or as its own CI step). Default
// the handoff to outPath so this script picks up what vitest already wrote
// instead of clobbering it with an empty stub.
const handoff = process.env.VITEST_PERF_SUMMARY ?? outPath;

let summary = {
  collectedAt: new Date().toISOString(),
  samples: [],
};

if (handoff && existsSync(handoff)) {
  summary = JSON.parse(readFileSync(handoff, 'utf8'));
} else {
  console.warn('No VITEST_PERF_SUMMARY handoff file; writing empty perf-summary.json stub.');
}

writeFileSync(join(process.cwd(), outPath), JSON.stringify(summary, null, 2));
console.log(`Wrote ${outPath}`);
