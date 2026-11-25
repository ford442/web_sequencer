/**
 * The SIMD `wam-*` kernel (assembly/oscillators.ts, #1663) on the real
 * src/wasm/oscillators.wasm.
 *
 * Integration tier: needs `pnpm run build:wasm:oscillators` (or build:native).
 *
 *   1. It is SIMD, in the shipped bytes: the render loop holds f32x4 / f64x2
 *      instructions and stores one v128 per iteration. (A scalar kernel built with
 *      `--enable simd` is byte-identical to one built without it — that is how the
 *      kernel sat unvectorized for so long — so the flag alone proves nothing.)
 *   2. It stays inside the Safari 16.4 feature intersection: the module re-validates
 *      under exactly that feature set, and a relaxed-SIMD, GC, threads or tail-call
 *      instruction would fail it.
 *   3. It is the same oscillator: against a double-precision TypeScript port of the
 *      scalar kernel it replaced, every shape x filter type x entry point agrees to
 *      f32 rounding (the sine to its documented ~2e-7 polynomial error), including
 *      render lengths that are not a multiple of four, where the scalar tail runs.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const WASM = join(__dirname, '../../wasm/oscillators.wasm');
const BYTES = new Uint8Array(readFileSync(WASM));
const module = new WebAssembly.Module(BYTES);

const SHAPE = { saw: 0, sqr: 1, tri: 2, sin: 3 } as const;
type Shape = keyof typeof SHAPE;
const FILTER = { lp: 0, bp: 1, hp: 2 } as const;

interface Kernel {
    memory: WebAssembly.Memory;
    generate(o: number, sr: number, f: number, d: number, t: number, c: number, q: number, ft: number): number;
    generateLoop(o: number, sr: number, f: number, d: number, t: number, c: number, q: number, ft: number): number;
}

const fresh = (): Kernel =>
    new WebAssembly.Instance(module, { env: { abort: () => { throw new Error('abort'); } } })
        .exports as unknown as Kernel;

function render(
    fn: 'generate' | 'generateLoop',
    sr: number, freq: number, dur: number, shape: Shape, cutoff: number, q: number, ft: number,
): Float32Array {
    const k = fresh();
    const n = k[fn](0, sr, freq, dur, SHAPE[shape], cutoff, q, ft);
    return new Float32Array(k.memory.buffer.slice(0, n * 4));
}

// --- 1 & 2: the shipped bytes ---------------------------------------------------

interface Binaryen {
    Features: Record<string, number>;
    readBinary(bytes: Uint8Array): {
        setFeatures(f: number): void;
        validate(): number;
        emitText(): string;
        dispose(): void;
    };
}

/**
 * binaryen is assemblyscript's own dependency, not ours, so a strict (pnpm) layout
 * does not hoist it: it is the sibling of wherever assemblyscript really lives.
 */
async function loadBinaryen(): Promise<Binaryen> {
    const asDir = realpathSync(join(process.cwd(), 'node_modules', 'assemblyscript'));
    const entry = join(dirname(asDir), 'binaryen', 'index.js');
    return (await import(/* @vite-ignore */ pathToFileURL(entry).href)).default as Binaryen;
}

/**
 * The shipped binary has no names section, so a function is found by what it holds:
 * the render pass is the only one that stores a vector.
 */
function renderPassText(wat: string): string {
    const functions = wat.split('\n (func ').filter((f) => f.includes('v128.store'));
    expect(functions.length, 'exactly one function in the module stores a v128: the render pass').toBe(1);
    return functions[0];
}

