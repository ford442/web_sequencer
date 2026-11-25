/**
 * The "Rust filter" (#1672) on the real public/rust_osc.wasm.
 *
 * Integration tier: needs `pnpm run build:wasm:rust` (and `build:wasm:wamfilter`
 * for the cross-kernel parity check), or `build:native`; requireRepoArtifacts
 * fails the tier closed when a binary is missing.
 *
 *   1. Module contract: the filter exports are in the module the oscillator
 *      runs from, with no new imports and the same fixed, non-shared memory.
 *   2. Low / band / high pass match the RBJ transfer functions.
 *   3. It is the SAME response as the WASM OSC filter (wamFilter.wasm): a signal
 *      through both kernels agrees to f32 rounding, so switching source does
 *      not change the sound.
 *   4. It filters ANY oscillator: the Rust oscillator, the AssemblyScript
 *      oscillator's table and a plain wave all come out filtered, and the
 *      oscillator and the filter do not disturb each other in one module.
 *   5. Block handling: independent of how the stream is chopped, state persists,
 *      `reset` returns to rest, bad arguments are refused without disturbing the
 *      running filter, nothing outside the buffer is written.
 *   6. rust-filter-processor, run block by block as the audio thread would.
 *   7. SIMD (#1663): `rflt_process` is the four-at-once f64x2 path — it is in the
 *      shipped bytes, and it matches the scalar reference `rflt_process_scalar`
 *      bit for bit for every response, length and chunking.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkRustOscModule } from '../../../tools/check_rust_osc_module.mjs';
import { RUST_OSC_SHAPE_ID } from '../rustOsc';
import {
    RUST_FILTER_ABI_VERSION,
    RUST_FILTER_PROCESSOR,
    RUST_FILTER_REQUIRED_EXPORTS,
    RUST_FILTER_TYPE_ID,
    hasRustFilterApi,
    type RustFilterExports,
    type RustFilterType,
} from '../rustFilter';
import { WAM_FILTER_TYPE_ID, type WamFilterExports } from '../wamFilter';

const WASM = join(__dirname, '../../../public/rust_osc.wasm');
const WAM_FILTER_WASM = join(__dirname, '../../wasm/wamFilter.wasm');
const OSC_WASM = join(__dirname, '../../wasm/oscillators.wasm');
const RATE = 48000;
const BLOCK = 128;

const bytes = new Uint8Array(readFileSync(WASM));
const module = new WebAssembly.Module(bytes);

/** Everything the module exports that these tests touch: the filter's surface plus the oscillator's. */
type KernelExports = RustFilterExports & {
    rosc_simd(): number;
    rosc_freq_ptr(): number;
    rosc_out_ptr(): number;
    rosc_render(shape: number, frames: number, perSampleFreq: number): number;
};

function instance(): KernelExports {
    const x = new WebAssembly.Instance(module, {}).exports as unknown as KernelExports;
    expect(hasRustFilterApi(x)).toBe(true);
    expect(x.rosc_init(RATE)).toBe(1);
    return x;
}

function buffer(x: KernelExports): Float32Array {
    return new Float32Array(x.memory.buffer, x.rflt_buf_ptr(), x.rosc_max_frames());
}

/** Stream `signal` through the kernel in `sizes`-sized chunks (repeating). */
function run(x: KernelExports, signal: Float32Array, sizes: number[] = [BLOCK]): Float32Array {
    const buf = buffer(x);
    const result = new Float32Array(signal.length);
    for (let at = 0, b = 0; at < signal.length; b++) {
        const n = Math.min(sizes[b % sizes.length], signal.length - at);
        buf.set(signal.subarray(at, at + n));
        expect(x.rflt_process(n)).toBe(n);
        result.set(buf.subarray(0, n), at);
        at += n;
    }
    return result;
}

const sine = (f: number, frames: number): Float32Array =>
    Float32Array.from({ length: frames }, (_, i) => Math.sin((2 * Math.PI * f * i) / RATE));

function configured(type: RustFilterType, cutoff: number, q: number): KernelExports {
    const x = instance();
    expect(x.rflt_configure(RATE, cutoff, q, RUST_FILTER_TYPE_ID[type])).toBe(1);
    return x;
}

/** Gain of a unit sine: RMS of the settled second half, times sqrt 2 (a sampled peak can miss the crest). */
function gainOfSettled(x: Float32Array): number {
    let sum = 0;
    const from = x.length >> 1;
    for (let i = from; i < x.length; i++) sum += x[i] * x[i];
    return Math.sqrt((2 * sum) / (x.length - from));
}

