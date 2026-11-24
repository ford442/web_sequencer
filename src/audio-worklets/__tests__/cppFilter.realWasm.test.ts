/**
 * The "C++ filter" (#1673) on the real public/cpp_osc.wasm.
 *
 * Integration tier: needs `pnpm run build:wasm:cpp`, plus `build:wasm:wamfilter`,
 * `build:wasm:rust` and `build:wasm:oscillators` for the cross-kernel checks (or
 * `build:native`); a missing binary fails the tier closed.
 *
 *   1. Module contract: the filter exports are in the module the cpp-* oscillator
 *      runs from, with no imports and the same fixed, non-shared memory.
 *   2. Low / band / high pass match the RBJ transfer functions (the SVF is the
 *      bilinear transform of the same prototype, prewarped at the cutoff).
 *   3. It is the SAME response as the WASM OSC and Rust filters: noise through
 *      the kernels agrees to f32 rounding, so switching source keeps the sound.
 *   4. It filters ANY oscillator: the C++ and Rust oscillators, the AssemblyScript
 *      table and a plain wave; oscillator and filter in one instance stay apart.
 *   5. Block handling: chopping-independent, state persists, a cutoff sweep is
 *      smooth, bad arguments are refused, nothing outside its own data is written.
 *   6. cpp-filter-processor, run block by block as the audio thread would.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkCppOscModule } from '../../../tools/check_cpp_osc_module.mjs';
import { CPP_OSC_SHAPE_ID, instantiateCppOsc, type CppOscInstance } from '../cppOsc';
import {
    CPP_FILTER_ABI_VERSION,
    CPP_FILTER_PROCESSOR,
    CPP_FILTER_REQUIRED_EXPORTS,
    CPP_FILTER_TYPE_ID,
    instantiateCppFilter,
    type CppFilterType,
} from '../cppFilter';
import { RUST_FILTER_TYPE_ID, type RustFilterExports } from '../rustFilter';
import { RUST_OSC_SHAPE_ID } from '../rustOsc';
import { WAM_FILTER_TYPE_ID, type WamFilterExports } from '../wamFilter';

const WASM = join(__dirname, '../../../public/cpp_osc.wasm');
const RUST_WASM = join(__dirname, '../../../public/rust_osc.wasm');
const WAM_FILTER_WASM = join(__dirname, '../../wasm/wamFilter.wasm');
const OSC_WASM = join(__dirname, '../../wasm/oscillators.wasm');
const RATE = 48000;
const BLOCK = 128;

const bytes = new Uint8Array(readFileSync(WASM));
const module = new WebAssembly.Module(bytes);

/** A fresh filter instance (no cosc_init: a filter never builds the oscillator's tables). */
function instance(): CppOscInstance {
    return instantiateCppFilter(module) as CppOscInstance;
}

function buffer(x: CppOscInstance): Float32Array {
    return new Float32Array(x.memory.buffer, x.cflt_buf_ptr(), x.cosc_max_frames());
}

/** Stream `signal` through the kernel in `sizes`-sized chunks (repeating). */
function run(x: CppOscInstance, signal: Float32Array, sizes: number[] = [BLOCK]): Float32Array {
    const buf = buffer(x);
    const result = new Float32Array(signal.length);
    for (let at = 0, b = 0; at < signal.length; b++) {
        const n = Math.min(sizes[b % sizes.length], signal.length - at);
        buf.set(signal.subarray(at, at + n));
        expect(x.cflt_process(n)).toBe(n);
        result.set(buf.subarray(0, n), at);
        at += n;
    }
    return result;
}

const sine = (f: number, frames: number): Float32Array =>
    Float32Array.from({ length: frames }, (_, i) => Math.sin((2 * Math.PI * f * i) / RATE));

const lcgNoise = (seed: number, frames: number): Float32Array => {
    let s = seed;
    return Float32Array.from({ length: frames }, () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x40000000) - 1);
};

function configured(type: CppFilterType, cutoff: number, q: number): CppOscInstance {
    const x = instance();
    expect(x.cflt_configure(RATE, cutoff, q, CPP_FILTER_TYPE_ID[type])).toBe(1);
    return x;
}