describe('the render loop is real SIMD', () => {
    it('renderPass runs f32x4 shapes and an f64x2 filter in a loop that stores a v128 per iteration', async () => {
        const binaryen = await loadBinaryen();
        const m = binaryen.readBinary(BYTES);
        m.setFeatures(binaryen.Features.All);
        const wat = m.emitText();
        m.dispose();

        const pass = renderPassText(wat);
        // The SIMD body is the first loop; the scalar tail (0-3 frames) is the last.
        const loops = [...pass.matchAll(/\(loop /g)].map((x) => x.index!);
        expect(loops.length, 'a SIMD loop and a scalar tail loop').toBeGreaterThanOrEqual(2);
        const simdLoop = pass.slice(loops[0], loops[loops.length - 1]);

        for (const op of [
            'f64x2.floor',               // the phase, exact in f64
            'f32x4.demote_f64x2_zero',   // ... narrowed to signed distances
            'f32x4.mul',                 // the band-limited shapes
            'f64x2.promote_low_f32x4',   // the filter input, back to f64
            'f64x2.mul',                 // the four-samples-at-once biquad
            'f64x2.add',
            'v128.store',                // one store per four frames
        ]) {
            expect(simdLoop, `${op} inside the render loop`).toContain(op);
        }
        // ...and the scalar tail is the scalar kernel: no vector arithmetic in it.
        const tail = pass.slice(loops[loops.length - 1]);
        expect(tail).not.toMatch(/f32x4\.|f64x2\./);
    });

    it('uses no relaxed-SIMD instruction (the Safari intersection excludes them)', async () => {
        const binaryen = await loadBinaryen();
        const m = binaryen.readBinary(BYTES);
        m.setFeatures(binaryen.Features.All);
        const wat = m.emitText();
        m.dispose();
        expect(wat).not.toMatch(/relaxed/);
        expect(wat).not.toMatch(/\.fma\b|\.madd\b|\.nmadd\b/);
    });

    it('re-validates under the Safari 16.4 feature set, and the check is not vacuous', async () => {
        const binaryen = await loadBinaryen();
        const F = binaryen.Features;
        // What Safari 16.4 ships: MVP + mutable globals, sat. float->int, sign extension,
        // multivalue, bulk memory, reference types, fixed-width SIMD.
        const safari = F.MutableGlobals | F.NontrappingFPToInt | F.SignExt | F.Multivalue
            | F.BulkMemory | F.BulkMemoryOpt | F.ReferenceTypes | F.SIMD128;
        const validate = (features: number) => {
            const m = binaryen.readBinary(BYTES);
            m.setFeatures(features);
            const ok = m.validate();
            m.dispose();
            return ok;
        };
        const quiet = (fn: () => number) => {
            // binaryen prints each validator complaint; the negative control is expected to have some.
            const log = console.log, err = console.error;
            console.log = () => {}; console.error = () => {};
            try { return fn(); } finally { console.log = log; console.error = err; }
        };
        expect(validate(safari)).toBe(1);
        // Control: take SIMD away and the same module must stop validating.
        expect(quiet(() => validate(safari & ~F.SIMD128))).toBe(0);
    });

    it('instantiates with nothing but env.abort and its own non-shared memory', () => {
        expect(WebAssembly.Module.imports(module).map((i) => `${i.module}.${i.name}`)).toEqual(['env.abort']);
        expect(fresh().memory.buffer).toBeInstanceOf(ArrayBuffer);
    });
});

// --- 3: the same oscillator -----------------------------------------------------
//
// A double-precision port of the scalar kernel this one replaced (the loop body of
// `renderPass` as it stood before #1663): frame-index phase, PolyBLEP / PolyBLAMP,
// `Math.sin`, and the RBJ biquad in transposed direct form II with f64 state.

const TWO_PI = 6.283185307179586;
const fr = Math.fround;

function polyBlep(t: number, dt: number): number {
    if (t < dt) { const x = t / dt; return x + x - x * x - 1; }
    if (t > 1 - dt) { const x = (t - 1) / dt; return x * x + x + x + 1; }
    return 0;
}

function polyBlamp(t: number, dt: number): number {
    if (t < dt) { const x = t / dt - 1; return -(x * x * x) * (1 / 6); }
    if (t > 1 - dt) { const x = (t - 1) / dt + 1; return x * x * x * (1 / 6); }
    return 0;
}

function shapeSample(type: number, p: number, dt: number): number {
    if (type === 0) return 2 * p - 1 - polyBlep(p, dt);
    let q = p + 0.5;
    if (q >= 1) q -= 1;
    if (type === 1) return (p < 0.5 ? 1 : -1) + polyBlep(p, dt) - polyBlep(q, dt);
    if (type === 2) return 1 - 4 * Math.abs(p - 0.5) + 8 * dt * (polyBlamp(p, dt) - polyBlamp(q, dt));
    return Math.sin(TWO_PI * p);
}

/** `generate` / `generateLoop`, argument for argument (f32 arguments are rounded to f32, as the ABI does). */
function reference(
    loop: boolean, sr32: number, freq32: number, dur32: number, type: number, cutoff32: number, q32: number, ft: number,
): Float32Array {
    const sr = fr(sr32), freq = fr(freq32), dur = fr(dur32);
    const f = Math.max(1, Math.min(freq, sr * 0.49));

    const fc = Math.max(20, Math.min(fr(cutoff32), sr / 2.1));
    const q = Math.max(0.1, fr(q32));
    const w0 = (TWO_PI * fc) / sr;
    const cosW0 = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * q);
    const invA0 = 1 / (1 + alpha);
    let b0: number, b1: number, b2: number;
    if (ft === 1) { b0 = alpha * invA0; b1 = 0; b2 = -b0; }
    else if (ft === 2) { b0 = ((1 + cosW0) * 0.5) * invA0; b1 = -(1 + cosW0) * invA0; b2 = b0; }
    else { b0 = ((1 - cosW0) * 0.5) * invA0; b1 = (1 - cosW0) * invA0; b2 = b0; }
    const a1 = -2 * cosW0 * invA0;
    const a2 = (1 - alpha) * invA0;
    let z1 = 0, z2 = 0;

    let out = new Float32Array(0);
    const pass = (from: number, to: number, dt: number, write: boolean) => {
        if (write) out = new Float32Array(to - from);
        for (let i = from; i < to; i++) {
            let p = i * dt;
            p -= Math.floor(p);
            const x = shapeSample(type, p, dt);
            const y = b0 * x + z1;
            z1 = b1 * x - a1 * y + z2;
            z2 = b2 * x - a2 * y;
            if (write) out[i - from] = y;
        }
    };

    if (!loop) {
        const frames = Math.floor(sr * dur);
        pass(0, frames, f / sr, true);
        return out;
    }
    const framesPerCycle = sr / f;
    const cycles = Math.max(1, Math.round(dur * f));
    const frames = Math.max(1, Math.round(cycles * framesPerCycle));
    const dt = cycles / frames;
    const prime = Math.ceil(sr * 0.5);
    const tail = prime % frames;
    if (tail > 0) pass(frames - tail, frames, dt, false);
    for (let k = Math.floor(prime / frames); k > 0; k--) pass(0, frames, dt, false);
    pass(0, frames, dt, true);
    return out;
}

