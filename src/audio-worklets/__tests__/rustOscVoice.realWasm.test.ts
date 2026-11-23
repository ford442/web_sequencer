/**
 * The `rust-*` oscillator family (#1664) on the real public/rust_osc.wasm.
 *
 * Integration tier: needs `pnpm run build:wasm:rust` (or build:native);
 * requireRepoArtifacts fails the tier closed when the binary is missing.
 *
 *   1. The module passes the release gate checker (fixed memory, no imports,
 *      SIMD compiled in, exact export surface).
 *   2. The shipped v128 path renders what the scalar reference renders, for
 *      every shape, constant and per-sample frequency, and ragged block sizes
 *      (the 4-lane body plus the scalar tail).
 *   3. The kernel is band-limited where it claims to be: the saw's alias
 *      energy is far below a naive saw's at the same pitch.
 *   4. rust-osc-processor, run block by block as the audio thread would, opens
 *      its gate on the exact frame, resets phase on the edge, follows a-rate
 *      frequency, and is silent while closed.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkRustOscModule } from '../../../tools/check_rust_osc_module.mjs';
import { renderRustOscOnModule } from '../../audio/offline/OfflineRustOscEngine';
import {
    RUST_OSC_PROCESSOR,
    RUST_OSC_SHAPE_ID,
    type RustOscExports,
    type RustOscOutMessage,
} from '../rustOsc';

const WASM = join(__dirname, '../../../public/rust_osc.wasm');
const RATE = 48000;
const BLOCK = 128;
const SHAPES = Object.values(RUST_OSC_SHAPE_ID);

/**
 * The scalar reference performs the v128 path's operations in the same order
 * (lib.rs `render_scalar_range`), and wasm has no FMA outside relaxed SIMD, so
 * the two are bit-identical — any difference is a kernel bug.
 */
const PARITY_EPSILON = 0;

const bytes = new Uint8Array(readFileSync(WASM));
const module = new WebAssembly.Module(bytes);

function instance(): RustOscExports {
    const x = new WebAssembly.Instance(module, {}).exports as unknown as RustOscExports;
    expect(x.rosc_init(RATE)).toBe(1);
    return x;
}

function views(x: RustOscExports) {
    const max = x.rosc_max_frames();
    return {
        freq: new Float32Array(x.memory.buffer, x.rosc_freq_ptr(), max),
        out: new Float32Array(x.memory.buffer, x.rosc_out_ptr(), max),
    };
}