/** Gain of a unit sine: RMS of the settled second half, times sqrt 2. */
function gainOfSettled(x: Float32Array): number {
    let sum = 0;
    const from = x.length >> 1;
    for (let i = from; i < x.length; i++) sum += x[i] * x[i];
    return Math.sqrt((2 * sum) / (x.length - from));
}

/** |H(e^jw)| of the RBJ biquad (Audio EQ Cookbook). */
function rbjMagnitude(type: CppFilterType, fc: number, q: number, f: number): number {
    const w0 = (2 * Math.PI * fc) / RATE;
    const alpha = Math.sin(w0) / (2 * q);
    const c = Math.cos(w0);
    const [b0, b1, b2] =
        type === 'lp' ? [(1 - c) / 2, 1 - c, (1 - c) / 2]
            : type === 'hp' ? [(1 + c) / 2, -(1 + c), (1 + c) / 2]
                : [alpha, 0, -alpha];
    const w = (2 * Math.PI * f) / RATE;
    const ev = (x0: number, x1: number, x2: number) =>
        Math.hypot(x0 + x1 * Math.cos(w) + x2 * Math.cos(2 * w), x1 * Math.sin(w) + x2 * Math.sin(2 * w));
    return ev(b0, b1, b2) / ev(1 + alpha, -2 * c, 1 - alpha);
}

describe('module contract', () => {
    it('passes the release gate: the filter is part of the one cpp_osc.wasm surface', () => {
        expect(checkCppOscModule(bytes)).toEqual([]);
    });

    it('imports nothing, so a worklet instantiates it with an empty import object', () => {
        expect(WebAssembly.Module.imports(module)).toEqual([]);
    });

    it('exports the filter surface the worklet requires', () => {
        const names = new Set(WebAssembly.Module.exports(module).map((e) => e.name));
        for (const name of CPP_FILTER_REQUIRED_EXPORTS) expect(names.has(name), name).toBe(true);
    });

    it('is ABI-compatible with the processor and keeps fixed, non-shared memory', () => {
        const x = instance();
        expect(x.cosc_abi_version()).toBe(CPP_FILTER_ABI_VERSION);
        expect(x.cosc_max_frames()).toBe(1024);
        expect(x.memory.buffer).toBeInstanceOf(ArrayBuffer);
        const size = x.memory.buffer.byteLength;
        expect(() => x.memory.grow(1)).toThrow();
        expect(x.memory.buffer.byteLength).toBe(size);
    });

    it('keeps the filter buffer inside memory and apart from the oscillator buffers', () => {
        const x = instance();
        const n = x.cosc_max_frames() * 4;
        const f = x.cflt_buf_ptr();
        expect(f + n).toBeLessThanOrEqual(x.memory.buffer.byteLength);
        for (const other of [x.cosc_freq_ptr(), x.cosc_out_ptr()]) {
            expect(f + n <= other || other + n <= f, `overlaps ${other}`).toBe(true);
        }
    });
});

