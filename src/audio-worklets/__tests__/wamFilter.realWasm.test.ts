/**
 * The "WASM OSC filter" (#1663) on the real src/wasm/wamFilter.wasm.
 *
 * Integration tier: needs `pnpm run build:wasm:wamfilter` (or build:native);
 * requireRepoArtifacts fails the tier closed when the binary is missing.
 *
 *   1. Module contract: no imports (so a worklet can instantiate it with `{}`),
 *      exactly the export surface the processor requires, one fixed non-shared page.
 *   2. Low / band / high pass match the RBJ transfer functions.
 *   3. It is the SAME DSP as the filter baked into a `wam-*` table: a sine through
 *      this module equals the same sine rendered by oscillators.wasm.
 *   4. Block handling: the result does not depend on how the stream is chopped,
 *      state persists across blocks, `reset` returns to rest, bad arguments are
 *      refused without disturbing the running filter, and a silent tail decays to
 *      exactly zero (no denormals left ringing).
 *   5. wam-filter-processor, run block by block as the audio thread would.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    WAM_FILTER_ABI_VERSION,
    WAM_FILTER_PROCESSOR,
    WAM_FILTER_REQUIRED_EXPORTS,
    WAM_FILTER_TYPE_ID,
    hasWamFilterApi,
    type WamFilterExports,
    type WamFilterType,
} from '../wamFilter';

const WASM = join(__dirname, '../../wasm/wamFilter.wasm');
const OSC_WASM = join(__dirname, '../../wasm/oscillators.wasm');
const RATE = 48000;
const BLOCK = 128;

const module = new WebAssembly.Module(new Uint8Array(readFileSync(WASM)));

function instance(): WamFilterExports {
    const x = new WebAssembly.Instance(module, {}).exports as unknown as WamFilterExports;
    expect(hasWamFilterApi(x)).toBe(true);
    return x;
}

function views(x: WamFilterExports) {
    const max = x.maxFrames();
    return {
        inp: new Float32Array(x.memory.buffer, x.inPtr(), max),
        out: new Float32Array(x.memory.buffer, x.outPtr(), max),
    };
}

/** Stream `signal` through the kernel in `sizes`-sized chunks (repeating). */
function run(x: WamFilterExports, signal: Float32Array, sizes: number[] = [BLOCK]): Float32Array {
    const { inp, out } = views(x);
    const result = new Float32Array(signal.length);
    for (let at = 0, b = 0; at < signal.length; b++) {
        const n = Math.min(sizes[b % sizes.length], signal.length - at);
        inp.set(signal.subarray(at, at + n));
        expect(x.process(n)).toBe(n);
        result.set(out.subarray(0, n), at);
        at += n;
    }
    return result;
}

const sine = (f: number, frames: number): Float32Array =>
    Float32Array.from({ length: frames }, (_, i) => Math.sin((2 * Math.PI * f * i) / RATE));

function configured(type: WamFilterType, cutoff: number, q: number): WamFilterExports {
    const x = instance();
    expect(x.configure(RATE, cutoff, q, WAM_FILTER_TYPE_ID[type])).toBe(1);
    return x;
}

/**
 * Gain of a unit sine: RMS of the settled second half, times sqrt 2. (Not the sample
 * peak: at 6 kHz / 48 kHz a cycle is 8 samples, which may never land on the crest.)
 */
function gainOfSettled(x: Float32Array): number {
    let sum = 0;
    const from = x.length >> 1;
    for (let i = from; i < x.length; i++) sum += x[i] * x[i];
    return Math.sqrt((2 * sum) / (x.length - from));
}

/** |H(e^jw)| of the RBJ biquad (Audio EQ Cookbook). */
function rbjMagnitude(type: WamFilterType, fc: number, q: number, f: number): number {
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
    it('imports nothing, so a worklet instantiates it with an empty import object', () => {
        expect(WebAssembly.Module.imports(module)).toEqual([]);
    });

    it('exports exactly the surface the worklet requires, plus memory', () => {
        const names = WebAssembly.Module.exports(module).map((e) => e.name).sort();
        expect(names).toEqual([...WAM_FILTER_REQUIRED_EXPORTS, 'memory'].sort());
    });

    it('is ABI-compatible with the processor and owns one fixed, non-shared 64 KiB page', () => {
        const x = instance();
        expect(x.abiVersion()).toBe(WAM_FILTER_ABI_VERSION);
        expect(x.maxFrames()).toBe(1024);
        expect(x.memory.buffer).toBeInstanceOf(ArrayBuffer);
        expect(x.memory.buffer.byteLength).toBe(65536);
        // Fixed: growing must fail (maximum = initial), the worklet-wasm rule.
        expect(() => x.memory.grow(1)).toThrow();
        expect(x.memory.buffer.byteLength).toBe(65536);
    });

    it('keeps its I/O buffers inside the page and apart from each other', () => {
        const x = instance();
        const bytes = x.maxFrames() * 4;
        expect(x.inPtr() + bytes).toBeLessThanOrEqual(x.outPtr());
        expect(x.outPtr() + bytes).toBeLessThanOrEqual(x.memory.buffer.byteLength);
    });
});

