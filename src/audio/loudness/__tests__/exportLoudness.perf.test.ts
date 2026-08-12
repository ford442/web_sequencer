/**
 * Perf-tier: master loudness worklet audio-thread budget.
 * Documented in docs/PERFORMANCE_BUDGET.md.
 */

import { describe, expect, it } from 'vitest';
import { LoudnessMeter } from '../loudnessMeter';
import { TruePeakLimiter } from '../limiter';
import {
  assertPerfBudget,
  benchmarkMedian,
  recordPerfSample,
} from '@/test/helpers/perfBenchmark';

const SAMPLE_RATE = 48000;

describe('audio-thread budget', () => {
  it('processes a stereo quantum within the documented budget (median vs baseline)', () => {
    const limiter = new TruePeakLimiter(SAMPLE_RATE, 2);
    const meter = new LoudnessMeter({ sampleRate: SAMPLE_RATE, channelCount: 2 });
    const input = [new Float32Array(128), new Float32Array(128)];
    const output = [new Float32Array(128), new Float32Array(128)];
    for (let i = 0; i < 128; i += 1) {
      input[0][i] = 0.7 * Math.sin(i / 3);
      input[1][i] = 0.7 * Math.sin(i / 3.1);
    }

    const result = benchmarkMedian(
      () => {
        limiter.process(input, output, 128);
        meter.process(output, 128);
      },
      { warmup: 200, samples: 9, iterations: 2000 },
    );

    recordPerfSample('exportLoudness.quantum', result);

    // Functional ceiling from PERFORMANCE_BUDGET.md (0.5 ms); regression gate uses baseline JSON.
    assertPerfBudget(result, {
      name: 'exportLoudness.quantum',
      absoluteCeilingMs: 0.5,
      regressionRatio: 1.25,
    });

    expect(result.medianMs).toBeLessThan(0.5);
  });
});
