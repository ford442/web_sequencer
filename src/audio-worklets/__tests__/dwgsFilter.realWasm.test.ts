/**
 * The "DWGS filter" (#1674) on the real public/dwgs_osc.wasm.
 *
 * Integration tier: needs `pnpm run build:wasm:dwgs`, plus `build:wasm:rust`,
 * `build:wasm:wamfilter` and `build:wasm:oscillators` for the cross-kernel checks
 * (or `build:native`); a missing binary fails the tier closed.
 *
 *   1. Module contract: the filter exports are in the module the dwgs-* oscillator
 *      runs from, with no imports and the same fixed, non-shared memory.
 *   2. Small-signal LP / BP / HP match the analytic 4-pole ladder (four
 *      trapezoidal one-poles in a resonance loop, tapped as the classic modes).
 *   3. It is a DISTINCT sound from the WASM OSC and Rust filters: 24 dB/oct
 *      slopes instead of 12, a different knee, and saturation that compresses
 *      loud input and bounds the resonance.
 *   4. It filters ANY oscillator: the DWGS and Rust oscillators, the AssemblyScript
 *      table and a plain wave; oscillator and filter in one instance stay apart.
 *   5. Block handling: chopping-independent, state persists, a sweep is smooth,
 *      bad arguments are refused, a silent tail decays to exact zero.
 *   6. dwgs-filter-processor, run block by block as the audio thread would.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkDwgsOscModule } from '../../../tools/check_dwgs_osc_module.mjs';
import { instantiateDwgsOsc, type DwgsOscExports } from '../dwgsOsc';
import {
    DWGS_FILTER_ABI_VERSION,
    DWGS_FILTER_PROCESSOR,
    DWGS_FILTER_REQUIRED_EXPORTS,
    DWGS_FILTER_TYPE_ID,
    instantiateDwgsFilter,
    type DwgsFilterExports,
    type DwgsFilterType,
} from '../dwgsFilter';
import { RUST_FILTER_TYPE_ID, type RustFilterExports } from '../rustFilter';
import { RUST_OSC_SHAPE_ID } from '../rustOsc';
import { WAM_FILTER_TYPE_ID, type WamFilterExports } from '../wamFilter';

const WASM = join(__dirname, '../../../public/dwgs_osc.wasm');
const RUST_WASM = join(__dirname, '../../../public/rust_osc.wasm');
const WAM_FILTER_WASM = join(__dirname, '../../wasm/wamFilter.wasm');
const OSC_WASM = join(__dirname, '../../wasm/oscillators.wasm');
const RATE = 48000;
const BLOCK = 128;
const FLAT_Q = Math.SQRT1_2;

const bytes = new Uint8Array(readFileSync(WASM));
const module = new WebAssembly.Module(bytes);

/** A fresh filter instance (no dwgs_init: a filter never evaluates the recipes). */
const instance = (): DwgsFilterExports => instantiateDwgsFilter(module);

const buffer = (x: DwgsFilterExports): Float32Array =>
    new Float32Array(x.memory.buffer, x.dflt_buf_ptr(), x.dwgs_max_frames());

/** Stream `signal` through the kernel in `sizes`-sized chunks (repeating). */
function run(x: DwgsFilterExports, signal: Float32Array, sizes: number[] = [BLOCK]): Float32Array {
    const buf = buffer(x);
    const result = new Float32Array(signal.length);
    for (let at = 0, b = 0; at < signal.length; b++) {
        const n = Math.min(sizes[b % sizes.length], signal.length - at);
        buf.set(signal.subarray(at, at + n));
        expect(x.dflt_process(n)).toBe(n);
        result.set(buf.subarray(0, n), at);
        at += n;
    }
    return result;
}

const sine = (f: number, frames: number, amp = 1): Float32Array =>
    Float32Array.from({ length: frames }, (_, i) => amp * Math.sin((2 * Math.PI * f * i) / RATE));

