/**
 * The `cpp-*` oscillator family (#1665) on the real public/cpp_osc.wasm.
 *
 * Integration tier: needs `pnpm run build:wasm:cpp` (or build:native);
 * requireRepoArtifacts fails the tier closed when the binary is missing.
 *
 *   1. The module passes the release gate checker (fixed memory, no imports,
 *      scalar, exact export surface).
 *   2. The kernel is band-limited where it claims to be: for saw, square and
 *      triangle the worst alias below 16 kHz is ~-90 dB, where a naive wave at
 *      the same pitch aliases at ~-20 dB. Bounded, DC-free, NaN-proof.
 *   3. Its timing is what the worklet relies on: a fixed `cosc_latency()`
 *      delay, a band-limited onset after a reset, block-size independence.
 *   4. The offline (export) render is the live kernel, bit for bit.
 *   5. cpp-osc-processor, run block by block as the audio thread would, opens
 *      its gate on the exact frame, resets on the edge, follows a-rate
 *      frequency, and is silent while closed.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkCppOscModule } from '../../../tools/check_cpp_osc_module.mjs';
import { renderCppOscOnModule } from '../../audio/offline/OfflineCppOscEngine';
import {
    CPP_OSC_PROCESSOR,
    CPP_OSC_SHAPE_ID,
    instantiateCppOsc,
    type CppOscInstance,
    type CppOscOutMessage,
} from '../cppOsc';

const WASM = join(__dirname, '../../../public/cpp_osc.wasm');
const RATE = 48000;
const BLOCK = 128;
const SHAPES = Object.values(CPP_OSC_SHAPE_ID);

const bytes = new Uint8Array(readFileSync(WASM));
const module = new WebAssembly.Module(bytes);

function instance(): CppOscInstance {
    return instantiateCppOsc(module, RATE);
}

function views(x: CppOscInstance) {
    const max = x.cosc_max_frames();
    return {
        freq: new Float32Array(x.memory.buffer, x.cosc_freq_ptr(), max),
        out: new Float32Array(x.memory.buffer, x.cosc_out_ptr(), max),
    };
}

/** Render `total` frames in blocks of `sizes[i % len]`, from a reset at phase 0. */
function renderRun(
    shape: number,
    total: number,
    hzAt: ((frame: number) => number) | number,
    sizes: number[] = [BLOCK],
    x: CppOscInstance = instance(),
): Float32Array {
    const { freq, out } = views(x);
    x.cosc_reset(0);
    const result = new Float32Array(total);
    for (let at = 0, b = 0; at < total; b++) {
        const n = Math.min(sizes[b % sizes.length], total - at);
        const perSample = typeof hzAt === 'function';
        if (perSample) for (let i = 0; i < n; i++) freq[i] = hzAt(at + i);
        else freq[0] = hzAt;
        expect(x.cosc_render(shape, n, perSample ? 1 : 0)).toBe(n);
        result.set(out.subarray(0, n), at);
        at += n;
    }
    return result;
}

function maxAbsDiff(a: Float32Array, b: Float32Array): number {
    let m = 0;
    for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
    return m;
}

/** In-place radix-2 FFT. */
function fft(re: Float64Array, im: Float64Array): void {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            [re[i], re[j]] = [re[j], re[i]];
            [im[i], im[j]] = [im[j], im[i]];
        }
    }
    for (let len = 2; len <= n; len <<= 1) {
        const a = (-2 * Math.PI) / len;
        const wr = Math.cos(a);
        const wi = Math.sin(a);
        for (let i = 0; i < n; i += len) {
            let cr = 1;
            let ci = 0;
            for (let j = 0; j < len / 2; j++) {
                const k = i + j + len / 2;
                const vr = re[k] * cr - im[k] * ci;
                const vi = re[k] * ci + im[k] * cr;
                re[k] = re[i + j] - vr;
                im[k] = im[i + j] - vi;
                re[i + j] += vr;
                im[i + j] += vi;
                const t = cr * wr - ci * wi;
                ci = cr * wi + ci * wr;
                cr = t;
            }
        }
    }
}

/**
 * Worst non-harmonic bin below `limitHz`, in dB relative to the strongest bin.
 * N = 2^16 and a pitch of exactly CYCLES cycles per N samples put every
 * harmonic on bin k * CYCLES, and every folded alias on an exact bin too
 * (aliases of an integer-periodic signal are periodic with it) — so a
 * rectangular window has no leakage and the measurement is exact.
 */
const N = 65536;
const CYCLES = 4800; // 4800 / 65536 * 48000 = 3515.625 Hz, exact in float32
const TEST_HZ = (CYCLES * RATE) / N;

function worstAliasDb(sig: Float32Array, limitHz = 16000): number {
    const re = Float64Array.from(sig);
    const im = new Float64Array(N);
    fft(re, im);
    let peak = 0;
    let worst = 0;
    const limitBin = Math.floor((limitHz * N) / RATE);
    for (let k = 1; k < N / 2; k++) {
        const p = re[k] * re[k] + im[k] * im[k];
        peak = Math.max(peak, p);
        if (k <= limitBin && k % CYCLES !== 0) worst = Math.max(worst, p);
    }
    return 10 * Math.log10(Math.max(1e-30, worst / peak));
}

