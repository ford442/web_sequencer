/**
 * The `wgsl-*` band plan and the additive kernel's math (#1668).
 *
 * WebGPU does not run under jsdom, so the kernel is mirrored here in TS with
 * the same u32 wrapping arithmetic (`Math.imul`/`>>> 0`) and checked for the
 * three properties the rewrite exists for: no harmonic past Nyquist anywhere a
 * band is played, a seamless loop, and exact pitch. `WebGpuOscillator.test.ts`
 * checks the shader source keeps the same series and shape indices.
 */

import { describe, expect, it } from 'vitest';
import type { WaveShape } from '../../../utils/waveformParser';
import {
    MAX_HARMONICS,
    SHAPE_INDEX,
    WAVETABLE_LENGTH,
    maxHarmonicFor,
    phaseIncrementFor,
    planWavetableBands,
    selectWavetableBand,
    type WavetableBand,
} from '../wavetableBands';

const TWO_32 = 2 ** 32;
const SHAPES: WaveShape[] = ['saw', 'sqr', 'tri', 'sin'];

/** Mirror of the WGSL `main` for one sample — same series, same u32 wrapping. */
function kernelSample(index: number, inc: number, harmonics: number, shape: WaveShape): number {
    const p1 = Math.imul(index, inc) >>> 0;
    const rad = (p: number) => (p / TWO_32) * 2 * Math.PI;
    let sum = 0;
    switch (SHAPE_INDEX[shape]) {
        case 0: {
            let ph = p1;
            for (let h = 1; h <= harmonics; h++) {
                sum += Math.sin(rad(ph)) / h;
                ph = (ph + p1) >>> 0;
            }
            return sum * (-2 / Math.PI);
        }
        case 1: {
            let ph = p1;
            const step = Math.imul(p1, 2) >>> 0;
            for (let h = 1; h <= harmonics; h += 2) {
                sum += Math.sin(rad(ph)) / h;
                ph = (ph + step) >>> 0;
            }
            return sum * (4 / Math.PI);
        }
        case 2: {
            let ph = p1;
            const step = Math.imul(p1, 2) >>> 0;
            for (let h = 1; h <= harmonics; h += 2) {
                sum += Math.cos(rad(ph)) / (h * h);
                ph = (ph + step) >>> 0;
            }
            return sum * (8 / (Math.PI * Math.PI));
        }
        default:
            return harmonics >= 1 ? Math.sin(rad(p1)) : 0;
    }
}

function renderTable(band: WavetableBand, shape: WaveShape, length = WAVETABLE_LENGTH): Float64Array {
    const out = new Float64Array(length);
    for (let i = 0; i < length; i++) out[i] = kernelSample(i, band.phaseIncrement, band.maxHarmonic, shape);
    return out;
}

/** Magnitude of DFT bin `k` (direct sum — only a handful of bins are probed). */
function binMagnitude(x: Float64Array, k: number): number {
    let re = 0;
    let im = 0;
    const n = x.length;
    for (let i = 0; i < n; i++) {
        const a = (2 * Math.PI * k * i) / n;
        re += x[i] * Math.cos(a);
        im -= x[i] * Math.sin(a);
    }
    return Math.hypot(re, im) / (n / 2);
}

function naive(shape: WaveShape, phase: number): number {
    const p = phase - Math.floor(phase);
    switch (shape) {
        case 'saw':
            return 2 * p - 1;
        case 'sqr':
            return p < 0.5 ? 1 : -1;
        case 'tri':
            return 2 * Math.abs(2 * p - 1) - 1;
        case 'sin':
            return Math.sin(2 * Math.PI * p);
    }
}

describe('planWavetableBands', () => {
    it.each([22050, 44100, 48000, 96000, 192000])('is a valid octave plan at %i Hz', (sr) => {
        const bands = planWavetableBands(sr);
        const nyquist = sr / 2;
        expect(bands.length).toBeGreaterThan(4);
        // Fits the kernel's uniform block with every shape.
        expect(bands.length * SHAPES.length).toBeLessThanOrEqual(64);

        for (let i = 0; i < bands.length; i++) {
            const b = bands[i];
            // Whole cycles, exact base, exact fixed-point increment.
            expect(Number.isInteger(b.cycles)).toBe(true);
            expect(b.baseFrequency).toBe((b.cycles * sr) / WAVETABLE_LENGTH);
            expect(b.phaseIncrement * WAVETABLE_LENGTH).toBe(b.cycles * TWO_32);
            expect(b.maxHarmonic).toBeGreaterThanOrEqual(1);
            expect(b.maxHarmonic).toBeLessThanOrEqual(MAX_HARMONICS);
            if (i > 0) expect(b.baseFrequency).toBeGreaterThan(bands[i - 1].baseFrequency);
            // Highest harmonic stays under Nyquist all the way to the next band.
            if (i + 1 < bands.length) {
                expect(b.maxHarmonic * bands[i + 1].baseFrequency).toBeLessThanOrEqual(nyquist);
                // …and the band is not needlessly dull: one more harmonic would not fit.
                if (b.maxHarmonic < MAX_HARMONICS) {
                    expect((b.maxHarmonic + 1) * bands[i + 1].baseFrequency).toBeGreaterThan(nyquist);
                }
            }
        }
        // The last band is a sine, so it is safe for every pitch above it.
        expect(bands[bands.length - 1].maxHarmonic).toBe(1);
    });

    it('rejects a table length that would make the phase increment inexact', () => {
        expect(() => planWavetableBands(48000, 4000)).toThrow(/power of two/);
        expect(planWavetableBands(0)).toEqual([]);
        expect(planWavetableBands(Number.NaN)).toEqual([]);
    });
});

