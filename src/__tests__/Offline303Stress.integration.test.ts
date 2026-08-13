/**
 * Phase-5 stress / memory — concurrent offline renders (sync path in Vitest;
 * Worker pool is exercised by scripts/benchmark_offline303.mjs where Worker is real).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { bufferHasNonFinite } from '@/audio/offline/OfflineOpen303Engine';
import {
  makeCanonical64StepPattern,
  render303OfflineMultiWithMeta,
  render303OfflineWithMeta,
  terminateOffline303Pool,
} from '@/audio/OfflineRenderer';

describe('Offline303 concurrent render stress', () => {
  beforeEach(() => {
    terminateOffline303Pool();
  });

  afterEach(() => {
    terminateOffline303Pool();
  });

  it('runs 8 concurrent highfid-cpu renders without OOM or non-finite samples', async () => {
    const pattern = makeCanonical64StepPattern(128);
    const jobs = Array.from({ length: 8 }, () =>
      render303OfflineWithMeta('highfid-cpu', pattern, {
        oversample: 4,
        threadCount: 2,
        sync: true,
      }).then((meta) => {
        expect(meta.buffer.length).toBeGreaterThan(10_000);
        expect(bufferHasNonFinite(meta.buffer)).toBe(false);
        expect(meta.latencyMs).toBeLessThan(30_000);
        return meta;
      }),
    );

    const results = await Promise.all(jobs);
    expect(results).toHaveLength(8);
  }, 120_000);

  it('mixes stock + highfid + gpu-highfid voices concurrently', async () => {
    const pattern = makeCanonical64StepPattern(130);
    const meta = await render303OfflineMultiWithMeta(
      [
        { modelId: 'stock-open303', pattern, gain: 0.5 },
        { modelId: 'highfid-cpu', pattern, gain: 0.5 },
        { modelId: 'gpu-highfid', pattern, gain: 0.25 },
      ],
      { oversample: 4, threadCount: 3, sync: true },
    );
    expect(meta.buffer.length).toBeGreaterThan(10_000);
    expect(bufferHasNonFinite(meta.buffer)).toBe(false);
  }, 60_000);

  it('rapid burst of renders completes without unhandled rejections', async () => {
    terminateOffline303Pool();
    const pattern = makeCanonical64StepPattern(140);
    const burst = Array.from({ length: 12 }, () =>
      render303OfflineWithMeta('highfid-cpu', pattern, {
        oversample: 2,
        sync: true,
      }),
    );
    await expect(Promise.all(burst)).resolves.toBeDefined();
  }, 120_000);
});