/** N steady-state samples (past the latency and the onset transient). */
function steady(shape: number): Float32Array {
    return renderRun(shape, 4096 + N, TEST_HZ).subarray(4096);
}

function naive(shape: 'saw' | 'sqr' | 'tri'): Float32Array {
    const out = new Float32Array(N);
    for (let i = 0; i < N; i++) {
        const p = ((i * CYCLES) % N) / N;
        out[i] = shape === 'saw' ? 2 * p - 1
            : shape === 'sqr' ? (p < 0.5 ? 1 : -1)
                : p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
    }
    return out;
}

describe('public/cpp_osc.wasm', () => {
    it('passes the release gate checker', () => {
        expect(checkCppOscModule(bytes)).toEqual([]);
    });

    it.each(['saw', 'sqr', 'tri'] as const)('%s is band-limited: aliases below 16 kHz ~70 dB under a naive one at 3.5 kHz', (shape) => {
        const cpp = worstAliasDb(steady(CPP_OSC_SHAPE_ID[shape]));
        const raw = worstAliasDb(naive(shape));
        expect(cpp, `${shape} worst alias`).toBeLessThan(-80);
        // The measurement can see aliasing at all: the naive wave is full of it.
        expect(raw, `naive ${shape} worst alias`).toBeGreaterThan(-45);
    });

    it('sine has no alias or distortion bins below 16 kHz', () => {
        expect(worstAliasDb(steady(CPP_OSC_SHAPE_ID.sin))).toBeLessThan(-80);
    });

    it.each(SHAPES)('shape %i stays bounded (Gibbs only) and DC-free over a two-second note', (shape) => {
        for (const hz of [55, 440, 1000, 3000, 12000]) {
            const x = renderRun(shape, 2 * RATE, hz).subarray(1024);
            let peak = 0;
            let sum = 0;
            for (const v of x) {
                peak = Math.max(peak, Math.abs(v));
                sum += v;
            }
            // A band-limited edge overshoots by the Gibbs ~9 % of its height (2),
            // and a square high enough that only its fundamental is left under
            // Nyquist (12 kHz) IS that sine: amplitude 4/π ≈ 1.273.
            expect(peak, `${hz} Hz peak`).toBeLessThanOrEqual(hz < 6000 ? 1.2 : (4 / Math.PI) * 1.01);
            expect(Math.abs(sum / x.length), `${hz} Hz DC`).toBeLessThan(2e-3);
        }
    });

    it.each(SHAPES)('shape %i sounds at the requested pitch (parity tests cannot see a scaling bug)', (shape) => {
        // Ten seconds of 440 Hz, counted past the latency and the onset pre-ring
        // (whose tiny alternating taps would add crossings of their own).
        const x = renderRun(shape, 10 * RATE, 440).subarray(64);
        let rising = 0;
        for (let i = 1; i < x.length; i++) if (x[i - 1] < 0 && x[i] >= 0) rising++;
        expect(Math.abs(rising - 4400), `${rising} rising crossings`).toBeLessThanOrEqual(1);
    });

    it('never emits NaN for hostile frequencies', () => {
        for (const shape of SHAPES) {
            for (const hz of [NaN, -1, Infinity, 1e9, 0]) {
                const x = renderRun(shape, BLOCK * 4, hz);
                expect(x.every((v) => Number.isFinite(v) && Math.abs(v) <= 1.5), `shape ${shape} ${hz}`).toBe(true);
            }
        }
    });

    it('follows a per-sample glide without discontinuities larger than its own edges', () => {
        const glide = (frame: number) => 80 * Math.pow(2, frame / 1500); // ~6 octaves over 9000 frames
        const x = renderRun(CPP_OSC_SHAPE_ID.sin, 9000, glide);
        let jump = 0;
        for (let i = 1; i < x.length; i++) jump = Math.max(jump, Math.abs(x[i] - x[i - 1]));
        // Top of the glide ≈ 5 kHz: a sine step is at most 2π f / fs ≈ 0.67.
        expect(jump).toBeLessThan(0.8);
    });

    it('reports a fixed latency and starts silent, then band-limited, after a reset', () => {
        const x = instance();
        const latency = x.cosc_latency();
        expect(latency).toBe(16);
        const out = renderRun(CPP_OSC_SHAPE_ID.sqr, 64, 440, [BLOCK], x);
        // Before the onset only its pre-ring: small, never the wave itself.
        for (let i = 0; i < latency; i++) expect(Math.abs(out[i]), `frame ${i}`).toBeLessThan(0.2);
        // From the latency on it is the square (+1 for the first half-cycle).
        expect(out[latency + 8]).toBeGreaterThan(0.9);
    });

    it('renders the same samples whatever the block size', () => {
        for (const shape of SHAPES) {
            const a = renderRun(shape, 5000, 1234.5, [128]);
            const b = renderRun(shape, 5000, 1234.5, [1024, 7, 333, 1, 64]);
            expect(maxAbsDiff(a, b), `shape ${shape}`).toBe(0);
        }
    });

    it('the offline (export) render is the live kernel, bit for bit', () => {
        for (const [shape, id] of Object.entries(CPP_OSC_SHAPE_ID)) {
            const offline = renderCppOscOnModule(module, {
                shape: shape as keyof typeof CPP_OSC_SHAPE_ID,
                hz: 330,
                frames: 3000,
                sampleRate: RATE,
            });
            const live = renderRun(id, 3000, 330, [1024]);
            expect(offline, shape).not.toBeNull();
            expect(maxAbsDiff(offline!, live), shape).toBe(0);
        }
    });

    it('refuses an unusable sample rate instead of rendering garbage', () => {
        expect(() => instantiateCppOsc(module, 1000)).toThrow(/refused the rate/);
        expect(() => instantiateCppOsc(module, NaN)).toThrow(/refused the rate/);
        expect(renderCppOscOnModule(module, { shape: 'saw', hz: 440, frames: 128, sampleRate: 1000 })).toBeNull();
    });
});