const lcgNoise = (seed: number, frames: number): Float32Array => {
    let s = seed;
    return Float32Array.from({ length: frames }, () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x40000000) - 1);
};

function configured(type: DwgsFilterType, cutoff: number, q: number): DwgsFilterExports {
    const x = instance();
    expect(x.dflt_configure(RATE, cutoff, q, DWGS_FILTER_TYPE_ID[type])).toBe(1);
    return x;
}

/** Gain of a sine of amplitude `amp`: RMS of the settled second half, times sqrt 2, over amp. */
function gainOfSettled(x: Float32Array, amp = 1): number {
    let sum = 0;
    const from = x.length >> 1;
    for (let i = from; i < x.length; i++) sum += x[i] * x[i];
    return Math.sqrt((2 * sum) / (x.length - from)) / amp;
}

const db = (g: number) => 20 * Math.log10(g);

/** Small-signal gain at `f` (amplitude 1e-3 keeps the saturator linear). */
const gainAt = (type: DwgsFilterType, fc: number, q: number, f: number): number =>
    gainOfSettled(run(configured(type, fc, q), sine(f, 16384, 1e-3)), 1e-3);

/** The kernel's resonance feedback for a Q (`vcf_feedback` in dwgs-audio/src/lib.rs). */
const feedback = (q: number) => (q <= FLAT_Q ? 0 : Math.min(4 * (1 - FLAT_Q / q), 3.96));

/** |H(e^jw)| of the linear ladder: bilinear one-poles prewarped at fc, feedback k, tapped by mode. */
function ladderMagnitude(type: DwgsFilterType, fc: number, q: number, f: number): number {
    type C = [number, number];
    const mul = (a: C, b: C): C => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
    const div = (a: C, b: C): C => {
        const d = b[0] * b[0] + b[1] * b[1];
        return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
    };
    const g = Math.tan((Math.PI * fc) / RATE);
    const h = div([1, 0], [1, Math.tan((Math.PI * f) / RATE) / g]);
    const om: C = [1 - h[0], -h[1]];
    const h2 = mul(h, h);
    const h4 = mul(h2, h2);
    const k = feedback(q);
    const num: C = type === 'lp' ? [h4[0] * (1 + k), h4[1] * (1 + k)]
        : type === 'bp' ? mul([4 * h2[0], 4 * h2[1]], mul(om, om))
            : mul(mul(om, om), mul(om, om));
    const r = div(num, [1 + k * h4[0], k * h4[1]]);
    return Math.hypot(r[0], r[1]);
}

/** |H(e^jw)| of the RBJ biquad every other kernel's filter runs. */
function rbjMagnitude(type: DwgsFilterType, fc: number, q: number, f: number): number {
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
    it('passes the release gate: the filter is part of the one dwgs_osc.wasm surface', () => {
        expect(checkDwgsOscModule(bytes)).toEqual([]);
    });

    it('imports nothing and exports the filter surface the worklet requires', () => {
        expect(WebAssembly.Module.imports(module)).toEqual([]);
        const names = new Set(WebAssembly.Module.exports(module).map((e) => e.name));
        for (const name of DWGS_FILTER_REQUIRED_EXPORTS) expect(names.has(name), name).toBe(true);
    });

    it('is ABI-compatible with the processor and keeps fixed, non-shared memory', () => {
        const x = instance();
        expect(x.dwgs_abi_version()).toBe(DWGS_FILTER_ABI_VERSION);
        expect(x.dwgs_max_frames()).toBe(1024);
        expect(x.memory.buffer).toBeInstanceOf(ArrayBuffer);
        expect(() => x.memory.grow(1)).toThrow();
    });

    it('keeps the filter buffer inside memory and apart from the oscillator buffers', () => {
        const x = instance() as DwgsFilterExports & DwgsOscExports;
        const n = x.dwgs_max_frames() * 4;
        const f = x.dflt_buf_ptr();
        expect(f + n).toBeLessThanOrEqual(x.memory.buffer.byteLength);
        for (const other of [x.dwgs_freq_ptr(), x.dwgs_out_ptr()]) {
            expect(f + n <= other || other + n <= f, `overlaps ${other}`).toBe(true);
        }
    });
});