describe('frequency response', () => {
    const CASES: Array<[CppFilterType, number, number]> = [
        ['lp', 1000, 0.7071],
        ['lp', 2500, 6],
        ['bp', 1000, 0.7071],
        ['bp', 600, 8],
        ['hp', 1000, 0.7071],
        ['hp', 4000, 4],
    ];

    it.each(CASES)('%s at %i Hz, Q %d matches the RBJ transfer function to 0.05 dB', (type, fc, q) => {
        for (const f of [80, 300, 1000, 2500, 6000, 12000]) {
            const got = gainOfSettled(run(configured(type, fc, q), sine(f, 24000)));
            const want = rbjMagnitude(type, fc, q, f);
            expect(Math.abs(20 * Math.log10(got / want)), `${type} fc=${fc} q=${q} f=${f}`).toBeLessThan(0.05);
        }
    });

    it('a 20 Hz lowpass sits at its own cutoff (f32 state would drift here)', () => {
        const got = gainOfSettled(run(configured('lp', 20, 0.7071), sine(20, RATE * 3)));
        expect(got).toBeCloseTo(Math.SQRT1_2, 2);
    });

    it('resonance: the lowpass peaks at Q at its cutoff, the bandpass at 0 dB whatever the Q', () => {
        expect(gainOfSettled(run(configured('lp', 1000, 8), sine(1000, 48000)))).toBeCloseTo(8, 0);
        for (const q of [0.5, 2, 10]) {
            expect(gainOfSettled(run(configured('bp', 2000, q), sine(2000, 48000))), `Q ${q}`).toBeCloseTo(1, 2);
        }
    });

    it('clamps the cutoff to [20 Hz, rate / 2.1] like the other kernels, and never goes unstable', () => {
        for (const type of [0, 1, 2]) {
            for (const cutoff of [-5, 0, 1, 1e6]) {
                const x = instance();
                expect(x.cflt_configure(RATE, cutoff, 30, type)).toBe(1);
                for (const v of run(x, sine(440, 48000))) expect(Number.isFinite(v) && Math.abs(v) < 200).toBe(true);
            }
        }
        // The clamp lands on the response of the clamp value itself (to the f32 rounding
        // of rate / 2.1 as an argument: the kernel clamps in f64).
        const noise = lcgNoise(7, 4096);
        const near = (a: Float32Array, b: Float32Array) => a.every((v, i) => Math.abs(v - b[i]) < 1e-4);
        expect(near(run(configured('lp', 1e6, 2), noise), run(configured('lp', RATE / 2.1, 2), noise))).toBe(true);
        expect(Array.from(run(configured('hp', 1, 2), noise))).toEqual(Array.from(run(configured('hp', 20, 2), noise)));
    });
});

describe('same response as the WASM OSC and Rust filters', () => {
    const wamModule = new WebAssembly.Module(new Uint8Array(readFileSync(WAM_FILTER_WASM)));
    const rustModule = new WebAssembly.Module(new Uint8Array(readFileSync(RUST_WASM)));

    function wamRun(type: CppFilterType, cutoff: number, q: number, signal: Float32Array): Float32Array {
        const w = new WebAssembly.Instance(wamModule, {}).exports as unknown as WamFilterExports;
        expect(w.configure(RATE, cutoff, q, WAM_FILTER_TYPE_ID[type])).toBe(1);
        const inp = new Float32Array(w.memory.buffer, w.inPtr(), w.maxFrames());
        const out = new Float32Array(w.memory.buffer, w.outPtr(), w.maxFrames());
        const result = new Float32Array(signal.length);
        for (let at = 0; at < signal.length; at += BLOCK) {
            const n = Math.min(BLOCK, signal.length - at);
            inp.set(signal.subarray(at, at + n));
            w.process(n);
            result.set(out.subarray(0, n), at);
        }
        return result;
    }

    function rustRun(type: CppFilterType, cutoff: number, q: number, signal: Float32Array): Float32Array {
        const r = new WebAssembly.Instance(rustModule, {}).exports as unknown as RustFilterExports;
        expect(r.rosc_init(RATE)).toBe(1);
        expect(r.rflt_configure(RATE, cutoff, q, RUST_FILTER_TYPE_ID[type])).toBe(1);
        const buf = new Float32Array(r.memory.buffer, r.rflt_buf_ptr(), r.rosc_max_frames());
        const result = new Float32Array(signal.length);
        for (let at = 0; at < signal.length; at += BLOCK) {
            const n = Math.min(BLOCK, signal.length - at);
            buf.set(signal.subarray(at, at + n));
            r.rflt_process(n);
            result.set(buf.subarray(0, n), at);
        }
        return result;
    }

    const noise = lcgNoise(4242, 24000);

    it.each([
        ['lp', 20, 0.7071], ['lp', 1500, 3], ['lp', 9000, 12],
        ['bp', 300, 5], ['bp', 3000, 0.7071],
        ['hp', 80, 1], ['hp', 6000, 4],
    ] as const)('%s at %i Hz, Q %d: noise through the C++, WASM OSC and Rust kernels agrees to f32 rounding', (type, fc, q) => {
        const cpp = run(configured(type, fc, q), noise);
        for (const [name, other] of [['wam', wamRun(type, fc, q, noise)], ['rust', rustRun(type, fc, q, noise)]] as const) {
            let worst = 0;
            let peak = 0;
            for (let i = 0; i < noise.length; i++) {
                worst = Math.max(worst, Math.abs(cpp[i] - other[i]));
                peak = Math.max(peak, Math.abs(other[i]));
            }
            // Different topologies (SVF vs direct-form biquad), same transfer function in
            // f64: what is left is rounding, relative to the signal's own size.
            expect(worst / Math.max(peak, 1e-6), `${name} ${type} fc=${fc} q=${q}`).toBeLessThan(2e-5);
        }
    });
});