/** |H(e^jw)| of the RBJ biquad (Audio EQ Cookbook). */
function rbjMagnitude(type: RustFilterType, fc: number, q: number, f: number): number {
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
    it('passes the release gate: the filter is part of the one rust_osc.wasm surface', () => {
        expect(checkRustOscModule(bytes)).toEqual([]);
    });

    it('imports nothing, so a worklet instantiates it with an empty import object', () => {
        expect(WebAssembly.Module.imports(module)).toEqual([]);
    });

    it('exports the filter surface the worklet requires', () => {
        const names = new Set(WebAssembly.Module.exports(module).map((e) => e.name));
        for (const name of RUST_FILTER_REQUIRED_EXPORTS) expect(names.has(name), name).toBe(true);
    });

    it('is ABI-compatible with the processor and keeps fixed, non-shared memory', () => {
        const x = instance();
        expect(x.rosc_abi_version()).toBe(RUST_FILTER_ABI_VERSION);
        expect(x.rosc_max_frames()).toBe(1024);
        expect(x.memory.buffer).toBeInstanceOf(ArrayBuffer);
        const size = x.memory.buffer.byteLength;
        expect(() => x.memory.grow(1)).toThrow();
        expect(x.memory.buffer.byteLength).toBe(size);
    });

    it('keeps the filter buffer inside memory and apart from the oscillator buffers', () => {
        const x = instance();
        const n = x.rosc_max_frames() * 4;
        const f = x.rflt_buf_ptr();
        expect(f + n).toBeLessThanOrEqual(x.memory.buffer.byteLength);
        for (const other of [x.rosc_freq_ptr(), x.rosc_out_ptr()]) {
            expect(f + n <= other || other + n <= f, `overlaps ${other}`).toBe(true);
        }
    });
});

