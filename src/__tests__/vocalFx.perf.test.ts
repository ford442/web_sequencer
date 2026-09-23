/**
 * Perf-tier: singing-voice FX on the Rubber Band audio thread, native
 * (rb_fx_* in public/rubberband.wasm) vs the TS chain it replaced.
 * Documented in docs/PERFORMANCE_BUDGET.md#singing-voice-fx.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { NativeVocalFx, type RubberBandFxModule } from '@/audio-worklets/rubberband/nativeVocalFx';
import { TsVocalFx } from '@/audio-worklets/rubberband/vocalFx';
import { assertPerfBudget, benchmarkMedian, recordPerfSample } from '@/test/helpers/perfBenchmark';
import {
  FX_ON_BLOCK,
  QUANTUM,
  blockFor,
  loadRubberBandFxModule,
  makeVocalSignal,
  xorshift32,
} from '@/test/helpers/vocalFxHarness';

const SAMPLE_RATE = 48000;
const BENCH = { warmup: 200, samples: 9, iterations: 2000 };

let wasm: RubberBandFxModule & { _malloc(n: number): number };
let signal: Float32Array;

beforeAll(async () => {
  wasm = await loadRubberBandFxModule();
  signal = makeVocalSignal(SAMPLE_RATE, 2);
});

describe('singing-voice FX audio-thread budget', () => {
  it('post-retrieve chain, FX-on vocal quantum: native is the default and not slower than TS', () => {
    const block = blockFor(FX_ON_BLOCK);
    const blocks = Math.floor(signal.length / QUANTUM);
    const bench = (chain: TsVocalFx | NativeVocalFx) => {
      const left = new Float32Array(QUANTUM);
      const right = new Float32Array(QUANTUM);
      let b = 0;
      return benchmarkMedian(() => {
        const start = (b++ % blocks) * QUANTUM;
        left.set(signal.subarray(start, start + QUANTUM));
        chain.process(block, left, right);
      }, BENCH);
    };

    const ts = bench(new TsVocalFx(SAMPLE_RATE, xorshift32(7)));
    const native = bench(new NativeVocalFx(wasm, SAMPLE_RATE, QUANTUM, 7));
    recordPerfSample('vocalFx.ts.quantum', ts);
    recordPerfSample('vocalFx.native.quantum', native);
    console.log(`[perf] vocalFx quantum speedup native/ts: ${(ts.medianMs / native.medianMs).toFixed(2)}x`);

    // Regression gate applies to the native path only (it is the default).
    assertPerfBudget(native, { name: 'vocalFx.native.quantum', absoluteCeilingMs: 0.5, regressionRatio: 1.25 });
    expect(native.medianMs).toBeLessThan(ts.medianMs);
  });

  it('freeze granulator, 1024-frame stretcher feed: native not slower than TS', () => {
    const frames = 1024;
    const block = blockFor({ windowShape: 2, grainJitter: 0.3, grainLfoDepth: 0.3 });
    const bench = (chain: TsVocalFx | NativeVocalFx) => {
      chain.setSampleBuffer(signal);
      const isNative = chain instanceof NativeVocalFx;
      const ptr = isNative ? wasm._malloc(frames * 4) : 0;
      const tsHeap = new Float32Array(frames);
      let cursor = 10000;
      return benchmarkMedian(() => {
        chain.advanceLfo(0, 2, QUANTUM);
        chain.renderGrains(
          block, isNative ? wasm.HEAPF32 : tsHeap, isNative ? ptr >> 2 : 0, frames,
          cursor, 0, signal.length,
        );
        cursor = 10000 + ((cursor + 131) % 40000);
      }, { warmup: 50, samples: 9, iterations: 300 });
    };

    const ts = bench(new TsVocalFx(SAMPLE_RATE, xorshift32(9)));
    const native = bench(new NativeVocalFx(wasm, SAMPLE_RATE, QUANTUM, 9));
    recordPerfSample('vocalFx.ts.grains1024', ts);
    recordPerfSample('vocalFx.native.grains1024', native);
    console.log(`[perf] vocalFx grains speedup native/ts: ${(ts.medianMs / native.medianMs).toFixed(2)}x`);

    assertPerfBudget(native, { name: 'vocalFx.native.grains1024', regressionRatio: 1.25 });
    expect(native.medianMs).toBeLessThan(ts.medianMs);
  });
});