describe('selectWavetableBand', () => {
    const sr = 48000;
    const bands = planWavetableBands(sr);

    it('never puts a harmonic over Nyquist for any playable pitch', () => {
        for (let midi = 12; midi <= 127; midi++) {
            const f = 440 * 2 ** ((midi - 69) / 12);
            const band = bands[selectWavetableBand(bands, f)];
            // Played at playbackRate f / base, harmonic h sounds at h * f.
            expect(band.maxHarmonic * f).toBeLessThanOrEqual(sr / 2);
        }
    });

    it('picks the highest band whose base is at or under the pitch', () => {
        expect(selectWavetableBand(bands, 1)).toBe(0);
        expect(selectWavetableBand(bands, bands[3].baseFrequency)).toBe(3);
        expect(selectWavetableBand(bands, bands[3].baseFrequency - 0.01)).toBe(2);
        expect(selectWavetableBand(bands, 1e9)).toBe(bands.length - 1);
        expect(selectWavetableBand(bands, Number.NaN)).toBe(0);
        expect(selectWavetableBand([], 440)).toBe(-1);
    });
});

describe('additive kernel (TS mirror of the WGSL)', () => {
    const sr = 48000;
    const bands = planWavetableBands(sr);

    it.each(SHAPES)('%s: loops without a seam — sample `length` is sample 0', (shape) => {
        for (const band of [bands[0], bands[4], bands[bands.length - 1]]) {
            const first = kernelSample(0, band.phaseIncrement, band.maxHarmonic, shape);
            const wrapped = kernelSample(WAVETABLE_LENGTH, band.phaseIncrement, band.maxHarmonic, shape);
            expect(wrapped).toBe(first);
        }
    });

    it.each(SHAPES)('%s: energy only on harmonics ≤ maxHarmonic, at the planned pitch', (shape) => {
        const band = bands[5];
        const x = renderTable(band, shape);
        const fundamental = binMagnitude(x, band.cycles);
        expect(fundamental).toBeGreaterThan(0.5);
        // Off-harmonic bins (between harmonics) are empty: the pitch is exact.
        expect(binMagnitude(x, band.cycles + 1)).toBeLessThan(1e-9);
        // The first harmonic past the band limit is empty.
        expect(binMagnitude(x, band.cycles * (band.maxHarmonic + 1))).toBeLessThan(1e-9);
        expect(binMagnitude(x, band.cycles * (band.maxHarmonic + 2))).toBeLessThan(1e-9);
    });

    it.each(SHAPES)('%s: same level and polarity as the naive shape it replaces', (shape) => {
        const band = bands[2]; // ~100 Hz: plenty of harmonics
        const x = renderTable(band, shape);
        let dot = 0;
        let nx = 0;
        let ny = 0;
        let peak = 0;
        for (let i = 0; i < x.length; i++) {
            const y = naive(shape, (i * band.cycles) / x.length);
            dot += x[i] * y;
            nx += x[i] * x[i];
            ny += y * y;
            peak = Math.max(peak, Math.abs(x[i]));
        }
        expect(dot / Math.sqrt(nx * ny)).toBeGreaterThan(0.99);
        // Gibbs overshoot on the edges is ~9%; nothing wilder.
        expect(peak).toBeLessThan(1.2);
        expect(peak).toBeGreaterThan(0.95);
    });

    it('offline pitch: increment rounding is well under a hundredth of a cent', () => {
        for (const f of [27.5, 261.63, 440, 4186]) {
            const inc = phaseIncrementFor(f, sr)!;
            const actual = (inc / TWO_32) * sr;
            expect(Math.abs(1200 * Math.log2(actual / f))).toBeLessThan(1e-3);
        }
        expect(phaseIncrementFor(sr / 2, sr)).toBeNull();
        expect(phaseIncrementFor(0, sr)).toBeNull();
        expect(phaseIncrementFor(Number.NaN, sr)).toBeNull();
        expect(maxHarmonicFor(440, sr)).toBe(54);
        expect(maxHarmonicFor(1, sr)).toBe(MAX_HARMONICS);
    });

    it('fixed-point phase does not drift over a long offline render', () => {
        // 5 s of 440 Hz: the f32 `t * f` phase the old kernel used is ~2200
        // cycles in, where f32 resolution is ~1e-4 cycle. The u32 phase is exact.
        const inc = phaseIncrementFor(440, sr)!;
        const n = sr * 5;
        const phase = (Math.imul(n, inc) >>> 0) / TWO_32;
        const ideal = ((n * inc) % TWO_32) / TWO_32;
        expect(phase).toBe(ideal);
    });
});
