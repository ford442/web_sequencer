/**
 * Throughput of the SIMD `cpp-*` kernel and C++ filter (emscripten/cpp_osc.cpp,
 * #1667): public/cpp_osc.wasm against its scalar twin public/cpp_osc_scalar.wasm,
 * the same source built without -msimd128.
 *
 * Absolute nanoseconds depend on the runner, so what is asserted is a *ratio
 * inside one run*, interleaved and best-of so a noisy neighbour hits both builds
 * alike. Reference numbers, ns per frame in 128-frame quanta, Node 22 / V8
 * TurboFan on a shared x86-64 runner (old = the scalar kernel before #1667):
 *
 *                       old    scalar twin    SIMD
 *   saw   440 Hz        4.3       3.4          2.5
 *   saw   a-rate        5.2       4.4          2.8
 *   square              4.5       4.6          3.2
 *   triangle            5.0       4.7          3.8
 *   sine               11.0       9.8          5.4   (libm sin -> f64x2 polynomial)
 *   saw   8 kHz        11.6       8.0          4.1   (a 32-tap correction every 6 frames)
 *   filter (LP, Q 2)    4.2       2.6          2.5   (two samples per step)
 *
 * The filter is a two-state recurrence: its gain comes from the pair-step form
 * (shorter dependency chain), which the scalar twin shares, so the filter is
 * measured against a ceiling, not a SIMD/scalar ratio.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertPerfBudget, benchmarkMedian, recordPerfSample } from '@/test/helpers/perfBenchmark';
import { requireRepoArtifacts } from '@/test/helpers/requireRepoArtifacts';
import { CPP_OSC_SHAPE_ID, instantiateCppOsc, type CppOscInstance } from '../cppOsc';
import { instantiateCppFilter } from '../cppFilter';

requireRepoArtifacts(['public/cpp_osc.wasm', 'public/cpp_osc_scalar.wasm']);

const RATE = 48000;
const QUANTUM = 128;
/** One second of audio per measured call. */
const QUANTA = 375;

const load = (file: string) =>
    new WebAssembly.Module(new Uint8Array(readFileSync(join(__dirname, '../../../public', file))));
const BUILDS = { simd: load('cpp_osc.wasm'), scalar: load('cpp_osc_scalar.wasm') } as const;
type Build = keyof typeof BUILDS;

function oscillator(build: Build, hz: number): CppOscInstance {
    const x = instantiateCppOsc(BUILDS[build], RATE);
    const freq = new Float32Array(x.memory.buffer, x.cosc_freq_ptr(), QUANTUM);
    for (let i = 0; i < QUANTUM; i++) freq[i] = hz + i;
    return x;
}

function msPerSecond(build: Build, label: string, shape: number, hz: number, perSample: boolean) {
    const x = oscillator(build, hz);
    const mode = perSample ? 1 : 0;
    const result = benchmarkMedian(
        () => { for (let q = 0; q < QUANTA; q++) x.cosc_render(shape, QUANTUM, mode); },
        { warmup: 6, samples: 7, iterations: 4 },
    );
    recordPerfSample(`cpp-osc.${build}.${label}.1s@48k`, result);
    return result;
}

/** Best-of-three, interleaved: SIMD time / scalar time for one workload. */
function ratio(label: string, shape: number, hz: number, perSample = false): number {
    let simd = Infinity;
    let scalar = Infinity;
    for (let round = 0; round < 3; round++) {
        simd = Math.min(simd, msPerSecond('simd', label, shape, hz, perSample).minMs);
        scalar = Math.min(scalar, msPerSecond('scalar', label, shape, hz, perSample).minMs);
    }
    const r = simd / scalar;
    console.log(`[perf] cpp-osc ${label}: simd ${simd.toFixed(3)} ms / scalar ${scalar.toFixed(3)} ms = ${r.toFixed(2)}`);
    return r;
}

describe('cpp-* oscillator throughput, SIMD build vs scalar twin', () => {
    it('one second of every shape renders in far under real time on either build', () => {
        for (const build of Object.keys(BUILDS) as Build[]) {
            for (const [shape, id] of Object.entries(CPP_OSC_SHAPE_ID)) {
                const r = msPerSecond(build, shape, id, 440, true);
                // 1 s of audio in 25 ms is 40x real time per voice, on any runner.
                assertPerfBudget(r, { name: `cpp-osc.${build}.${shape}`, absoluteCeilingMs: 25 });
            }
        }
    });

    it('the corrections are vectorized: an edge-dense saw is much cheaper on the SIMD build', () => {
        // 8 kHz at 48 kHz: a 32-tap residual every 6 frames. Reference ratio ~0.5.
        expect(ratio('saw-8k', CPP_OSC_SHAPE_ID.saw, 8000)).toBeLessThan(0.8);
    });

    it('the sine is vectorized: the f64x2 polynomial beats the same polynomial one lane at a time', () => {
        // Reference ratio ~0.57.
        expect(ratio('sine', CPP_OSC_SHAPE_ID.sin, 440, true)).toBeLessThan(0.85);
    });
});

describe('C++ filter throughput', () => {
    it('one second through the filter costs well under real time on either build', () => {
        for (const build of Object.keys(BUILDS) as Build[]) {
            const x = instantiateCppFilter(BUILDS[build]);
            const buf = new Float32Array(x.memory.buffer, x.cflt_buf_ptr(), QUANTUM);
            x.cflt_configure(RATE, 1000, 2, 0);
            const result = benchmarkMedian(
                () => {
                    for (let q = 0; q < QUANTA; q++) {
                        for (let i = 0; i < QUANTUM; i++) buf[i] = ((i * 37) % 64) / 32 - 1;
                        x.cflt_process(QUANTUM);
                    }
                },
                { warmup: 6, samples: 7, iterations: 4 },
            );
            recordPerfSample(`cpp-filter.${build}.lp.1s@48k`, result);
            assertPerfBudget(result, { name: `cpp-filter.${build}`, absoluteCeilingMs: 25 });
        }
    });
});