describe('filters any oscillator', () => {
    /** Energy above `fromHz` as a fraction of the total (a DFT at the 1024-point bins). */
    function highEnergyFraction(x: Float32Array, fromHz: number): number {
        let high = 0;
        let total = 0;
        for (let k = 1; k < 512; k++) {
            const hz = (k * RATE) / 1024;
            let re = 0;
            let im = 0;
            for (let i = 0; i < 1024; i++) {
                const a = (2 * Math.PI * k * i) / 1024;
                re += x[i] * Math.cos(a);
                im -= x[i] * Math.sin(a);
            }
            const p = re * re + im * im;
            total += p;
            if (hz >= fromHz) high += p;
        }
        return high / total;
    }

    function cppSaw(hz: number, frames: number, osc: CppOscInstance = instantiateCppOsc(module, RATE)): Float32Array {
        new Float32Array(osc.memory.buffer, osc.cosc_freq_ptr(), 1)[0] = hz;
        const out = new Float32Array(osc.memory.buffer, osc.cosc_out_ptr(), osc.cosc_max_frames());
        const result = new Float32Array(frames);
        for (let at = 0; at < frames; at += BLOCK) {
            const n = Math.min(BLOCK, frames - at);
            osc.cosc_render(CPP_OSC_SHAPE_ID.saw, n, 0);
            result.set(out.subarray(0, n), at);
        }
        return result;
    }

    function rustSaw(hz: number, frames: number): Float32Array {
        const o = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(readFileSync(RUST_WASM))), {})
            .exports as unknown as RustFilterExports & {
                rosc_freq_ptr(): number; rosc_out_ptr(): number; rosc_render(s: number, n: number, p: number): number;
            };
        o.rosc_init(RATE);
        new Float32Array(o.memory.buffer, o.rosc_freq_ptr(), 1)[0] = hz;
        const out = new Float32Array(o.memory.buffer, o.rosc_out_ptr(), o.rosc_max_frames());
        const result = new Float32Array(frames);
        for (let at = 0; at < frames; at += BLOCK) {
            const n = Math.min(BLOCK, frames - at);
            o.rosc_render(RUST_OSC_SHAPE_ID.saw, n, 0);
            result.set(out.subarray(0, n), at);
        }
        return result;
    }

    function asSaw(frames: number): Float32Array {
        const osc = new WebAssembly.Instance(
            new WebAssembly.Module(new Uint8Array(readFileSync(OSC_WASM))),
            { env: { abort: () => { throw new Error('abort'); } } },
        ).exports as unknown as {
            memory: WebAssembly.Memory;
            generate(o: number, sr: number, f: number, d: number, t: number, c: number, q: number, ft: number): number;
        };
        const n = osc.generate(0, RATE, 440, 1, 0, RATE / 2.1, Math.SQRT1_2, 0);
        return new Float32Array(osc.memory.buffer.slice(0, Math.min(frames, n) * 4));
    }

    const naiveSaw = (hz: number, frames: number): Float32Array =>
        Float32Array.from({ length: frames }, (_, i) => 2 * ((hz * i / RATE) % 1) - 1);

    it.each([
        ['the C++ oscillator (cpp-saw)', () => cppSaw(440, 4096)],
        ['the Rust oscillator (rust-saw)', () => rustSaw(440, 4096)],
        ['the AssemblyScript oscillator (wam-saw table)', () => asSaw(4096)],
        ['a plain wave (the js oscillator)', () => naiveSaw(440, 4096)],
    ] as const)('a lowpass at 1 kHz darkens %s', (_name, source) => {
        const dry = source();
        const wet = run(configured('lp', 1000, 0.7071), dry);
        const tail = (x: Float32Array) => x.subarray(1024, 2048);
        expect(highEnergyFraction(tail(dry), 4000)).toBeGreaterThan(0.002);
        expect(highEnergyFraction(tail(wet), 4000)).toBeLessThan(highEnergyFraction(tail(dry), 4000) / 20);
    });

    it('a highpass at 4 kHz removes the body of the C++ oscillator, leaving its edges', () => {
        const dry = cppSaw(220, 4096);
        const wet = run(configured('hp', 4000, 0.7071), dry);
        const energy = (x: Float32Array) => x.subarray(1024).reduce((s, v) => s + v * v, 0);
        expect(energy(wet)).toBeLessThan(energy(dry) * 0.05);
    });

    it('the oscillator and the filter in ONE instance do not disturb each other', () => {
        const both = instantiateCppOsc(module, RATE);
        expect(both.cflt_configure(RATE, 1200, 3, 0)).toBe(1);
        new Float32Array(both.memory.buffer, both.cosc_freq_ptr(), 1)[0] = 330;
        const out = new Float32Array(both.memory.buffer, both.cosc_out_ptr(), 1024);
        const fbuf = buffer(both);
        const input = sine(700, 2048);
        const osc: number[] = [];
        const filt: number[] = [];
        for (let at = 0; at < 2048; at += BLOCK) {
            both.cosc_render(CPP_OSC_SHAPE_ID.saw, BLOCK, 0);
            osc.push(...out.subarray(0, BLOCK));
            fbuf.set(input.subarray(at, at + BLOCK));
            both.cflt_process(BLOCK);
            filt.push(...fbuf.subarray(0, BLOCK));
        }
        expect(filt).toEqual(Array.from(run(configured('lp', 1200, 3), input)));
        expect(osc).toEqual(Array.from(cppSaw(330, 2048)));
    });
});