describe('frequency response', () => {
    const CASES: Array<[WamFilterType, number, number]> = [
        ['lp', 1000, 0.7071],
        ['lp', 2500, 6],
        ['bp', 1000, 0.7071],
        ['bp', 600, 8],
        ['hp', 1000, 0.7071],
        ['hp', 4000, 4],
    ];

    it.each(CASES)('%s at %i Hz, Q %d matches the RBJ transfer function to 0.05 dB', (type, fc, q) => {
        for (const f of [80, 300, 1000, 2500, 6000, 12000]) {
            const x = configured(type, fc, q);
            const got = gainOfSettled(run(x, sine(f, 24000)));
            const want = rbjMagnitude(type, fc, q, f);
            expect(Math.abs(20 * Math.log10(got / want)), `${type} fc=${fc} q=${q} f=${f}`).toBeLessThan(0.05);
        }
    });

    it('clamps the cutoff to [20 Hz, rate / 2.1] like the baked filter, and never goes unstable', () => {
        for (const type of [0, 1, 2]) {
            for (const cutoff of [-5, 0, 1, 1e6]) {
                const x = instance();
                expect(x.configure(RATE, cutoff, 30, type)).toBe(1);
                const y = run(x, sine(440, 48000));
                for (const v of y) expect(Number.isFinite(v) && Math.abs(v) < 200).toBe(true);
            }
        }
    });
});

describe('same DSP as the filter baked into a wam-* table', () => {
    it.each([['lp', 0], ['bp', 1], ['hp', 2]] as const)('%s: a sine through here == oscillators.wasm rendering it', (name, id) => {
        const osc = new WebAssembly.Instance(
            new WebAssembly.Module(new Uint8Array(readFileSync(OSC_WASM))),
            { env: { abort: () => { throw new Error('abort'); } } },
        ).exports as unknown as {
            memory: WebAssembly.Memory;
            generate(o: number, sr: number, f: number, d: number, t: number, c: number, q: number, ft: number): number;
        };
        const FREQ = 523.25;
        const n = osc.generate(0, RATE, FREQ, 0.5, 3, 1500, 3, id);
        const baked = new Float32Array(osc.memory.buffer.slice(0, n * 4));

        const x = configured(name, 1500, 3);
        const streamed = run(x, sine(FREQ, n), [BLOCK, 64, 1000, 3]);

        let worst = 0;
        for (let i = 0; i < n; i++) worst = Math.max(worst, Math.abs(streamed[i] - baked[i]));
        // The inputs differ only by f32 quantisation of the sine (the baked path is f64).
        expect(worst).toBeLessThan(2e-5);
    });
});