describe('frequency response: the 4-pole ladder', () => {
    it.each([
        ['lp', 1000, FLAT_Q], ['lp', 500, 3], ['bp', 1000, FLAT_Q], ['bp', 2000, 4],
        ['hp', 1000, FLAT_Q], ['hp', 300, 2],
    ] as const)('%s at %d Hz, Q %d matches the analytic ladder', (type, fc, q) => {
        for (const f of [100, 250, 500, 1000, 2000, 4000, 8000]) {
            const want = ladderMagnitude(type, fc, q, f);
            if (want < 1e-3) continue; // -60 dB: the test sine's own leakage dominates
            expect(Math.abs(db(gainAt(type, fc, q, f)) - db(want)), `${f} Hz`).toBeLessThan(0.1);
        }
    });

    it('the lowpass keeps a 0 dB passband as the resonance rises, and peaks at its cutoff', () => {
        for (const q of [FLAT_Q, 2, 8]) {
            expect(Math.abs(db(gainAt('lp', 1000, q, 30)))).toBeLessThan(0.1);
            const k = feedback(q);
            expect(gainAt('lp', 1000, q, 1000)).toBeCloseTo(0.25 * (1 + k) / (1 - k / 4), 1);
        }
    });

    it('clamps the cutoff to [20 Hz, rate / 2.1] and never goes unstable', () => {
        for (const [fc, q] of [[1e9, 50], [-5, 0], [20, 1000]] as const) {
            const out = run(configured('lp', fc, q), lcgNoise(3, 8192));
            expect(out.every(Number.isFinite)).toBe(true);
            expect(Math.max(...out.map(Math.abs))).toBeLessThan(40);
        }
    });
});