describe('frequency response', () => {
    const CASES: Array<[RustFilterType, number, number]> = [
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

    it('a 20 Hz lowpass sits at its own cutoff (f32 state would drift here)', () => {
        const x = configured('lp', 20, 0.7071);
        const got = gainOfSettled(run(x, sine(20, RATE * 3)));
        expect(got).toBeCloseTo(Math.SQRT1_2, 2);
    });

    it('clamps the cutoff to [20 Hz, rate / 2.1] like the other kernels, and never goes unstable', () => {
        for (const type of [0, 1, 2]) {
            for (const cutoff of [-5, 0, 1, 1e6]) {
                const x = instance();
                expect(x.rflt_configure(RATE, cutoff, 30, type)).toBe(1);
                for (const v of run(x, sine(440, 48000))) expect(Number.isFinite(v) && Math.abs(v) < 200).toBe(true);
            }
        }
    });
});

describe('same response as the WASM OSC filter (wamFilter.wasm)', () => {
    const wamModule = new WebAssembly.Module(new Uint8Array(readFileSync(WAM_FILTER_WASM)));

    function wamRun(type: RustFilterType, cutoff: number, q: number, signal: Float32Array): Float32Array {
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

    const noise = (() => {
        let s = 4242;
        return Float32Array.from({ length: 24000 }, () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x40000000) - 1);
    })();

    it.each([
        ['lp', 20, 0.7071], ['lp', 1500, 3], ['lp', 9000, 12],
        ['bp', 300, 5], ['bp', 3000, 0.7071],
        ['hp', 80, 1], ['hp', 6000, 4],
    ] as const)('%s at %i Hz, Q %d: noise through both kernels agrees to f32 rounding', (type, fc, q) => {
        const rust = run(configured(type, fc, q), noise);
        const wam = wamRun(type, fc, q, noise);
        let worst = 0;
        let peak = 0;
        for (let i = 0; i < noise.length; i++) {
            worst = Math.max(worst, Math.abs(rust[i] - wam[i]));
            peak = Math.max(peak, Math.abs(wam[i]));
        }
        // Coefficients differ by ~1e-15 (polynomial sin/cos vs libm); the f32 output
        // rounding is what is left, relative to the signal's own size.
        expect(worst / Math.max(peak, 1e-6), `${type} fc=${fc} q=${q}`).toBeLessThan(2e-5);
    });
});

describe('filters any oscillator', () => {
    /** A saw's energy above `hz`, as a fraction of its total (Goertzel-free: an FFT-less DFT at a few bins). */
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

    function rustSaw(hz: number, frames: number): Float32Array {
        const o = new WebAssembly.Instance(module, {}).exports as unknown as KernelExports;
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
        // The AssemblyScript oscillator's own table (what a `wam-saw` voice plays), unfiltered: cutoff wide open.
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
        ['the Rust oscillator', () => rustSaw(440, 4096)],
        ['the AssemblyScript oscillator (wam-saw table)', () => asSaw(4096)],
        ['a plain wave (the js oscillator)', () => naiveSaw(440, 4096)],
    ] as const)('a lowpass at 1 kHz darkens %s', (_name, source) => {
        const dry = source();
        const wet = run(configured('lp', 1000, 0.7071), dry);
        const tail = (x: Float32Array) => x.subarray(1024, 2048);
        expect(highEnergyFraction(tail(dry), 4000)).toBeGreaterThan(0.002);
        expect(highEnergyFraction(tail(wet), 4000)).toBeLessThan(highEnergyFraction(tail(dry), 4000) / 20);
    });

    it('a highpass at 4 kHz removes the body of the Rust oscillator, leaving its edges', () => {
        const dry = rustSaw(220, 4096);
        const wet = run(configured('hp', 4000, 0.7071), dry);
        const energy = (x: Float32Array) => x.subarray(1024).reduce((s, v) => s + v * v, 0);
        expect(energy(wet)).toBeLessThan(energy(dry) * 0.05);
    });

    it('the oscillator and the filter in ONE instance do not disturb each other', () => {
        // Same module, two jobs: render a saw and filter a different signal, interleaved,
        // and each output equals what it is when it runs alone.
        const both = instance();
        both.rflt_configure(RATE, 1200, 3, 0);
        new Float32Array(both.memory.buffer, both.rosc_freq_ptr(), 1)[0] = 330;
        const out = new Float32Array(both.memory.buffer, both.rosc_out_ptr(), 1024);
        const fbuf = buffer(both);
        const input = sine(700, 2048);
        const osc: number[] = [];
        const filt: number[] = [];
        for (let at = 0; at < 2048; at += BLOCK) {
            both.rosc_render(RUST_OSC_SHAPE_ID.saw, BLOCK, 0);
            osc.push(...out.subarray(0, BLOCK));
            fbuf.set(input.subarray(at, at + BLOCK));
            both.rflt_process(BLOCK);
            filt.push(...fbuf.subarray(0, BLOCK));
        }
        expect(filt).toEqual(Array.from(run(configured('lp', 1200, 3), input)));
        expect(osc).toEqual(Array.from(rustSaw(330, 2048)));
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
        const second = run(x, noise.subarray(0, 512));
        expect(Array.from(second)).not.toEqual(Array.from(first));
        x.rflt_reset();
        expect(Array.from(run(x, noise.subarray(0, 512)))).toEqual(Array.from(first));
    });

    it('a cutoff change keeps the state: no discontinuity where the coefficients switch', () => {
        const x = configured('lp', 400, 2);
        const level = new Float32Array(8192).fill(0.8);
        const lead = run(x, level);
        expect(lead[lead.length - 1]).toBeCloseTo(0.8, 3);
        x.rflt_configure(RATE, 6000, 2, 0);
        const tail = run(x, level.subarray(0, 256));
        // A state reset would drop the first frame to ≈ b0 · level (< 0.15).
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
            [RATE, 1000, 1, -1], // negative → huge unsigned: also refused
        ];
        for (const [rate, cutoff, q, type] of refused) {
            expect(x.rflt_configure(rate, cutoff, q, type), JSON.stringify([rate, cutoff, q, type])).toBe(0);
        }
        expect(Array.from(run(x, noise.subarray(0, 256)))).toEqual(before);
    });

    it('rflt_process clamps a block longer than its buffer instead of writing past it', () => {
        const x = configured('lp', 1000, 1);
        expect(x.rflt_process(1025)).toBe(1024);
        expect(x.rflt_process(0)).toBe(0);
    });

    it('writes only the filter buffer and the biquad state next to it: not the oscillator buffers, not the rest of memory', () => {
        const x = configured('hp', 300, 12);
        const mem = new Uint8Array(x.memory.buffer);
        const lo = x.rflt_buf_ptr();
        const hi = lo + x.rosc_max_frames() * 4;
        // `Engine` and `Biquad` are repr(C) with the state last: the two f64 state
        // words (16 bytes) sit immediately before the in-place buffer. The
        // coefficients (scalar and four-at-once) are written by configure only.
        const stateFrom = lo - 16;
        const snapshot = mem.slice();
        run(x, noise);
        for (let i = 0; i < mem.length; i++) {
            if ((i < stateFrom || i >= hi) && mem[i] !== snapshot[i]) {
                throw new Error(`byte ${i} written outside the filter state and buffer [${stateFrom}, ${hi})`);
            }
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

describe('rust-filter-processor on the real kernel', () => {
    beforeAll(async () => {
        g.AudioWorkletProcessor = class {
            readonly port = new FakePort();
        };
        g.registerProcessor = (name, ctor) => {
            if (name === RUST_FILTER_PROCESSOR) Ctor = ctor;
        };
        g.sampleRate = RATE;
        await import('../rust-filter-processor');
    });

    const params = (cutoff: number, resonance: number, type: RustFilterType) => ({
        cutoff: new Float32Array([cutoff]),
        resonance: new Float32Array([resonance]),
        type: new Float32Array([RUST_FILTER_TYPE_ID[type]]),
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
        expect(node.port.posted).toEqual([{ type: 'ready', simd: true, maxFrames: 1024 }]);
    });

    it('reports an error (and stays silent) for a missing module, never passing audio through', () => {
        const node = new Ctor({ processorOptions: { module: undefined } });
        expect(node.port.posted[0]?.type).toBe('error');
        expect(stream(node, sine(440, 512), params(1000, 1, 'lp')).every((v) => v === 0)).toBe(true);
    });

    it('refuses a module that is not rust_osc.wasm (no rflt_* exports), silent, with the reason', () => {
        const other = new WebAssembly.Module(new Uint8Array(readFileSync(WAM_FILTER_WASM)));
        const node = new Ctor({ processorOptions: { module: other } });
        expect(node.port.posted[0]).toMatchObject({ type: 'error', reason: expect.stringContaining('rflt_') });
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
        ref.rflt_configure(RATE, 5000, 2, RUST_FILTER_TYPE_ID.hp);
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
        stream(node, sine(900, 1024), p); // leave the filter ringing
        const out = new Float32Array(BLOCK).fill(9);
        node.process([[]], [[out]], p); // source disconnected: the engine hands an empty input
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

/* ---- SIMD (#1663): the f64x2 four-at-once path is what runs, and it is exact ---- */

/** Each function body of the code section, by function index (the module imports none). */
function functionBodies(wasm: Uint8Array): Uint8Array[] {
    let p = 8;
    const uleb = () => {
        let r = 0;
        let shift = 0;
        let b: number;
        do {
            b = wasm[p++];
            r |= (b & 0x7f) << shift;
            shift += 7;
        } while (b & 0x80);
        return r >>> 0;
    };
    while (p < wasm.length) {
        const id = wasm[p++];
        const len = uleb();
        const end = p + len;
        if (id === 10) {
            const bodies: Uint8Array[] = [];
            for (let n = uleb(); n > 0; n--) {
                const size = uleb();
                bodies.push(wasm.subarray(p, p + size));
                p += size;
            }
            return bodies;
        }
        p = end;
    }
    return [];
}

function exportedFunctionIndex(wasm: Uint8Array, name: string): number {
    let p = 8;
    const uleb = () => {
        let r = 0;
        let shift = 0;
        let b: number;
        do {
            b = wasm[p++];
            r |= (b & 0x7f) << shift;
            shift += 7;
        } while (b & 0x80);
        return r >>> 0;
    };
    while (p < wasm.length) {
        const id = wasm[p++];
        const len = uleb();
        const end = p + len;
        if (id === 7) {
            for (let n = uleb(); n > 0; n--) {
                const nameLen = uleb();
                const got = new TextDecoder().decode(wasm.subarray(p, p + nameLen));
                p += nameLen;
                const kind = wasm[p++];
                const index = uleb();
                if (kind === 0 && got === name) return index;
            }
        }
        p = end;
    }
    throw new Error(`no exported function ${name}`);
}

function countOp(body: Uint8Array, op: number[]): number {
    let n = 0;
    for (let i = 0; i + op.length <= body.length; i++) {
        if (op.every((v, k) => body[i + k] === v)) n++;
    }
    return n;
}

// SIMD opcodes are 0xfd + a LEB128 sub-opcode.
const F64X2_ADD = [0xfd, 0xf0, 0x01];
const F64X2_MUL = [0xfd, 0xf2, 0x01];

describe('SIMD filter path (#1663)', () => {
    it('the module reports SIMD, and rflt_process is f64x2 arithmetic in the shipped bytes', () => {
        expect(instance().rosc_simd()).toBe(1);
        expect(WebAssembly.Module.imports(module)).toEqual([]);
        const bodies = functionBodies(bytes);
        const simd = bodies[exportedFunctionIndex(bytes, 'rflt_process')];
        const scalar = bodies[exportedFunctionIndex(bytes, 'rflt_process_scalar')];
        // One group of four is 16 f64x2 multiplies and 13 adds (outputs + next state).
        expect(countOp(simd, F64X2_MUL)).toBeGreaterThanOrEqual(16);
        expect(countOp(simd, F64X2_ADD)).toBeGreaterThanOrEqual(13);
        // The reference really is the scalar code, so the parity below compares two paths.
        expect(countOp(scalar, F64X2_MUL)).toBe(0);
    });

    const noise = (() => {
        let s = 777;
        return Float32Array.from({ length: 6000 }, () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x40000000) - 1);
    })();

    function runWith(x: KernelExports, fn: 'rflt_process' | 'rflt_process_scalar', signal: Float32Array, sizes: number[]) {
        const buf = buffer(x);
        const out = new Float32Array(signal.length);
        for (let at = 0, b = 0; at < signal.length; b++) {
            const n = Math.min(sizes[b % sizes.length], signal.length - at);
            buf.set(signal.subarray(at, at + n));
            expect(x[fn](n)).toBe(n);
            out.set(buf.subarray(0, n), at);
            at += n;
        }
        return out;
    }

    const sameBits = (a: Float32Array, b: Float32Array) =>
        expect(Array.from(new Uint32Array(a.buffer))).toEqual(Array.from(new Uint32Array(b.buffer)));

    /**
     * The f64 state (z1, z2) as raw bits: it sits just before the filter buffer
     * (see "writes only the filter buffer and the biquad state"). Outputs are
     * rounded to f32, so a stray f64 rounding difference would hide there; the
     * state carries it.
     */
    const stateBits = (x: KernelExports) =>
        Array.from(new BigUint64Array(x.memory.buffer.slice(x.rflt_buf_ptr() - 16, x.rflt_buf_ptr())));

    function sameRun(type: RustFilterType, fc: number, q: number, signal: Float32Array, sizes: number[]) {
        const a = configured(type, fc, q);
        const b = configured(type, fc, q);
        sameBits(runWith(a, 'rflt_process', signal, sizes), runWith(b, 'rflt_process_scalar', signal, sizes));
        expect(stateBits(a), `${type} ${fc} ${q} ${sizes.join(',')}`).toEqual(stateBits(b));
        expect(stateBits(a).some((v) => v !== 0n) || signal.every((v) => v === 0)).toBe(true);
    }

    it.each([
        ['lp', 20, 0.7071], ['lp', 1500, 3], ['lp', 9000, 12], ['lp', 22000, 40],
        ['bp', 300, 5], ['bp', 3000, 0.7071], ['bp', 120, 60],
        ['hp', 80, 1], ['hp', 6000, 4], ['hp', 20, 0.1],
    ] as const)('%s at %i Hz, Q %d: v128 path == scalar reference, bit for bit, at every length 1-13 and 128', (type, fc, q) => {
        for (const sizes of [[1], [2], [3], [4], [5], [6], [7], [8], [9], [10], [11], [12], [13], [128], [37, 211, 5]]) {
            sameRun(type, fc, q, noise, sizes);
        }
    });

    it('extremes take the same bits on both paths: full-scale, tiny, subnormal and silent input', () => {
        const extremes = Float32Array.from({ length: 1024 }, (_, i) => {
            switch (i % 8) {
                case 0: return 3.4e38;
                case 1: return -3.4e38;
                case 2: return 1e-40; // subnormal f32
                case 3: return -1e-30;
                case 4: return 0;
                case 5: return -0;
                default: return i < 512 ? 1 : -1;
            }
        });
        for (const type of ['lp', 'bp', 'hp'] as const) sameRun(type, 700, 9, extremes, [128]);
    });

    it('a reconfigure mid-stream switches the four-at-once coefficients with the scalar ones', () => {
        const a = configured('lp', 400, 2);
        const b = configured('lp', 400, 2);
        const first = [runWith(a, 'rflt_process', noise.subarray(0, 1000), [128]), runWith(b, 'rflt_process_scalar', noise.subarray(0, 1000), [128])];
        sameBits(first[0], first[1]);
        for (const x of [a, b]) expect(x.rflt_configure(RATE, 7000, 5, RUST_FILTER_TYPE_ID.hp)).toBe(1);
        sameBits(
            runWith(a, 'rflt_process', noise.subarray(1000, 3000), [128]),
            runWith(b, 'rflt_process_scalar', noise.subarray(1000, 3000), [128]),
        );
        expect(stateBits(a)).toEqual(stateBits(b));
    });

    it('an unconfigured kernel is still an exact identity on the v128 path', () => {
        const x = instance();
        sameBits(runWith(x, 'rflt_process', noise.subarray(0, 515), [515]), noise.slice(0, 515));
    });
});