/** Render `blocks` of `sizes[i % len]` frames through `render`, concatenated. */
function renderRun(
    which: 'rosc_render' | 'rosc_render_scalar',
    shape: number,
    sizes: number[],
    blocks: number,
    hzAt: ((frame: number) => number) | number,
): Float32Array {
    const x = instance();
    const { freq, out } = views(x);
    const total = Array.from({ length: blocks }, (_, i) => sizes[i % sizes.length]).reduce((a, b) => a + b, 0);
    const result = new Float32Array(total);
    let at = 0;
    for (let b = 0; b < blocks; b++) {
        const n = sizes[b % sizes.length];
        const perSample = typeof hzAt === 'function';
        if (perSample) for (let i = 0; i < n; i++) freq[i] = hzAt(at + i);
        else freq[0] = hzAt;
        expect(x[which](shape, n, perSample ? 1 : 0)).toBe(n);
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

describe('public/rust_osc.wasm', () => {
    it('passes the release gate checker', () => {
        expect(checkRustOscModule(bytes)).toEqual([]);
    });

    it.each(SHAPES)('SIMD render matches the scalar reference (shape %i, constant pitch, ragged blocks)', (shape) => {
        const sizes = [128, 127, 5, 64, 3, 128];
        for (const hz of [55, 440, 3517, 12000, 23999]) {
            const simd = renderRun('rosc_render', shape, sizes, 24, hz);
            const scalar = renderRun('rosc_render_scalar', shape, sizes, 24, hz);
            expect(maxAbsDiff(simd, scalar), `${hz} Hz`).toBeLessThanOrEqual(PARITY_EPSILON);
        }
    });

    it.each(SHAPES)('SIMD render matches the scalar reference (shape %i, per-sample glide)', (shape) => {
        const glide = (frame: number) => 80 * Math.pow(2, frame / 1500); // ~6 octaves over 9000 frames
        const simd = renderRun('rosc_render', shape, [128], 70, glide);
        const scalar = renderRun('rosc_render_scalar', shape, [128], 70, glide);
        expect(maxAbsDiff(simd, scalar)).toBeLessThanOrEqual(PARITY_EPSILON);
    });

    it.each(SHAPES)('shape %i stays bounded and DC-free over a two-second note (SIMD path)', (shape) => {
        // Caught a real defect: the square's step and its BLEP residual once
        // disagreed when t + 0.5 rounded to 1.0, spiking to 2.0 every period.
        for (const hz of [440, 1000, 3000]) {
            const x = renderRun('rosc_render', shape, [128], (2 * RATE) / 128, hz);
            let peak = 0;
            let sum = 0;
            for (const v of x) {
                peak = Math.max(peak, Math.abs(v));
                sum += v;
            }
            expect(peak, `${hz} Hz peak`).toBeLessThanOrEqual(1.1);
            expect(Math.abs(sum / x.length), `${hz} Hz DC`).toBeLessThan(1e-3);
        }
    });

    it('the offline (export) render is the live kernel, bit for bit', () => {
        for (const [shape, id] of Object.entries(RUST_OSC_SHAPE_ID)) {
            const offline = renderRustOscOnModule(module, {
                shape: shape as keyof typeof RUST_OSC_SHAPE_ID,
                hz: 330,
                frames: 3000,
                sampleRate: RATE,
            });
            const live = renderRun('rosc_render', id, [1024, 1024, 952], 3, 330);
            expect(offline, shape).not.toBeNull();
            expect(maxAbsDiff(offline!, live), shape).toBe(0);
        }
    });

    it('never emits NaN for hostile frequencies', () => {
        for (const shape of SHAPES) {
            for (const hz of [NaN, -1, Infinity, 1e9, 0]) {
                const x = renderRun('rosc_render', shape, [128], 4, hz);
                expect(x.every((v) => Number.isFinite(v) && Math.abs(v) <= 1.5), `shape ${shape} ${hz}`).toBe(true);
            }
        }
    });

    it('the saw is band-limited: alias energy far below a naive saw at 3517 Hz', () => {
        // N = RATE samples → 1 Hz bins; an integer pitch puts every harmonic and
        // every folded alias on an exact bin, so Goertzel at the harmonics plus
        // Parseval for the total gives the alias energy.
        const hz = 3517;
        const aliasDb = (sig: Float32Array) => {
            let total = 0;
            for (const v of sig) total += v * v;
            total *= sig.length;
            let harmonic = 0;
            for (let k = 0; k * hz <= RATE / 2; k++) {
                const w = (2 * Math.PI * k * hz) / sig.length;
                const c = 2 * Math.cos(w);
                let s1 = 0, s2 = 0;
                for (const v of sig) {
                    const s0 = v + c * s1 - s2;
                    s2 = s1;
                    s1 = s0;
                }
                const p = s1 * s1 + s2 * s2 - c * s1 * s2;
                harmonic += k === 0 ? p : 2 * p;
            }
            return 10 * Math.log10(Math.max(1e-30, (total - harmonic) / total));
        };
        const rust = renderRun('rosc_render', RUST_OSC_SHAPE_ID.saw, [128], RATE / 128, hz);
        const naive = new Float32Array(RATE);
        for (let i = 0, t = 0; i < RATE; i++, t = (t + hz / RATE) % 1) naive[i] = 2 * t - 1;
        expect(aliasDb(rust)).toBeLessThan(aliasDb(naive) - 10);
    });
});

// ── The processor, driven block by block ─────────────────────────────────────

class FakePort {
    onmessage: ((e: MessageEvent) => unknown) | null = null;
    readonly posted: RustOscOutMessage[] = [];
    postMessage(msg: RustOscOutMessage) {
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

describe('rust-osc-processor on the real kernel', () => {
    beforeAll(async () => {
        g.AudioWorkletProcessor = class {
            readonly port = new FakePort();
        };
        g.registerProcessor = (name, ctor) => {
            if (name === RUST_OSC_PROCESSOR) Ctor = ctor;
        };
        g.sampleRate = RATE;
        await import('../rust-osc-processor');
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

    it('instantiates synchronously from processorOptions and reports ready + SIMD', () => {
        const node = new Ctor({ processorOptions: { module } });
        expect(node.port.posted).toEqual([{ type: 'ready', simd: true, maxFrames: 1024 }]);
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
        const out = block(node, params(1000, gate, RUST_OSC_SHAPE_ID.saw));
        expect(out.subarray(0, OPEN).every((v) => v === 0)).toBe(true);
        // The same kernel from phase 0 for the open frames.
        const ref = renderRun('rosc_render', RUST_OSC_SHAPE_ID.saw, [BLOCK - OPEN], 1, 1000);
        expect(maxAbsDiff(out.subarray(OPEN), ref)).toBe(0);
    });

    it('closes mid-block and resets phase when it opens again', () => {
        const node = new Ctor({ processorOptions: { module } });
        block(node, params(700, 1)); // ring a while: phase is somewhere mid-cycle
        const gate = new Float32Array(BLOCK);
        gate.fill(1, 0, 20);
        gate.fill(1, 90);
        const out = block(node, params(700, gate, RUST_OSC_SHAPE_ID.sqr));
        expect(out.subarray(20, 90).every((v) => v === 0)).toBe(true);
        const ref = renderRun('rosc_render', RUST_OSC_SHAPE_ID.sqr, [BLOCK - 90], 1, 700);
        expect(maxAbsDiff(out.subarray(90), ref)).toBe(0);
    });

    it('follows an a-rate frequency ramp sample by sample', () => {
        const node = new Ctor({ processorOptions: { module } });
        const hz = new Float32Array(BLOCK).map((_, i) => 200 + i * 20);
        const out = block(node, params(hz, 1, RUST_OSC_SHAPE_ID.sin));
        const ref = renderRun('rosc_render', RUST_OSC_SHAPE_ID.sin, [BLOCK], 1, (i) => 200 + i * 20);
        expect(maxAbsDiff(out, ref)).toBe(0);
    });

    it('stops processing after dispose', () => {
        const node = new Ctor({ processorOptions: { module } });
        node.port.onmessage?.({ data: { type: 'dispose' } } as MessageEvent);
        expect(node.process([], [[new Float32Array(BLOCK)]], params(440, 1))).toBe(false);
    });
});
