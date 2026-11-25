/**
 * The SIMD build of the `cpp-*` kernel and the C++ filter (emscripten/cpp_osc.cpp,
 * #1667) on the real public/cpp_osc.wasm and its scalar twin
 * public/cpp_osc_scalar.wasm.
 *
 * Integration tier: needs `pnpm run build:wasm:cpp` (or build:native).
 *
 *   1. It is SIMD, in the shipped bytes: loops in the module hold the f32x4
 *      residual multiply-add, the f64x2 increment clamp, the f64x2 naive wave
 *      (sine polynomial included) narrowed to f32x4, and the f64x2
 *      two-samples-per-step filter. (-msimd128
 *      on scalar source can leave a module with no vector loop at all, so the
 *      flag alone proves nothing.)
 *   2. It stays inside the Safari 16.4 feature intersection (no relaxed-SIMD, no
 *      FMA), and the scalar twin holds no SIMD at all: it validates with SIMD
 *      switched off, which is the browser it exists for.
 *   3. The two builds are the same kernel: every shape, entry point, block size,
 *      frequency (including NaN / negative / beyond Nyquist) and filter response
 *      renders the same f32 samples, bit for bit.
 *   4. The sine is the sine: after the onset correction has passed, it is
 *      sin(2 pi f t) to f32 rounding.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkCppOscModule } from '../../../tools/check_cpp_osc_module.mjs';
import { CPP_OSC_SHAPE_ID, instantiateCppOsc, type CppOscInstance } from '../cppOsc';
import { CPP_FILTER_TYPE_ID, instantiateCppFilter, type CppFilterExports } from '../cppFilter';

const PUBLIC = join(__dirname, '../../../public');
const SIMD_BYTES = new Uint8Array(readFileSync(join(PUBLIC, 'cpp_osc.wasm')));
const SCALAR_BYTES = new Uint8Array(readFileSync(join(PUBLIC, 'cpp_osc_scalar.wasm')));
const SIMD = new WebAssembly.Module(SIMD_BYTES);
const SCALAR = new WebAssembly.Module(SCALAR_BYTES);
const RATE = 48000;

// --- binaryen (assemblyscript's own dependency) ---------------------------------

interface Binaryen {
    Features: Record<string, number>;
    readBinary(bytes: Uint8Array): {
        setFeatures(f: number): void;
        validate(): number;
        emitText(): string;
        dispose(): void;
    };
}

async function loadBinaryen(): Promise<Binaryen> {
    const asDir = realpathSync(join(process.cwd(), 'node_modules', 'assemblyscript'));
    const entry = join(dirname(asDir), 'binaryen', 'index.js');
    const mod = (await import(/* @vite-ignore */ pathToFileURL(entry).href)) as { default: Binaryen };
    return mod.default;
}

async function wat(bytes: Uint8Array): Promise<string> {
    const binaryen = await loadBinaryen();
    const m = binaryen.readBinary(bytes);
    m.setFeatures(binaryen.Features.All);
    const text = m.emitText();
    m.dispose();
    return text;
}