describe('block handling', () => {
    const noise = lcgNoise(12345, 5000);

    it('does not depend on how the stream is chopped into blocks (bit-exact)', () => {
        const whole = run(configured('lp', 900, 5), noise, [1024]);
        for (const sizes of [[128], [1], [37, 211, 5], [1000, 24]]) {
            expect(Array.from(run(configured('lp', 900, 5), noise, sizes))).toEqual(Array.from(whole));
        }
    });

    it('keeps state between blocks, and cflt_reset() filters from rest again', () => {
        const x = configured('lp', 700, 8);
        const first = run(x, noise.subarray(0, 512));
        const second = run(x, noise.subarray(0, 512));
        expect(Array.from(second)).not.toEqual(Array.from(first));
        x.cflt_reset();
        expect(Array.from(run(x, noise.subarray(0, 512)))).toEqual(Array.from(first));
    });

    it('a cutoff jump keeps the state: the output moves on without a step', () => {
        const x = configured('lp', 400, 2);
        const level = new Float32Array(8192).fill(0.8);
        expect(run(x, level).at(-1)).toBeCloseTo(0.8, 3);
        x.cflt_configure(RATE, 6000, 2, 0);
        const tail = run(x, level.subarray(0, 256));
        // The integrators hold the settled DC level, so a steady input stays where it was.
        expect(tail[0]).toBeCloseTo(0.8, 3);
        expect(Math.max(...tail.map((v) => Math.abs(v - 0.8)))).toBeLessThan(1e-3);
    });

    it('a fast sweep of a resonant lowpass stays bounded (no direct-form coefficient blow-up)', () => {
        const x = configured('lp', 200, 20);
        const saw = Float32Array.from({ length: 48000 }, (_, i) => 2 * ((110 * i / RATE) % 1) - 1);
        const buf = buffer(x);
        let peak = 0;
        for (let at = 0, b = 0; at < saw.length; at += BLOCK, b++) {
            // Up and down three decades every 32 blocks.
            const phase = (b % 32) / 32;
            const fc = 200 * 1000 ** (phase < 0.5 ? 2 * phase : 2 - 2 * phase);
            expect(x.cflt_configure(RATE, fc, 20, 0)).toBe(1);
            buf.set(saw.subarray(at, at + BLOCK));
            x.cflt_process(BLOCK);
            for (let k = 0; k < BLOCK; k++) peak = Math.max(peak, Math.abs(buf[k]));
        }
        expect(Number.isFinite(peak)).toBe(true);
        expect(peak).toBeLessThan(40); // a Q 20 peak on a unit saw, not an explosion
    });

    it('refuses unusable configuration and keeps filtering with the previous response', () => {
        const x = configured('lp', 1000, 0.7071);
        const before = Array.from(run(configured('lp', 1000, 0.7071), noise.subarray(0, 256)));
        const refused: Array<[number, number, number, number]> = [
            [RATE, NaN, 1, 0],
            [RATE, 1000, NaN, 0],
            [RATE, Infinity, 1, 0],
            [0, 1000, 1, 0],
            [NaN, 1000, 1, 0],
            [-48000, 1000, 1, 0],
            [RATE, 1000, 1, 3],
            [RATE, 1000, 1, -1],
        ];
        for (const [rate, cutoff, q, type] of refused) {
            expect(x.cflt_configure(rate, cutoff, q, type), JSON.stringify([rate, cutoff, q, type])).toBe(0);
        }
        expect(Array.from(run(x, noise.subarray(0, 256)))).toEqual(before);
    });

    it('cflt_process clamps a block longer than its buffer, and a negative count to zero', () => {
        const x = configured('lp', 1000, 1);
        expect(x.cflt_process(1025)).toBe(1024);
        expect(x.cflt_process(0)).toBe(0);
        expect(x.cflt_process(-3)).toBe(0);
    });

    it('an unconfigured filter is an identity (the worklet never runs one, but it must not be garbage)', () => {
        const x = instance();
        const input = noise.subarray(0, 300);
        expect(Array.from(run(x, input))).toEqual(Array.from(input));
    });

    it('writes only its buffer and one small state block: never the oscillator buffers or the residual tables', () => {
        const x = configured('hp', 300, 12);
        const mem = new Uint8Array(x.memory.buffer);
        const lo = x.cflt_buf_ptr();
        const hi = lo + x.cosc_max_frames() * 4;
        const snapshot = mem.slice();
        run(x, noise);
        const changed: number[] = [];
        for (let i = 0; i < mem.length; i++) {
            if ((i < lo || i >= hi) && mem[i] !== snapshot[i]) changed.push(i);
        }
        // The Svf's two f64 integrator states (the coefficients do not change while filtering).
        expect(changed.length).toBeGreaterThan(0);
        expect(changed[changed.length - 1] - changed[0]).toBeLessThan(64);
        const n = x.cosc_max_frames() * 4;
        for (const other of [x.cosc_freq_ptr(), x.cosc_out_ptr()]) {
            expect(changed.some((i) => i >= other && i < other + n), `wrote into ${other}`).toBe(false);
        }
    });

    it('a silent tail decays to exactly zero: no denormals left ringing', () => {
        const x = configured('lp', 100, 40);
        const burst = new Float32Array(BLOCK);
        burst[0] = 1;
        run(x, burst);
        let last = 1;
        for (let blocks = 0; blocks < 20000 && last !== 0; blocks++) {
            last = run(x, new Float32Array(BLOCK))[BLOCK - 1];
        }
        expect(last).toBe(0);
    });
});