describe('a different sound from the WASM OSC and Rust filters', () => {
    function rbjKernels(): Array<[string, (type: DwgsFilterType, fc: number, q: number, x: Float32Array) => Float32Array]> {
        const wam = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(readFileSync(WAM_FILTER_WASM))), {})
            .exports as unknown as WamFilterExports;
        const rustModule = new WebAssembly.Module(new Uint8Array(readFileSync(RUST_WASM)));
        return [
            ['wamFilter.wasm', (type, fc, q, x) => {
                expect(wam.configure(RATE, fc, q, WAM_FILTER_TYPE_ID[type])).toBe(1);
                wam.reset();
                const inp = new Float32Array(wam.memory.buffer, wam.inPtr(), wam.maxFrames());
                const buf = new Float32Array(wam.memory.buffer, wam.outPtr(), wam.maxFrames());
                const out = new Float32Array(x.length);
                for (let at = 0; at < x.length; at += BLOCK) {
                    inp.set(x.subarray(at, at + BLOCK));
                    wam.process(BLOCK);
                    out.set(buf.subarray(0, BLOCK), at);
                }
                return out;
            }],
            ['rust_osc.wasm', (type, fc, q, x) => {
                const r = new WebAssembly.Instance(rustModule, {}).exports as unknown as RustFilterExports;
                r.rosc_init(RATE);
                r.rflt_configure(RATE, fc, q, RUST_FILTER_TYPE_ID[type]);
                const out = new Float32Array(x.length);
                const buf = new Float32Array(r.memory.buffer, r.rflt_buf_ptr(), r.rosc_max_frames());
                for (let at = 0; at < x.length; at += BLOCK) {
                    buf.set(x.subarray(at, at + BLOCK));
                    r.rflt_process(BLOCK);
                    out.set(buf.subarray(0, BLOCK), at);
                }
                return out;
            }],
        ];
    }

    it.each(['lp', 'bp', 'hp'] as const)('%s: noise through the DWGS filter is NOT what the RBJ kernels give', (type) => {
        const noise = lcgNoise(11, 16384).map((v) => v * 0.1);
        const ours = run(configured(type, 1500, 2), noise);
        for (const [name, other] of rbjKernels()) {
            const theirs = other(type, 1500, 2, noise);
            let diff = 0;
            let ref = 0;
            for (let i = 4096; i < noise.length; i++) {
                diff += (ours[i] - theirs[i]) ** 2;
                ref += theirs[i] ** 2;
            }
            // Same knobs, audibly different output: > -10 dB difference energy.
            expect(diff / ref, name).toBeGreaterThan(0.1);
        }
    });

    it('slopes at 24 dB/oct, where the RBJ filters slope at 12', () => {
        const ours = db(gainAt('lp', 1000, FLAT_Q, 4000));
        const rbj = db(rbjMagnitude('lp', 1000, FLAT_Q, 4000));
        expect(ours).toBeLessThan(-45);
        expect(rbj).toBeGreaterThan(-26);
        const hp = db(gainAt('hp', 4000, FLAT_Q, 1000));
        expect(hp).toBeLessThan(rbjMagnitude('hp', 4000, FLAT_Q, 1000) / 100);
    });

    it('saturates: a loud input is compressed, a quiet one is not', () => {
        const quiet = gainOfSettled(run(configured('lp', 2000, FLAT_Q), sine(200, 16384, 1e-3)), 1e-3);
        const loud = gainOfSettled(run(configured('lp', 2000, FLAT_Q), sine(200, 16384, 3)), 3);
        expect(quiet).toBeCloseTo(ladderMagnitude('lp', 2000, FLAT_Q, 200), 3);
        expect(loud).toBeLessThan(quiet * 0.8);
        // ...and it adds harmonics where a linear filter could not (3rd of 200 Hz).
        const out = run(configured('lp', 8000, FLAT_Q), sine(200, 48000, 2));
        let re = 0;
        let im = 0;
        for (let i = 24000; i < 48000; i++) {
            re += out[i] * Math.cos((2 * Math.PI * 600 * i) / RATE);
            im += out[i] * Math.sin((2 * Math.PI * 600 * i) / RATE);
        }
        expect((2 * Math.hypot(re, im)) / 24000).toBeGreaterThan(0.01);
    });
});

describe('filters any oscillator', () => {
    /** Energy above `fromHz` as a fraction of the total (1024-point DFT). */
    function highEnergyFraction(x: Float32Array, fromHz: number): number {
        let high = 0;
        let total = 0;
        for (let k = 1; k < 512; k++) {
            let re = 0;
            let im = 0;
            for (let i = 0; i < 1024; i++) {
                const a = (2 * Math.PI * k * i) / 1024;
                re += x[i] * Math.cos(a);
                im -= x[i] * Math.sin(a);
            }
            const p = re * re + im * im;
            total += p;
            if ((k * RATE) / 1024 >= fromHz) high += p;
        }
        return high / total;
    }

    function dwgsSaw(hz: number, frames: number, osc: DwgsOscExports = instantiateDwgsOsc(module, RATE)): Float32Array {
        new Float32Array(osc.memory.buffer, osc.dwgs_freq_ptr(), 1)[0] = hz;
        const out = new Float32Array(osc.memory.buffer, osc.dwgs_out_ptr(), osc.dwgs_max_frames());
        const result = new Float32Array(frames);
        for (let at = 0; at < frames; at += BLOCK) {
            const n = Math.min(BLOCK, frames - at);
            osc.dwgs_render(0, n, 0);
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
        ['the DWGS oscillator (dwgs-saw)', () => dwgsSaw(440, 4096)],
        ['the Rust oscillator (rust-saw)', () => rustSaw(440, 4096)],
        ['the AssemblyScript oscillator (wam-saw table)', () => asSaw(4096)],
        ['a plain wave (the js oscillator)', () => naiveSaw(440, 4096)],
    ] as const)('a lowpass at 1 kHz darkens %s', (_name, source) => {
        const dry = source();
        const wet = run(configured('lp', 1000, FLAT_Q), dry);
        const tail = (x: Float32Array) => x.subarray(1024, 2048);
        expect(highEnergyFraction(tail(dry), 4000)).toBeGreaterThan(0.002);
        expect(highEnergyFraction(tail(wet), 4000)).toBeLessThan(highEnergyFraction(tail(dry), 4000) / 20);
    });

    it('the oscillator and the filter in ONE instance do not disturb each other', () => {
        const both = instantiateDwgsOsc(module, RATE) as DwgsOscExports & DwgsFilterExports;
        const alone = dwgsSaw(220, 2048);
        expect(both.dflt_configure(RATE, 800, 3, DWGS_FILTER_TYPE_ID.bp)).toBe(1);
        const buf = buffer(both);
        const osc = new Float32Array(2048);
        const filt = new Float32Array(2048);
        const noise = lcgNoise(5, 2048);
        new Float32Array(both.memory.buffer, both.dwgs_freq_ptr(), 1)[0] = 220;
        const out = new Float32Array(both.memory.buffer, both.dwgs_out_ptr(), both.dwgs_max_frames());
        for (let at = 0; at < 2048; at += BLOCK) {
            both.dwgs_render(0, BLOCK, 0);
            osc.set(out.subarray(0, BLOCK), at);
            buf.set(noise.subarray(at, at + BLOCK));
            both.dflt_process(BLOCK);
            filt.set(buf.subarray(0, BLOCK), at);
        }
        expect(Array.from(osc)).toEqual(Array.from(alone));
        expect(Array.from(filt)).toEqual(Array.from(run(configured('bp', 800, 3), noise)));
    });
});

