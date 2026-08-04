/**
 * BS.1770-5 / EBU TECH 3341 conformance for the first-party loudness meter.
 *
 * The reference values are the ones published in the recommendations
 * themselves (tone tests, gating cases and the 48 kHz coefficient table), so
 * the DSP is validated against known-good numbers rather than against itself.
 * Tolerances follow TECH 3341: ±0.1 LU.
 */

import { describe, expect, it } from 'vitest';

import { LoudnessMeter, meanSquareToLufs } from '../loudnessMeter';
import { shelfCoefficients, highPassCoefficients } from '../kWeighting';
import { analyzeLoudness } from '../offline';
import { SILENCE_LUFS } from '../types';

const TOLERANCE_LU = 0.1;

/** Stereo sine at `db` dBFS, identical in both channels. */
function stereoSine(
    seconds: number,
    sampleRate: number,
    frequency = 1000,
    db = -20,
): Float32Array[] {
    const frames = Math.round(seconds * sampleRate);
    const amplitude = Math.pow(10, db / 20) * Math.SQRT2; // db is RMS, not peak
    const left = new Float32Array(frames);
    for (let i = 0; i < frames; i += 1) {
        left[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate);
    }
    return [left, Float32Array.from(left)];
}

function silence(seconds: number, sampleRate: number): Float32Array[] {
    const frames = Math.round(seconds * sampleRate);
    return [new Float32Array(frames), new Float32Array(frames)];
}

function concat(...segments: Float32Array[][]): Float32Array[] {
    const channels = segments[0].length;
    const out: Float32Array[] = [];
    for (let ch = 0; ch < channels; ch += 1) {
        const total = segments.reduce((sum, segment) => sum + segment[ch].length, 0);
        const buffer = new Float32Array(total);
        let offset = 0;
        for (const segment of segments) {
            buffer.set(segment[ch], offset);
            offset += segment[ch].length;
        }
        out.push(buffer);
    }
    return out;
}

describe('K-weighting coefficients', () => {
    // ITU-R BS.1770-5 Tables 1 and 2 — the only rate the recommendation tabulates.
    it('matches the tabulated 48 kHz stage 1 (shelving) coefficients', () => {
        const c = shelfCoefficients(48000);
        expect(c.b0).toBeCloseTo(1.53512485958697, 6);
        expect(c.b1).toBeCloseTo(-2.69169618940638, 6);
        expect(c.b2).toBeCloseTo(1.19839281085285, 6);
        expect(c.a1).toBeCloseTo(-1.69065929318241, 6);
        expect(c.a2).toBeCloseTo(0.73248077421585, 6);
    });

    it('matches the tabulated 48 kHz stage 2 (RLB high-pass) coefficients', () => {
        const c = highPassCoefficients(48000);
        expect(c.b0).toBeCloseTo(1.0, 6);
        expect(c.b1).toBeCloseTo(-2.0, 6);
        expect(c.b2).toBeCloseTo(1.0, 6);
        expect(c.a1).toBeCloseTo(-1.99004745483398, 6);
        expect(c.a2).toBeCloseTo(0.99007225036621, 6);
    });

    it('produces different coefficients per sample rate (no hard-coded table)', () => {
        expect(shelfCoefficients(44100).b0).not.toBeCloseTo(shelfCoefficients(48000).b0, 5);
        expect(highPassCoefficients(96000).a1).not.toBeCloseTo(highPassCoefficients(48000).a1, 5);
    });
});

describe('LoudnessMeter — TECH 3341 tone cases', () => {
    // EBU TECH 3341 case 1: -23 LUFS 1 kHz stereo tone reads -23.0 ±0.1.
    it('reads -23 LUFS for a -23 dBFS 1 kHz stereo tone', () => {
        const report = analyzeLoudness(stereoSine(20, 48000, 1000, -26), 48000);
        // -26 dBFS per channel, summed over two channels → -23 LUFS.
        expect(report.integrated).toBeCloseTo(-23.0, 1);
        expect(Math.abs(report.integrated + 23.0)).toBeLessThanOrEqual(TOLERANCE_LU);
    });

    it('reads -33 LUFS for the same tone 10 dB quieter', () => {
        const report = analyzeLoudness(stereoSine(20, 48000, 1000, -36), 48000);
        expect(Math.abs(report.integrated + 33.0)).toBeLessThanOrEqual(TOLERANCE_LU);
    });

    it('agrees between momentary, short-term and integrated on steady tone', () => {
        const meter = new LoudnessMeter({ sampleRate: 48000, channelCount: 2 });
        const [left, right] = stereoSine(10, 48000, 1000, -26);
        meter.process([left, right], left.length);
        expect(Math.abs(meter.momentary + 23)).toBeLessThanOrEqual(TOLERANCE_LU);
        expect(Math.abs(meter.shortTerm + 23)).toBeLessThanOrEqual(TOLERANCE_LU);
        expect(Math.abs(meter.integrated + 23)).toBeLessThanOrEqual(TOLERANCE_LU);
    });

    it('reports silence rather than NaN or -0 for a zero signal', () => {
        const report = analyzeLoudness(silence(5, 48000), 48000);
        expect(report.integrated).toBe(SILENCE_LUFS);
        expect(report.maxMomentary).toBe(SILENCE_LUFS);
        expect(report.truePeak).toBe(SILENCE_LUFS);
    });
});