/* ---- the processor, driven the way the audio thread drives it ---- */

class FakePort {
    posted: Array<{ type: string; [k: string]: unknown }> = [];
    onmessage: ((e: { data: unknown }) => void) | null = null;
    postMessage(m: { type: string }) {
        this.posted.push(m);
    }
}
type Processor = {
    port: FakePort;
    process: (
        inputs: Float32Array[][],
        outputs: Float32Array[][],
        parameters: Record<string, Float32Array>,
    ) => boolean;
};
type ProcessorCtor = new (options: { processorOptions: { module: unknown } }) => Processor;
const g = globalThis as unknown as {
    sampleRate?: number;
    AudioWorkletProcessor?: unknown;
    registerProcessor?: (name: string, ctor: ProcessorCtor) => void;
};
let Ctor: ProcessorCtor;

describe('cpp-filter-processor on the real kernel', () => {
    beforeAll(async () => {
        g.AudioWorkletProcessor = class {
            readonly port = new FakePort();
        };
        g.registerProcessor = (name, ctor) => {
            if (name === CPP_FILTER_PROCESSOR) Ctor = ctor;
        };
        g.sampleRate = RATE;
        await import('../cpp-filter-processor');
    });

    const params = (cutoff: number, resonance: number, type: CppFilterType) => ({
        cutoff: new Float32Array([cutoff]),
        resonance: new Float32Array([resonance]),
        type: new Float32Array([CPP_FILTER_TYPE_ID[type]]),
    });

    function stream(node: Processor, input: Float32Array, p: Record<string, Float32Array>): Float32Array {
        const result = new Float32Array(input.length);
        for (let at = 0; at < input.length; at += BLOCK) {
            const out = new Float32Array(BLOCK);
            expect(node.process([[input.subarray(at, at + BLOCK)]], [[out]], p)).toBe(true);
            result.set(out, at);
        }
        return result;
    }

    it('instantiates synchronously from processorOptions and reports ready', () => {
        const node = new Ctor({ processorOptions: { module } });
        expect(node.port.posted).toEqual([{ type: 'ready', maxFrames: 1024 }]);
    });

    it('reports an error (and stays silent) for a missing module, never passing audio through', () => {
        const node = new Ctor({ processorOptions: { module: undefined } });
        expect(node.port.posted[0]?.type).toBe('error');
        expect(stream(node, sine(440, 512), params(1000, 1, 'lp')).every((v) => v === 0)).toBe(true);
    });

    it('refuses a module that is not cpp_osc.wasm (no cflt_* exports), silent, with the reason', () => {
        // rust_osc.wasm is another engine's filter: it must not be run as the C++ one.
        const other = new WebAssembly.Module(new Uint8Array(readFileSync(RUST_WASM)));
        const node = new Ctor({ processorOptions: { module: other } });
        expect(node.port.posted[0]?.type).toBe('error');
        expect(String(node.port.posted[0]?.reason)).toContain('cflt_');
        expect(stream(node, sine(440, 512), params(1000, 1, 'lp')).every((v) => v === 0)).toBe(true);
    });

    it.each(['lp', 'bp', 'hp'] as const)('%s: the worklet output is the kernel run alone, bit for bit', (type) => {
        const node = new Ctor({ processorOptions: { module } });
        const input = sine(1234, 4096);
        const got = stream(node, input, params(1500, 4, type));
        expect(Array.from(got)).toEqual(Array.from(run(configured(type, 1500, 4), input)));
    });

    it('applies a new cutoff / type at the next block, keeping state', () => {
        const node = new Ctor({ processorOptions: { module } });
        const input = sine(300, 1024);
        const first = stream(node, input.subarray(0, 512), params(500, 2, 'lp'));
        const second = stream(node, input.subarray(512), params(5000, 2, 'hp'));
        const ref = configured('lp', 500, 2);
        expect(Array.from(run(ref, input.subarray(0, 512)))).toEqual(Array.from(first));
        ref.cflt_configure(RATE, 5000, 2, CPP_FILTER_TYPE_ID.hp);
        expect(Array.from(run(ref, input.subarray(512)))).toEqual(Array.from(second));
    });

    it('treats an out-of-range type param as a lowpass, never a trap', () => {
        const node = new Ctor({ processorOptions: { module } });
        const p = { ...params(1000, 1, 'lp'), type: new Float32Array([7]) };
        expect(Array.from(stream(node, sine(200, 512), p)))
            .toEqual(Array.from(run(configured('lp', 1000, 1), sine(200, 512))));
    });

    it('outputs silence with no source connected, and filters from rest when one arrives', () => {
        const node = new Ctor({ processorOptions: { module } });
        const p = params(2000, 10, 'lp');
        stream(node, sine(900, 1024), p);
        const out = new Float32Array(BLOCK).fill(9);
        node.process([[]], [[out]], p);
        expect(out.every((v) => v === 9 || v === 0)).toBe(true);
        const again = stream(node, sine(900, 1024), p);
        expect(Array.from(again)).toEqual(Array.from(run(configured('lp', 2000, 10), sine(900, 1024))));
    });

    it('stops (returns false) once disposed', () => {
        const node = new Ctor({ processorOptions: { module } });
        node.port.onmessage?.({ data: { type: 'dispose' } });
        expect(node.process([[new Float32Array(BLOCK)]], [[new Float32Array(BLOCK)]], params(1000, 1, 'lp'))).toBe(false);
    });
});
