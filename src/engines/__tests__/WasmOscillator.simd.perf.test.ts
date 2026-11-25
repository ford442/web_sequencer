/**
 * Throughput of the SIMD `wam-*` kernel (assembly/oscillators.ts, #1663) on the real
 * src/wasm/oscillators.wasm: one 2 s table at 48 kHz (96 000 frames) per call.
 *
 * Absolute milliseconds depend on the runner, so the assertion that can tell the SIMD
 * kernel from the scalar one it replaced is a *ratio inside one run*:
 *
 *   sine / saw   scalar kernel 3.1x (a serial `Math.sin` per frame)
 *                SIMD kernel   1.0-1.1x (a four-lane polynomial)
 *
 * Reference numbers, ns per frame on a 2.1 GHz Xeon under Node 22 / V8 TurboFan (the
 * filter is a resonant lowpass, Q 6, so the biquad is in the measurement):
 *
 *            scalar    SIMD
 *   saw       7.9      4.1    (1.9x)
 *   square    5.6      4.2    (1.3x)
 *   triangle 10.8      4.9    (2.2x)
 *   sine     26.4      4.1    (6.5x)
 *
 * Whole-table cost is `frames * ns`: a 2 s sine table went from 2.7 ms to 0.44 ms, a saw table from 0.88 to 0.41 ms.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertPerfBudget, benchmarkMedian, recordPerfSample } from '@/test/helpers/perfBenchmark';
import { requireRepoArtifacts } from '@/test/helpers/requireRepoArtifacts';

requireRepoArtifacts(['src/wasm/oscillators.wasm']);

const RATE = 48000;
const SECONDS = 2;
const SHAPE = { saw: 0, sqr: 1, tri: 2, sin: 3 } as const;

interface Kernel {
    generate(o: number, sr: number, f: number, d: number, t: number, c: number, q: number, ft: number): number;
    generateLoop(o: number, sr: number, f: number, d: number, t: number, c: number, q: number, ft: number): number;
}

const wasm = new WebAssembly.Module(new Uint8Array(readFileSync(join(__dirname, '../../wasm/oscillators.wasm'))));
const kernel = new WebAssembly.Instance(wasm, { env: { abort: () => {} } }).exports as unknown as Kernel;

function msPerTable(fn: 'generate' | 'generateLoop', shape: keyof typeof SHAPE) {
    const result = benchmarkMedian(
        () => { kernel[fn](0, RATE, 220, SECONDS, SHAPE[shape], 1800, 6, 0); },
        // Warm-up long enough for V8 to tier the render loop up: wasm has no OSR, so the
        // optimized code only runs on a *later call* of the function.
        { warmup: 8, samples: 9, iterations: 12 },
    );
    recordPerfSample(`wam-oscillator.${fn}.${shape}.2s@48k`, result);
    return result;
}

describe('wam-* oscillator throughput', () => {
    for (const fn of ['generate', 'generateLoop'] as const) {
        it(`${fn}: a 2 s table of every shape renders in far under real time`, () => {
            for (const shape of Object.keys(SHAPE) as Array<keyof typeof SHAPE>) {
                const r = msPerTable(fn, shape);
                // Hard functional ceiling: 2 s of audio in 20 ms is 100x real time, on any runner.
                assertPerfBudget(r, { name: `wam-oscillator.${fn}.${shape}`, absoluteCeilingMs: 20 });
            }
        });

        it(`${fn}: the sine costs about what the saw costs — it is vectorized, not a scalar Math.sin per frame`, () => {
            // Interleaved, best-of, so a noisy neighbour hits both shapes alike.
            let saw = Infinity;
            let sin = Infinity;
            for (let round = 0; round < 3; round++) {
                saw = Math.min(saw, msPerTable(fn, 'saw').minMs);
                sin = Math.min(sin, msPerTable(fn, 'sin').minMs);
            }
            const ratio = sin / saw;
            console.log(`[perf] wam-oscillator.${fn} sine/saw = ${ratio.toFixed(2)} (scalar kernel: 3.1)`);
            expect(ratio, `sine ${sin.toFixed(3)} ms vs saw ${saw.toFixed(3)} ms`).toBeLessThan(2);
        });
    }
});