/**
 * What f32 can tell apart at the signal's own scale. Measured worst case against the
 * scalar kernel is one f32 ulp at the peak (4.8e-7 at a peak of 4.5); the 3e-7 floor is
 * the sine polynomial (~2e-7 absolute), which also reaches the output of a resonant
 * filter. A wrong edge, phase or coefficient is 1e-3 or more.
 */
const tolerance = (peak: number) => 3e-7 + 1.5e-7 * peak;

function compare(got: Float32Array, want: Float32Array, label: string): { worst: number; peak: number } {
    expect(got.length, `${label}: frame count`).toBe(want.length);
    let worst = 0, peak = 0;
    for (let i = 0; i < want.length; i++) {
        peak = Math.max(peak, Math.abs(want[i]));
        worst = Math.max(worst, Math.abs(got[i] - want[i]));
    }
    expect(worst, `${label}: worst |SIMD - scalar| (peak ${peak.toFixed(3)})`).toBeLessThanOrEqual(tolerance(peak));
    return { worst, peak };
}

describe('SIMD == the scalar kernel it replaced', () => {
    // [sample rate, Hz, seconds, cutoff, Q] — from a resonant bass to near-Nyquist and a 20 Hz lowpass at 96 kHz.
    const SETUPS: Array<[number, number, number, number, number]> = [
        [48000, 440, 0.2, 2000, 0.7071],
        [48000, 55, 0.5, 120, 12],
        [44100, 3951, 0.05, 9000, 4],
        [96000, 55, 0.3, 20, 0.5],
        [48000, 261.63, 0.37, 800, 8],
        [48000, 11000, 0.05, 20000, 1],
    ];

    for (const fn of ['generate', 'generateLoop'] as const) {
        it.each((Object.keys(SHAPE) as Shape[]).flatMap((s) => (Object.keys(FILTER) as Array<keyof typeof FILTER>).map((f) => [s, f] as const)))(
            `${fn}: %s through the %s filter, six pitch / cutoff / Q setups`,
            (shape, filter) => {
                for (const [sr, hz, dur, cutoff, q] of SETUPS) {
                    const got = render(fn, sr, hz, dur, shape, cutoff, q, FILTER[filter]);
                    const want = reference(fn === 'generateLoop', sr, hz, dur, SHAPE[shape], cutoff, q, FILTER[filter]);
                    compare(got, want, `${fn} ${shape}/${filter} ${hz} Hz @ ${sr}, fc ${cutoff}, Q ${q}`);
                }
            },
        );
    }

    it('every render length from 1 to 13 frames: the SIMD body, the scalar tail and the seam between them', () => {
        for (let n = 1; n <= 13; n++) {
            for (const shape of Object.keys(SHAPE) as Shape[]) {
                for (const ft of [0, 1, 2]) {
                    // (n + 0.5) / rate: floor(rate * dur) must be exactly n, not n - 1 by rounding.
                    const dur = (n + 0.5) / 48000;
                    const got = render('generate', 48000, 1234.5, dur, shape, 3000, 5, ft);
                    expect(got.length).toBe(n);
                    compare(got, reference(false, 48000, 1234.5, dur, SHAPE[shape], 3000, 5, ft), `${n} frames ${shape}/${ft}`);
                }
            }
        }
    });

    it('the extremes: 1 Hz, a pitch clamped at Nyquist, 8 kHz and 192 kHz, a 20 Hz lowpass at Q 40', () => {
        const EXTREME: Array<[number, number, number, number, number]> = [
            [8000, 1, 0.01, 1000, 1],
            [48000, 48000, 0.02, 20000, 0.7071],
            [8000, 440, 0.05, 1000, 2],
            [192000, 20, 0.02, 20, 40],
            [48000, 20000, 0.02, 20000, 8],
        ];
        for (const [sr, hz, dur, cutoff, q] of EXTREME) {
            for (const shape of Object.keys(SHAPE) as Shape[]) {
                for (const fn of ['generate', 'generateLoop'] as const) {
                    const got = render(fn, sr, hz, dur, shape, cutoff, q, FILTER.lp);
                    const want = reference(fn === 'generateLoop', sr, hz, dur, SHAPE[shape], cutoff, q, FILTER.lp);
                    for (const v of got) expect(Number.isFinite(v)).toBe(true);
                    compare(got, want, `${fn} ${shape} ${hz} Hz @ ${sr}, fc ${cutoff}, Q ${q}`);
                }
            }
        }
    });

    it('a note rendered in one call is the same sample for sample as the same note rendered twice (no state leaks between blocks)', () => {
        const k = fresh();
        const n = k.generate(0, 48000, 330, 0.3, SHAPE.tri, 2500, 6, FILTER.bp);
        const first = Array.from(new Float32Array(k.memory.buffer, 0, n));
        k.generate(0, 44100, 90, 0.1, SHAPE.saw, 200, 9, FILTER.hp);
        k.generate(0, 48000, 330, 0.3, SHAPE.tri, 2500, 6, FILTER.bp);
        expect(Array.from(new Float32Array(k.memory.buffer, 0, n))).toEqual(first);
    });

    it('output at an offset that is not 16-byte aligned is the same as at offset 0, and writes nothing outside the frames', () => {
        const k = fresh();
        const n = k.generate(0, 48000, 500, 0.01, SHAPE.sqr, 4000, 3, FILTER.lp);
        const aligned = Array.from(new Float32Array(k.memory.buffer, 0, n));
        const view = new Uint8Array(k.memory.buffer);
        for (const base of [4100, 4104, 4108, 4112]) {
            view.fill(0x5a, base - 32, base + 4 * n + 32);
            expect(k.generate(base, 48000, 500, 0.01, SHAPE.sqr, 4000, 3, FILTER.lp)).toBe(n);
            expect(Array.from(new Float32Array(k.memory.buffer.slice(base, base + 4 * n)))).toEqual(aligned);
            expect(Array.from(view.subarray(base - 32, base))).toEqual(new Array(32).fill(0x5a));
            expect(Array.from(view.subarray(base + 4 * n, base + 4 * n + 32))).toEqual(new Array(32).fill(0x5a));
        }
    });
});

describe('the SIMD sine', () => {
    it('tracks Math.sin to 3e-7 through every quadrant (the polynomial folds [0, 0.25] across all four)', () => {
        // 997 Hz is not a divisor of 48 kHz, so the 2400 frames land on many distinct phases.
        const got = render('generate', 48000, 997, 0.05, 'sin', 20000, 0.7071, FILTER.lp);
        const want = reference(false, 48000, 997, 0.05, SHAPE.sin, 20000, 0.7071, FILTER.lp);
        let worst = 0;
        for (let i = 0; i < want.length; i++) worst = Math.max(worst, Math.abs(got[i] - want[i]));
        expect(worst).toBeLessThan(3e-7);
        // Both extremes are reached, so both signs of the fold are in the comparison.
        expect(Math.max(...got)).toBeGreaterThan(0.9);
        expect(Math.min(...got)).toBeLessThan(-0.9);
    });
});