describe('block handling', () => {
    const noise = lcgNoise(7, 8192);

    it('does not depend on how the stream is chopped into blocks (bit-exact)', () => {
        const ref = run(configured('lp', 900, 5), noise, [BLOCK]);
        expect(Array.from(run(configured('lp', 900, 5), noise, [1, 1023, 7, 300]))).toEqual(Array.from(ref));
    });

    it('keeps state between blocks, and dflt_reset() filters from rest again', () => {
        const x = configured('bp', 1200, 2);
        const first = run(x, noise.subarray(0, 512));
        x.dflt_reset();
        expect(Array.from(run(x, noise.subarray(0, 512)))).toEqual(Array.from(first));
    });

    it('a resonant sweep stays continuous on a smooth input', () => {
        const x = instance();
        const input = sine(110, 48000, 0.7);
        const buf = buffer(x);
        let prev = 0;
        let worst = 0;
        for (let at = 0, b = 0; at < input.length; at += BLOCK, b++) {
            expect(x.dflt_configure(RATE, 100 * 100 ** (b / 375), 3, DWGS_FILTER_TYPE_ID.lp)).toBe(1);
            buf.set(input.subarray(at, at + BLOCK));
            x.dflt_process(BLOCK);
            for (let i = 0; i < BLOCK; i++) {
                worst = Math.max(worst, Math.abs(buf[i] - prev));
                prev = buf[i];
            }
        }
        expect(worst).toBeLessThan(0.05);
    });

    it('refuses unusable configuration and keeps filtering with the previous response', () => {
        const x = configured('hp', 2000, 1);
        const refused: Array<[number, number, number, number]> = [
            [Number.NaN, 1000, 1, 0], [RATE, Number.NaN, 1, 0], [RATE, 1000, Infinity, 0], [RATE, 1000, 1, 3], [1000, 1000, 1, 0],
        ];
        for (const [rate, cutoff, q, type] of refused) expect(x.dflt_configure(rate, cutoff, q, type)).toBe(0);
        expect(Array.from(run(x, noise.subarray(0, 1024)))).toEqual(Array.from(run(configured('hp', 2000, 1), noise.subarray(0, 1024))));
    });

    it('dflt_process clamps a block longer than its buffer; an unconfigured filter is an identity', () => {
        const x = configured('lp', 1000, 1);
        expect(x.dflt_process(5000)).toBe(1024);
        const raw = instance();
        const buf = buffer(raw);
        buf.set([0.25, -0.5, 1, 0]);
        raw.dflt_process(4);
        expect(Array.from(buf.subarray(0, 4))).toEqual([0.25, -0.5, 1, 0]);
    });

    it('a silent tail decays to exactly zero: no denormals left ringing', () => {
        const x = configured('lp', 300, 20);
        run(x, noise.subarray(0, 1024));
        const tail = run(x, new Float32Array(48000 * 4));
        expect(tail.subarray(tail.length - BLOCK).every((v) => v === 0)).toBe(true);
    });
});

