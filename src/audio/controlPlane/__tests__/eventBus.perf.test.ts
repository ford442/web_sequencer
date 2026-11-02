/**
 * Perf-tier (#1497): the control plane allocates nothing per record on its
 * hot path. A producer stages each record in the bus's Float64Array and
 * commits it. The record crosses a SharedArrayBuffer ring, and the worklet
 * decodes it into a Float64Array (popInto). That leaves the heap where it was,
 * computed doubles included. One heap number per record would be 1.6 MB.
 *
 * Measured in a child `node --expose-gc` on a Vite build of
 * fixtures/allocationProbe.ts. Under vitest's module transform V8 does not
 * optimise the loop as it would an app bundle, and the numbers mean little.
 *
 * Positional push(…) with doubles is reported but not budgeted. V8 boxes a
 * double argument wherever it does not inline the call (about 1 MB per 100k
 * records here), which is why hot producers stage instead. The postMessage
 * fallback allocates one buffer per flush (per tick), by design.
 * See docs/wasm/VOICE_CORE.md#control-plane.
 */

import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'vite';

/** Heap growth allowed over the probe's 100k records: noise, not a per-record cost. */
const BUDGET_BYTES = 64 * 1024;

interface Scenario {
  grown: number;
  dropped: number;
}

async function runProbe(): Promise<{ records: number; staged: Scenario; positional: Scenario; integers: Scenario }> {
  const outDir = mkdtempSync(join(tmpdir(), 'hyphon-alloc-probe-'));
  try {
    await build({
      configFile: false,
      logLevel: 'silent',
      build: {
        ssr: resolve(__dirname, 'fixtures/allocationProbe.ts'),
        outDir,
        emptyOutDir: true,
        minify: false,
        rollupOptions: { output: { format: 'es', entryFileNames: 'probe.mjs' } },
      },
    });
    const run = spawnSync(process.execPath, ['--expose-gc', join(outDir, 'probe.mjs')], { encoding: 'utf8' });
    if (run.status !== 0) throw new Error(`allocation probe failed (${run.status}): ${run.stderr}`);
    return JSON.parse(run.stdout) as Awaited<ReturnType<typeof runProbe>>;
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

describe('control plane allocation (ring route)', () => {
  it('staged records with computed doubles, and integer records: nothing per record', async () => {
    const result = await runProbe();
    const report = JSON.stringify(result);
    expect(result.staged.dropped, report).toBe(0);
    expect(result.staged.grown, `staged: ${report}`).toBeLessThan(BUDGET_BYTES);
    expect(result.integers.grown, `integers: ${report}`).toBeLessThan(BUDGET_BYTES);
    // Not budgeted: documents why hot producers stage rather than push doubles.
    expect(result.positional.dropped).toBe(0);
  });
});