// ── The processor, driven block by block ─────────────────────────────────────

class FakePort {
    onmessage: ((e: MessageEvent) => unknown) | null = null;
    readonly posted: CppOscOutMessage[] = [];
    postMessage(msg: CppOscOutMessage) {
        this.posted.push(msg);
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

describe('cpp-osc-processor on the real kernel', () => {
    beforeAll(async () => {
        g.AudioWorkletProcessor = class {
            readonly port = new FakePort();
        };
        const previous = g.registerProcessor;
        g.registerProcessor = (name, ctor) => {
            if (name === CPP_OSC_PROCESSOR) Ctor = ctor;
            else previous?.(name, ctor);
        };
        g.sampleRate = RATE;
        await import('../cpp-osc-processor');
    });

    function params(hz: Float32Array | number, gate: Float32Array | number, shape = 0) {
        const f = (v: Float32Array | number) => (typeof v === 'number' ? new Float32Array([v]) : v);
        return { frequency: f(hz), gate: f(gate), shape: new Float32Array([shape]) };
    }

    function block(node: Processor, p: Record<string, Float32Array>): Float32Array {
        const out = new Float32Array(BLOCK);
        expect(node.process([], [[out]], p)).toBe(true);
        return out;
    }

    it('instantiates synchronously from processorOptions and reports ready + latency', () => {
        const node = new Ctor({ processorOptions: { module } });
        expect(node.port.posted).toEqual([{ type: 'ready', latency: 16, maxFrames: 1024 }]);
    });

    it('reports an error (and stays silent) for a missing module', () => {
        const node = new Ctor({ processorOptions: { module: undefined } });
        expect(node.port.posted[0]?.type).toBe('error');
        expect(block(node, params(440, 1)).every((v) => v === 0)).toBe(true);
    });

    it('is silent with the gate closed', () => {
        const node = new Ctor({ processorOptions: { module } });
        expect(block(node, params(440, 0)).every((v) => v === 0)).toBe(true);
    });

    it('opens on the exact frame, from phase 0, and matches the kernel run alone', () => {
        const node = new Ctor({ processorOptions: { module } });
        const gate = new Float32Array(BLOCK);
        const OPEN = 37;
        gate.fill(1, OPEN);
        const out = block(node, params(1000, gate, CPP_OSC_SHAPE_ID.saw));
        expect(out.subarray(0, OPEN).every((v) => v === 0)).toBe(true);
        const ref = renderRun(CPP_OSC_SHAPE_ID.saw, BLOCK - OPEN, 1000);
        expect(maxAbsDiff(out.subarray(OPEN), ref)).toBe(0);
    });

    it('closes mid-block and resets when it opens again', () => {
        const node = new Ctor({ processorOptions: { module } });
        block(node, params(700, 1)); // ring a while: phase and delay line are mid-note
        const gate = new Float32Array(BLOCK);
        gate.fill(1, 0, 20);
        gate.fill(1, 90);
        const out = block(node, params(700, gate, CPP_OSC_SHAPE_ID.sqr));
        expect(out.subarray(20, 90).every((v) => v === 0)).toBe(true);
        const ref = renderRun(CPP_OSC_SHAPE_ID.sqr, BLOCK - 90, 700);
        expect(maxAbsDiff(out.subarray(90), ref)).toBe(0);
    });

    it('follows an a-rate frequency ramp sample by sample', () => {
        const node = new Ctor({ processorOptions: { module } });
        const hz = new Float32Array(BLOCK).map((_, i) => 200 + i * 20);
        const out = block(node, params(hz, 1, CPP_OSC_SHAPE_ID.tri));
        const ref = renderRun(CPP_OSC_SHAPE_ID.tri, BLOCK, (i) => 200 + i * 20);
        expect(maxAbsDiff(out, ref)).toBe(0);
    });

    it('stops processing after dispose', () => {
        const node = new Ctor({ processorOptions: { module } });
        node.port.onmessage?.({ data: { type: 'dispose' } } as MessageEvent);
        expect(node.process([], [[new Float32Array(BLOCK)]], params(440, 1))).toBe(false);
    });
});