/** Every `(loop ...)` form in the text, outermost and nested alike. */
function loops(text: string): string[] {
    const out: string[] = [];
    for (const match of text.matchAll(/\(loop\b/g)) {
        const start = match.index;
        let depth = 0;
        for (let i = start; i < text.length; i++) {
            if (text[i] === '(') depth++;
            else if (text[i] === ')' && --depth === 0) {
                out.push(text.slice(start, i + 1));
                break;
            }
        }
    }
    return out;
}

/** Loops that hold every one of `ops` (each loop body includes its nested loops). */
const loopsWith = (all: string[], ops: string[]) => all.filter((l) => ops.every((op) => l.includes(op)));

describe('cpp_osc.wasm is real SIMD (#1667)', () => {
    it('passes the release checker as the SIMD build, and the twin as the scalar one', () => {
        expect(checkCppOscModule(SIMD_BYTES, { variant: 'simd' })).toEqual([]);
        expect(checkCppOscModule(SCALAR_BYTES, { variant: 'scalar' })).toEqual([]);
    });

    it('its sample and filter loops are f32x4 / f64x2 code', async () => {
        const all = loops(await wat(SIMD_BYTES));
        const kernels: Record<string, string[]> = {
            // A 32-tap BLEP / BLAMP correction: eight f32x4 lerp-multiply-adds into the delay line.
            residual: ['f32x4.sub', 'f32x4.mul', 'f32x4.add', 'v128.store'],
            // Hz -> phase increment, two frames per step, NaN and the Nyquist clamp branch-free
            // (clang folds `and(v, v > 0)` into the equivalent `pmax(0, v)`).
            increments: ['f64x2.promote_low_f32x4', 'f64x2.mul', 'f64x2.pmin', 'v128.store'],
            // The naive wave in f64x2, narrowed and packed four to a vector.
            naive: ['f32x4.demote_f64x2_zero', 'i8x16.shuffle', 'v128.store'],
            // The sine polynomial (Horner in f64x2).
            sine: ['f64x2.mul', 'f64x2.add', 'f64x2.ge', 'v128.bitselect', 'f32x4.demote_f64x2_zero'],
            // The SVF, two samples per step: f64x2 state update and output, both
            // frames stored with one 64-bit lane store (clang narrows the two
            // outputs with scalar demotes, its choice).
            filter: ['f64x2.promote_low_f32x4', 'f64x2.mul', 'f64x2.add', 'v128.store64_lane'],
        };
        for (const [name, ops] of Object.entries(kernels)) {
            expect(loopsWith(all, ops).length, `a loop holding ${ops.join(', ')} (${name})`).toBeGreaterThan(0);
        }
    });

    it('uses no relaxed-SIMD instruction and no FMA (they would change the rounding)', async () => {
        const text = await wat(SIMD_BYTES);
        expect(text).not.toMatch(/relaxed/);
        expect(text).not.toMatch(/\.fma\b|\.madd\b|\.nmadd\b/);
    });

    it('validates under the Safari 16.4 feature set; the scalar twin validates without SIMD, the SIMD build does not', async () => {
        const binaryen = await loadBinaryen();
        const F = binaryen.Features;
        const safari = F.MutableGlobals | F.NontrappingFPToInt | F.SignExt | F.Multivalue
            | F.BulkMemory | F.BulkMemoryOpt | F.ReferenceTypes | F.SIMD128;
        const validate = (bytes: Uint8Array, features: number) => {
            const m = binaryen.readBinary(bytes);
            m.setFeatures(features);
            const log = console.log, err = console.error;
            // binaryen prints each complaint; the negative control is expected to have some.
            console.log = () => {}; console.error = () => {};
            try { return m.validate(); } finally { console.log = log; console.error = err; m.dispose(); }
        };
        expect(validate(SIMD_BYTES, safari)).toBe(1);
        expect(validate(SCALAR_BYTES, safari & ~F.SIMD128)).toBe(1);
        expect(validate(SIMD_BYTES, safari & ~F.SIMD128)).toBe(0);
    });

    it('the scalar twin holds no vector instruction at all', async () => {
        expect(await wat(SCALAR_BYTES)).not.toMatch(/\b(?:v128|[fi](?:8x16|16x8|32x4|64x2))\./);
    });
});

// --- the same kernel ------------------------------------------------------------

function osc(module: WebAssembly.Module): CppOscInstance {
    return instantiateCppOsc(module, RATE);
}

/** Render `total` frames, block sizes cycling through `sizes`, resetting at `resets`. */
function renderOsc(
    x: CppOscInstance,
    shape: number,
    total: number,
    hz: (frame: number) => number,
    sizes: readonly number[],
    perSample: boolean,
    resets: readonly number[] = [],
): Float32Array {
    const max = x.cosc_max_frames();
    const freq = new Float32Array(x.memory.buffer, x.cosc_freq_ptr(), max);
    const out = new Float32Array(x.memory.buffer, x.cosc_out_ptr(), max);
    const result = new Float32Array(total);
    let done = 0;
    for (let b = 0; done < total; b++) {
        const n = Math.min(sizes[b % sizes.length], total - done, max);
        if (resets.includes(b)) x.cosc_reset(0.37);
        for (let i = 0; i < n; i++) freq[i] = hz(done + i);
        expect(x.cosc_render(shape, n, perSample ? 1 : 0)).toBe(n);
        result.set(out.subarray(0, n), done);
        done += n;
    }
    return result;
}

function firstDifference(a: Float32Array, b: Float32Array): string | null {
    for (let i = 0; i < a.length; i++) {
        if (!Object.is(a[i], b[i]) && !(a[i] === 0 && b[i] === 0)) return `frame ${i}: ${a[i]} vs ${b[i]}`;
    }
    return null;
}

const SIZES: Record<string, readonly number[]> = {
    quantum: [128],
    single: [1],
    odd: [3, 7, 13, 1, 5],
    whole: [1024],
    ragged: [61, 2, 129, 33, 4, 1000],
};

describe('the SIMD build and the scalar twin render the same samples', () => {
    for (const [shape, id] of Object.entries(CPP_OSC_SHAPE_ID)) {
        it(`${shape}: fixed pitches, every block pattern, with resets`, () => {
            for (const hzValue of [20, 27.5, 440, 3520, 12000, 23999, 24000, 30000]) {
                for (const [pattern, sizes] of Object.entries(SIZES)) {
                    const args = [id, 6000, () => hzValue, sizes, false, [0, 9]] as const;
                    const a = renderOsc(osc(SIMD), ...args);
                    const b = renderOsc(osc(SCALAR), ...args);
                    expect(firstDifference(a, b), `${hzValue} Hz, ${pattern} blocks`).toBeNull();
                }
            }
        });

        it(`${shape}: a-rate sweeps and hostile frequencies`, () => {
            const sweep = (n: number) => 20 * Math.pow(1200, (n % 24000) / 24000);
            const hostile = (n: number) => [440, NaN, -5, 0, 1e9, Infinity, -0, 1e-30][Math.floor(n / 29) % 8];
            for (const hz of [sweep, hostile]) {
                for (const sizes of [SIZES.quantum, SIZES.odd]) {
                    const a = renderOsc(osc(SIMD), id, 9000, hz, sizes, true, [0, 3]);
                    const b = renderOsc(osc(SCALAR), id, 9000, hz, sizes, true, [0, 3]);
                    expect(firstDifference(a, b), hz.name).toBeNull();
                    expect(a.every(Number.isFinite)).toBe(true);
                }
            }
        });
    }

    function renderFilter(x: CppFilterExports, type: number, cutoff: number, q: number, input: Float32Array, sizes: readonly number[]) {
        const buf = new Float32Array(x.memory.buffer, x.cflt_buf_ptr(), x.cosc_max_frames());
        expect(x.cflt_configure(RATE, cutoff, q, type)).toBe(1);
        x.cflt_reset();
        const result = new Float32Array(input.length);
        let done = 0;
        for (let b = 0; done < input.length; b++) {
            const n = Math.min(sizes[b % sizes.length], input.length - done);
            buf.set(input.subarray(done, done + n));
            expect(x.cflt_process(n)).toBe(n);
            result.set(buf.subarray(0, n), done);
            done += n;
        }
        return result;
    }

    it('the C++ filter: every response, cutoff and Q, odd and even block lengths', () => {
        let seed = 1;
        const input = new Float32Array(12000).map((_, i) => {
            seed = (seed * 1664525 + 1013904223) >>> 0;
            return 0.5 * Math.sin(i * 0.031) + (seed / 2 ** 32 - 0.5);
        });
        for (const [type, id] of Object.entries(CPP_FILTER_TYPE_ID)) {
            for (const cutoff of [20, 180, 2500, 15000, 23000]) {
                for (const q of [0.1, 0.7071, 4, 24]) {
                    for (const sizes of [SIZES.quantum, SIZES.single, SIZES.odd]) {
                        const a = renderFilter(instantiateCppFilter(SIMD), id, cutoff, q, input, sizes);
                        const b = renderFilter(instantiateCppFilter(SCALAR), id, cutoff, q, input, sizes);
                        expect(firstDifference(a, b), `${type} ${cutoff} Hz Q ${q} [${sizes.join(", ")}]`).toBeNull();
                    }
                }
            }
        }
    });
});

describe('the sine polynomial', () => {
    it('is sin(2 pi f t) to f32 rounding once the onset correction has passed', () => {
        for (const module of [SIMD, SCALAR]) {
            const x = osc(module);
            const latency = x.cosc_latency();
            for (const hz of [27.5, 440, 1234.5, 9000]) {
                x.cosc_reset(0);
                const out = renderOsc(x, CPP_OSC_SHAPE_ID.sin, 8192, () => hz, [128], false);
                const inc = Math.fround(hz) / RATE;
                let worst = 0;
                // The phase accumulates in f64, as the kernel's does; skip the onset's 2 x 16 taps.
                let p = 0;
                for (let n = 0; n < out.length; n++) {
                    const k = n - latency;
                    if (k >= 0) {
                        if (k >= 2 * latency) worst = Math.max(worst, Math.abs(out[n] - Math.sin(2 * Math.PI * p)));
                        p += inc;
                        if (p >= 1) p -= 1;
                    }
                }
                // f32 half-ulp at 1.0 is 6e-8; anything near 1e-7 is rounding, not the polynomial.
                expect(worst, `${hz} Hz`).toBeLessThan(1.2e-7);
            }
        }
    });
});
