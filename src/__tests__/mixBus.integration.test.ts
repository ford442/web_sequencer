/**
 * The real public/mix_bus.wasm (#1341) against the JS reference.
 *
 * Integration tier: needs `pnpm run build:wasm:mixbus` (or build:native);
 * requireRepoArtifacts fails the tier closed when the binary is missing.
 * The contract stem export relies on:
 *   - unity gain: bit-identical to the JS path, so switching engines never
 *     changes a master stem;
 *   - other gains: within MIX_BUS_GAIN_EPSILON (f32 multiply-add vs JS's
 *     f64-then-round), documented in BUILD_NOTES#mix-bus;
 *   - peaks: identical;
 *   - longer than one scratch block, so the block streaming is exercised.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkMixBusModule } from '../../tools/check_mix_bus_module.mjs';
import { createNativeMixKernel, jsMixKernel } from '../audio/offline/mixBus/mixBusKernel';

const WASM = join(__dirname, '../../public/mix_bus.wasm');

/** Max |native - js| per sample at a non-unity gain, for |samples| ≤ 1. */
const MIX_BUS_GAIN_EPSILON = 1e-6;

/** Three scratch blocks and change, plus a ragged tail. */
const FRAMES = 3 * 65536 + 1234;

function signal(seed: number, frames = FRAMES): Float32Array {
    const out = new Float32Array(frames);
    let x = seed;
    for (let i = 0; i < frames; i++) {
        x = (x * 1103515245 + 12345) % 2147483648;
        out[i] = (x / 2147483648 - 0.5) * 0.4 + Math.sin(i * 0.001 * seed) * 0.2;
    }
    return out;
}

describe('public/mix_bus.wasm', () => {
    const bytes = new Uint8Array(readFileSync(WASM));

    it('passes the release gate checker', () => {
        expect(checkMixBusModule(bytes)).toEqual([]);
    });

    it('is bit-identical to the JS sum at unity gain', async () => {
        const native = await createNativeMixKernel(bytes);
        const stems = [1, 2, 3, 4, 5].map((seed) => signal(seed));
        const a = new Float32Array(FRAMES);
        const b = new Float32Array(FRAMES);
        for (const stem of stems) {
            native.accumulate(a, stem, 1);
            jsMixKernel.accumulate(b, stem, 1);
        }
        expect(Buffer.from(a.buffer).equals(Buffer.from(b.buffer))).toBe(true);
    });

    it(`stays within ${MIX_BUS_GAIN_EPSILON} of the JS sum at other gains`, async () => {
        const native = await createNativeMixKernel(bytes);
        const a = new Float32Array(FRAMES);
        const b = new Float32Array(FRAMES);
        for (const [seed, gain] of [[7, 0.7], [8, 0.333], [9, 1.25]] as const) {
            native.accumulate(a, signal(seed), gain);
            jsMixKernel.accumulate(b, signal(seed), gain);
        }
        let worst = 0;
        for (let i = 0; i < FRAMES; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
        expect(worst).toBeLessThanOrEqual(MIX_BUS_GAIN_EPSILON);
    });

    it('adds a short source over its own length only', async () => {
        const native = await createNativeMixKernel(bytes);
        const dst = new Float32Array(FRAMES).fill(0.25);
        native.accumulate(dst, new Float32Array(70000).fill(0.5), 1);
        expect(dst[69999]).toBe(0.75);
        expect(dst[70000]).toBe(0.25);
    });

    it('reports the same peak as the JS reference, wherever it falls', async () => {
        const native = await createNativeMixKernel(bytes);
        const buf = signal(11);
        buf[2 * 65536 + 17] = -0.9876;
        expect(native.peak(buf)).toBe(jsMixKernel.peak(buf));
        expect(native.peak(buf)).toBeCloseTo(0.9876, 6);
    });

    it('skips NaN and keeps ±Infinity exactly like the JS reference, in the SIMD body and the tail', async () => {
        // -ffast-math once turned this loop into a NaN-propagating max; the
        // release build returned NaN where JS (and the IEEE debug build) skip it.
        const native = await createNativeMixKernel(bytes);
        for (const length of [1, 3, 4, 5, 65536, 65539]) {
            for (const special of [Number.NaN, Infinity, -Infinity, -0]) {
                for (const at of [0, length >> 1, length - 1]) {
                    const buf = signal(13, length);
                    buf[at] = special;
                    expect(native.peak(buf), `len ${length}, ${special} at ${at}`).toBe(jsMixKernel.peak(buf));
                }
            }
        }
    });
});