describe('block handling', () => {
    const noise = (() => {
        let s = 12345;
        return Float32Array.from({ length: 5000 }, () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x40000000) - 1);
    })();

    it('does not depend on how the stream is chopped into blocks (bit-exact)', () => {
        const whole = run(configured('lp', 900, 5), noise, [1024]);
        for (const sizes of [[128], [1], [37, 211, 5], [1000, 24]]) {
            expect(Array.from(run(configured('lp', 900, 5), noise, sizes))).toEqual(Array.from(whole));
        }
    });

    it('keeps state between blocks, and reset() filters from rest again', () => {
        const x = configured('lp', 700, 8);
        const first = run(x, noise.subarray(0, 512));
        const second = run(x, noise.subarray(0, 512)); // same input, filter still ringing
        expect(Array.from(second)).not.toEqual(Array.from(first));
        x.reset();
        expect(Array.from(run(x, noise.subarray(0, 512)))).toEqual(Array.from(first));
    });

    it('a cutoff change keeps the state: no discontinuity where the coefficients switch', () => {
        // A settled DC level through a lowpass is the level itself. Switching to another
        // lowpass swaps the coefficients under the running state (a small transient is
        // expected); a state reset would instead drop the first frame to b0 * level.
        const x = configured('lp', 400, 2);
        const level = new Float32Array(8192).fill(0.8);
        const lead = run(x, level);
        expect(lead[lead.length - 1]).toBeCloseTo(0.8, 3);
        x.configure(RATE, 6000, 2, 0);
        const tail = run(x, level.subarray(0, 256));
        const b0 = 0.8 * (1 - Math.cos((2 * Math.PI * 6000) / RATE)) / 2; // ≈ what a reset would give
        expect(b0).toBeLessThan(0.15);
        expect(tail[0]).toBeGreaterThan(0.6);
        expect(tail[0]).toBeLessThan(1.1);
    });

    it('refuses unusable configuration and keeps filtering with the previous coefficients', () => {
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
            expect(x.configure(rate, cutoff, q, type), JSON.stringify([rate, cutoff, q, type])).toBe(0);
        }
        expect(Array.from(run(x, noise.subarray(0, 256)))).toEqual(before);
    });

    it('process() refuses a block longer than its buffers and writes nothing', () => {
        const x = configured('lp', 1000, 1);
        const { out } = views(x);
        out.fill(7);
        expect(x.process(1025)).toBe(0);
        expect(x.process(-1)).toBe(0);
        expect(out[0]).toBe(7);
        expect(x.process(0)).toBe(0);
    });

    it('stays inside its page: nothing outside the I/O buffers is written', () => {
        const x = configured('hp', 300, 12);
        const mem = new Uint8Array(x.memory.buffer);
        const lo = x.inPtr();
        const hi = x.outPtr() + x.maxFrames() * 4;
        const outside = (i: number) => i < lo || i >= hi;
        const snapshot = mem.slice();
        run(x, noise);
        for (let i = 0; i < mem.length; i++) {
            if (outside(i) && mem[i] !== snapshot[i]) throw new Error(`byte ${i} written outside the buffers`);
        }
    });

    it('a silent tail decays to exactly zero: no denormals left ringing', () => {
        const x = configured('lp', 100, 40); // long-ringing
        const burst = new Float32Array(BLOCK);
        burst[0] = 1;
        run(x, burst);
        let last = 1;
        for (let blocks = 0; blocks < 20000 && last !== 0; blocks++) {
            const tail = run(x, new Float32Array(BLOCK));
            last = tail[BLOCK - 1];
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

describe('wam-filter-processor on the real kernel', () => {
    beforeAll(async () => {
        g.AudioWorkletProcessor = class {
            readonly port = new FakePort();
        };
        g.registerProcessor = (name, ctor) => {
            if (name === WAM_FILTER_PROCESSOR) Ctor = ctor;
        };
        g.sampleRate = RATE;
        await import('../wam-filter-processor');
    });

    const params = (cutoff: number, resonance: number, type: WamFilterType) => ({
        cutoff: new Float32Array([cutoff]),
        resonance: new Float32Array([resonance]),
        type: new Float32Array([WAM_FILTER_TYPE_ID[type]]),
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
        const out = stream(node, sine(440, 512), params(1000, 1, 'lp'));
        expect(out.every((v) => v === 0)).toBe(true);
    });

    it.each(['lp', 'bp', 'hp'] as const)('%s: the worklet output is the kernel run alone, bit for bit', (type) => {
        const node = new Ctor({ processorOptions: { module } });
        const input = sine(1234, 4096);
        const got = stream(node, input, params(1500, 4, type));
        const want = run(configured(type, 1500, 4), input);
        expect(Array.from(got)).toEqual(Array.from(want));
    });

    it('applies a new cutoff / type at the next block, keeping state', () => {
        const node = new Ctor({ processorOptions: { module } });
        const input = sine(300, 1024);
        const first = stream(node, input.subarray(0, 512), params(500, 2, 'lp'));
        const second = stream(node, input.subarray(512), params(5000, 2, 'hp'));
        const ref = configured('lp', 500, 2);
        expect(Array.from(run(ref, input.subarray(0, 512)))).toEqual(Array.from(first));
        ref.configure(RATE, 5000, 2, WAM_FILTER_TYPE_ID.hp);
        expect(Array.from(run(ref, input.subarray(512)))).toEqual(Array.from(second));
    });

    it('treats an out-of-range type param as a lowpass, never a trap', () => {
        const node = new Ctor({ processorOptions: { module } });
        const p = { ...params(1000, 1, 'lp'), type: new Float32Array([7]) };
        const got = stream(node, sine(200, 512), p);
        expect(Array.from(got)).toEqual(Array.from(run(configured('lp', 1000, 1), sine(200, 512))));
    });

    it('outputs silence with no source connected, and filters from rest when one arrives', () => {
        const node = new Ctor({ processorOptions: { module } });
        const p = params(2000, 10, 'lp');
        const noisy = sine(900, 1024);
        stream(node, noisy, p); // leave the filter ringing
        const out = new Float32Array(BLOCK).fill(9);
        node.process([[]], [[out]], p); // source disconnected: the engine hands an empty input
        expect(out.every((v) => v === 9 || v === 0)).toBe(true);
        const again = stream(node, sine(900, 1024), p);
        const fresh = run(configured('lp', 2000, 10), sine(900, 1024));
        expect(Array.from(again)).toEqual(Array.from(fresh));
    });

    it('stops (returns false) once disposed', () => {
        const node = new Ctor({ processorOptions: { module } });
        node.port.onmessage?.({ data: { type: 'dispose' } });
        const out = new Float32Array(BLOCK);
        expect(node.process([[new Float32Array(BLOCK)]], [[out]], params(1000, 1, 'lp'))).toBe(false);
    });
});
