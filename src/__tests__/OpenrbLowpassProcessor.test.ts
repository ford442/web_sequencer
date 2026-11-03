// src/__tests__/OpenrbLowpassProcessor.test.ts
//
// The openrb low-pass worklet: registration, the unavailable path (no or a
// bad module), and — when the opt-in GPL module has been built locally
// (`pnpm run build:wasm:openrb338`) — that the processor's output is the
// module's own, sample for sample, on both channels.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { OPENRB_LP_PARAM_IDS, supportsOpenrbLowpass } from '../audio-worklets/openrbLowpass';

class StubMessagePort {
    onmessage: ((ev: MessageEvent) => void) | null = null;
    postMessage = vi.fn();
    dispatch(data: unknown) {
        this.onmessage?.({ data } as MessageEvent);
    }
}

class StubAudioWorkletProcessor {
    readonly port = new StubMessagePort();
}

const registered = new Map<string, new (options?: unknown) => StubAudioWorkletProcessor>();
(globalThis as Record<string, unknown>).AudioWorkletProcessor = StubAudioWorkletProcessor;
(globalThis as Record<string, unknown>).sampleRate = 44100;
(globalThis as Record<string, unknown>).registerProcessor = (
    name: string,
    ctor: new (options?: unknown) => StubAudioWorkletProcessor,
) => registered.set(name, ctor);

interface Proc extends StubAudioWorkletProcessor {
    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}

function make(options?: unknown): Proc {
    const Ctor = registered.get('openrb-lowpass-processor');
    if (!Ctor) throw new Error('openrb-lowpass-processor not registered');
    return new Ctor(options) as Proc;
}

function signal(n: number, seed: number): Float32Array {
    const out = new Float32Array(n);
    let s = seed >>> 0;
    for (let i = 0; i < n; i++) {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        out[i] = 0.6 * (((i % 173) / 86.5) - 1) + 0.4 * (s / 2 ** 32 - 0.5);
    }
    return out;
}

const WASM = join(process.cwd(), 'openrb338/pkg/openrb338.wasm');
const haveWasm = existsSync(WASM);

beforeAll(async () => {
    await import('../audio-worklets/openrb-lowpass-processor');
});

describe('openrb-lowpass-processor', () => {
    it('registers, and is silent until a module arrives', () => {
        const proc = make({ processorOptions: { cutoffHz: 500, q: 2 } });
        const out = [[new Float32Array(128).fill(9), new Float32Array(128).fill(9)]];
        expect(proc.process([[signal(128, 1)]], out)).toBe(true);
        expect(out[0][0].every((v) => v === 0) && out[0][1].every((v) => v === 0)).toBe(true);
    });

    it('reports a module without the low-pass group as unavailable', async () => {
        // The smallest valid module: no exports at all.
        const empty = await WebAssembly.compile(new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]));
        const proc = make();
        proc.port.dispatch({ type: 'module', module: empty });
        expect(proc.port.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'unavailable' }),
        );
        expect(supportsOpenrbLowpass({})).toBe(false);
    });

    it.skipIf(!haveWasm)('plays the module filter on both channels (built module)', async () => {
        const module = await WebAssembly.compile(readFileSync(WASM));
        const proc = make({ processorOptions: { cutoffHz: 900, q: 3 } });
        proc.port.dispatch({ type: 'module', module });
        expect(proc.port.postMessage).toHaveBeenCalledWith({ type: 'ready', bitExact: true });

        // The reference: the same module driven directly, one filter per channel.
        const x = (await WebAssembly.instantiate(module, {})).exports as unknown;
        if (!supportsOpenrbLowpass(x)) throw new Error('built module lacks openrb_lp_*');
        const ref = [0, 1].map(() => {
            const h = x.openrb_lp_create(44100);
            x.openrb_lp_set_param(h, OPENRB_LP_PARAM_IDS.q, 3);
            x.openrb_lp_set_param(h, OPENRB_LP_PARAM_IDS.cutoffHz, 900);
            return { h, ptr: x.openrb_lp_buffer(h, 128) >>> 0 };
        });

        const left = signal(128 * 40, 7);
        const right = signal(128 * 40, 99);
        let energy = 0;
        for (let q = 0; q < 40; q++) {
            const ins = [left.subarray(q * 128, q * 128 + 128), right.subarray(q * 128, q * 128 + 128)];
            const out = [[new Float32Array(128), new Float32Array(128)]];
            proc.process([ins], out);
            for (let c = 0; c < 2; c++) {
                const view = new Float32Array(x.memory.buffer, ref[c].ptr, 128);
                view.set(ins[c]);
                x.openrb_lp_process(ref[c].h, 128);
                const want = new Float32Array(x.memory.buffer, ref[c].ptr, 128);
                expect(Array.from(out[0][c])).toEqual(Array.from(want));
                for (const v of out[0][c]) energy += v * v;
            }
        }
        expect(energy).toBeGreaterThan(1);

        // A mono input feeds both channels.
        const mono = [[new Float32Array(128), new Float32Array(128)]];
        proc.process([[signal(128, 3)]], mono);
        expect(Array.from(mono[0][1])).not.toEqual(new Array(128).fill(0));
    });
});