describe('LoudnessMeter — gating', () => {
    // TECH 3341 case 3: 20 s of -23 LUFS tone padded with -70 LUFS material
    // still reads -23.0 ±0.1 — the pad is below the absolute gate. The 20 s
    // length matters: the six blocks straddling each edge are legitimately part
    // of the measurement, so a shorter tone reads slightly low on any
    // compliant meter.
    it('ignores silence below the absolute gate', () => {
        const loud = stereoSine(20, 48000, 1000, -26);
        const signal = concat(silence(10, 48000), loud, silence(10, 48000));
        const report = analyzeLoudness(signal, 48000);
        expect(Math.abs(report.integrated + 23)).toBeLessThanOrEqual(TOLERANCE_LU);
    });

    // ... and a passage more than 10 LU below the ungated mean must be dropped
    // by the relative gate.
    it('drops blocks below the relative gate', () => {
        const loud = stereoSine(10, 48000, 1000, -26); // -23 LUFS
        const quiet = stereoSine(10, 48000, 1000, -56); // -53 LUFS, > 10 LU down
        const gated = analyzeLoudness(concat(loud, quiet), 48000).integrated;
        const loudOnly = analyzeLoudness(loud, 48000).integrated;
        expect(Math.abs(gated - loudOnly)).toBeLessThanOrEqual(TOLERANCE_LU);
    });

    it('keeps blocks within 10 LU of the mean', () => {
        // -23 and -28 LUFS: both survive gating, so the result sits between them.
        const a = stereoSine(10, 48000, 1000, -26);
        const b = stereoSine(10, 48000, 1000, -31);
        const integrated = analyzeLoudness(concat(a, b), 48000).integrated;
        expect(integrated).toBeLessThan(-23);
        expect(integrated).toBeGreaterThan(-28);
    });

    it('resets the integrated measurement on request without disturbing momentary', () => {
        const meter = new LoudnessMeter({ sampleRate: 48000, channelCount: 2 });
        const quiet = stereoSine(20, 48000, 1000, -46);
        meter.process(quiet, quiet[0].length);
        expect(Math.abs(meter.integrated + 43)).toBeLessThanOrEqual(TOLERANCE_LU);

        meter.resetIntegrated();
        expect(meter.integrated).toBe(SILENCE_LUFS);
        // Momentary keeps running across the reset — the UI must not blink.
        expect(Math.abs(meter.momentary + 43)).toBeLessThanOrEqual(TOLERANCE_LU);

        const loud = stereoSine(20, 48000, 1000, -26);
        meter.process(loud, loud[0].length);
        expect(Math.abs(meter.integrated + 23)).toBeLessThanOrEqual(TOLERANCE_LU);
    });
});

describe('LoudnessMeter — sample rate independence', () => {
    for (const sampleRate of [44100, 48000, 96000]) {
        it(`reads -23 LUFS at ${sampleRate} Hz`, () => {
            const report = analyzeLoudness(stereoSine(12, sampleRate, 1000, -26), sampleRate);
            expect(Math.abs(report.integrated + 23)).toBeLessThanOrEqual(TOLERANCE_LU);
        });
    }

    it('gives the same reading for the same signal at different rates', () => {
        const at44 = analyzeLoudness(stereoSine(12, 44100, 997, -26), 44100).integrated;
        const at96 = analyzeLoudness(stereoSine(12, 96000, 997, -26), 96000).integrated;
        expect(Math.abs(at44 - at96)).toBeLessThanOrEqual(TOLERANCE_LU);
    });
});

describe('LoudnessMeter — robustness', () => {
    it('treats NaN and Infinity as silence instead of poisoning the meter', () => {
        const frames = 48000;
        const left = new Float32Array(frames);
        const right = new Float32Array(frames);
        for (let i = 0; i < frames; i += 1) {
            const value = 0.1 * Math.sin((2 * Math.PI * 1000 * i) / 48000);
            left[i] = i === 12345 ? NaN : value;
            right[i] = i === 20000 ? Infinity : value;
        }
        const report = analyzeLoudness([left, right], 48000);
        expect(Number.isFinite(report.integrated)).toBe(true);
        expect(Number.isFinite(report.truePeak)).toBe(true);
        expect(report.truePeak).toBeLessThan(6);
    });

    it('maps a zero mean square to -Infinity, not NaN', () => {
        expect(meanSquareToLufs(0)).toBe(SILENCE_LUFS);
        expect(meanSquareToLufs(NaN)).toBe(SILENCE_LUFS);
        expect(meanSquareToLufs(-1)).toBe(SILENCE_LUFS);
    });

    it('allocates nothing per render quantum', () => {
        const meter = new LoudnessMeter({ sampleRate: 48000, channelCount: 2 });
        const block = [new Float32Array(128), new Float32Array(128)];
        for (let i = 0; i < 128; i += 1) {
            block[0][i] = 0.25;
            block[1][i] = 0.25;
        }
        const before = countAllocations(() => meter.process(block, 128));
        expect(before).toBe(0);
    });
});

/**
 * Count typed-array constructions performed by `fn`.
 * A real-time DSP path must not allocate on the audio thread.
 */
function countAllocations(fn: () => void): number {
    const constructors: Array<keyof typeof globalThis> = [
        'Float32Array',
        'Float64Array',
        'Int32Array',
        'Array',
    ];
    const originals = constructors.map((name) => [name, globalThis[name]] as const);
    let count = 0;
    for (const [name, original] of originals) {
        const proxy = new Proxy(original as unknown as object, {
            construct(target, args, newTarget) {
                count += 1;
                return Reflect.construct(target as never, args, newTarget);
            },
        });
        (globalThis as Record<string, unknown>)[name as string] = proxy;
    }
    try {
        fn();
    } finally {
        for (const [name, original] of originals) {
            (globalThis as Record<string, unknown>)[name as string] = original;
        }
    }
    return count;
}