// ── the processor ────────────────────────────────────────────────────────────

class FakePort {
    posted: Array<{ type: string; reason?: string; maxFrames?: number }> = [];
    onmessage: ((e: { data: unknown }) => void) | null = null;
    postMessage(m: { type: string }) {
        this.posted.push(m);
    }
}
type Processor = {
    port: FakePort;
    process(i: Float32Array[][], o: Float32Array[][], p: Record<string, Float32Array>): boolean;
};
type ProcessorCtor = new (options: { processorOptions: { module: unknown } }) => Processor;
const g = globalThis as unknown as {
    sampleRate?: number;
    AudioWorkletProcessor?: unknown;
    registerProcessor?: (name: string, ctor: ProcessorCtor) => void;
};
let Ctor: ProcessorCtor;

describe('dwgs-filter-processor on the real kernel', () => {
    beforeAll(async () => {
        g.AudioWorkletProcessor = class {
            readonly port = new FakePort();
        };
        g.registerProcessor = (name, ctor) => {
            if (name === DWGS_FILTER_PROCESSOR) Ctor = ctor;
        };
        g.sampleRate = RATE;
        await import('../dwgs-filter-processor');
    });

    const params = (cutoff: number, resonance: number, type: DwgsFilterType) => ({
        cutoff: new Float32Array([cutoff]),
        resonance: new Float32Array([resonance]),
        type: new Float32Array([DWGS_FILTER_TYPE_ID[type]]),
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

    it('refuses a module that is not dwgs_osc.wasm (no dflt_* exports), silent, with the reason', () => {
        const other = new WebAssembly.Module(new Uint8Array(readFileSync(RUST_WASM)));
        const node = new Ctor({ processorOptions: { module: other } });
        expect(node.port.posted[0]?.type).toBe('error');
        expect(String(node.port.posted[0]?.reason)).toContain('dflt_');
        expect(stream(node, sine(440, 512), params(1000, 1, 'lp')).every((v) => v === 0)).toBe(true);
    });

    it.each(['lp', 'bp', 'hp'] as const)('%s: the worklet output is the kernel run alone, bit for bit', (type) => {
        const node = new Ctor({ processorOptions: { module } });
        const input = sine(1234, 4096);
        expect(Array.from(stream(node, input, params(1500, 4, type))))
            .toEqual(Array.from(run(configured(type, 1500, 4), input)));
    });

    it('outputs silence with no source connected, and filters from rest when one arrives', () => {
        const node = new Ctor({ processorOptions: { module } });
        const p = params(2000, 10, 'lp');
        stream(node, sine(900, 1024), p);
        const out = new Float32Array(BLOCK);
        node.process([[]], [[out]], p);
        expect(out.every((v) => v === 0)).toBe(true);
        expect(Array.from(stream(node, sine(900, 1024), p)))
            .toEqual(Array.from(run(configured('lp', 2000, 10), sine(900, 1024))));
    });

    it('stops (returns false) once disposed', () => {
        const node = new Ctor({ processorOptions: { module } });
        node.port.onmessage?.({ data: { type: 'dispose' } });
        expect(node.process([[new Float32Array(BLOCK)]], [[new Float32Array(BLOCK)]], params(1000, 1, 'lp'))).toBe(false);
    });
});
