/**
 * True-peak detection (BS.1770-5 Annex 2 / BS.2217) and brick-wall limiting.
 *
 * The headline case is the fs/4 sine with a 45° phase offset: its samples sit
 * at ±0.7071 while the underlying waveform reaches 1.0, so a compliant meter
 * must report +3.01 dBTP where a sample-peak meter reads 0 dBFS.
 */

import { describe, expect, it } from 'vitest';

import {
    TruePeakDetector,
    buildPolyphaseCoefficients,
    dbToLinear,
    linearToDb,
    measureTruePeakDbtp,
    oversamplingFactorFor,
} from '../truePeak';
import { TruePeakLimiter, MAX_LOOKAHEAD_MS } from '../limiter';
import { DEFAULT_LIMITER_SETTINGS } from '../types';

const TOLERANCE_DB = 0.1;

/**
 * Test tone, optionally with faded edges.
 *
 * The fade matters when a measurement has to be accurate to ±0.1 dB: a buffer
 * that starts or ends mid-cycle is a step discontinuity, and the band-limited
 * reconstruction of a step genuinely overshoots by ~1 dB. The limiter cases
 * below therefore use edges the way real program material has them; the
 * detector cases use raw tones whose exact true peak is known analytically.
 */
function sine(
    frames: number,
    sampleRate: number,
    frequency: number,
    amplitude = 1,
    phase = 0,
    fadeFrames = 0,
): Float32Array {
    const out = new Float32Array(frames);
    for (let i = 0; i < frames; i += 1) {
        const fade = fadeFrames > 0 ? Math.min(1, i / fadeFrames, (frames - i) / fadeFrames) : 1;
        out[i] = fade * amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate + phase);
    }
    return out;
}

function samplePeakDb(channel: Float32Array): number {
    let peak = 0;
    for (const value of channel) {
        const magnitude = Math.abs(value);
        if (magnitude > peak) peak = magnitude;
    }
    return linearToDb(peak);
}

/** Run a signal through the limiter in 128-frame quanta, as the worklet does. */
function runLimiter(
    limiter: TruePeakLimiter,
    channels: Float32Array[],
): Float32Array[] {
    const frames = channels[0].length;
    const output = channels.map(() => new Float32Array(frames));
    const inViews: Float32Array[] = new Array(channels.length);
    const outViews: Float32Array[] = new Array(channels.length);
    for (let offset = 0; offset < frames; offset += 128) {
        const size = Math.min(128, frames - offset);
        for (let ch = 0; ch < channels.length; ch += 1) {
            inViews[ch] = channels[ch].subarray(offset, offset + size);
            outViews[ch] = output[ch].subarray(offset, offset + size);
        }
        limiter.process(inViews, outViews, size);
    }
    return output;
}

describe('polyphase oversampler', () => {
    it('keeps every branch at unit DC gain', () => {
        for (const factor of [2, 4, 8]) {
            for (const branch of buildPolyphaseCoefficients(factor)) {
                const sum = branch.reduce((acc, value) => acc + value, 0);
                expect(sum).toBeCloseTo(1, 5);
            }
        }
    });

    it('oversamples to at least 192 kHz at every supported rate', () => {
        expect(44100 * oversamplingFactorFor(44100)).toBeGreaterThanOrEqual(192000);
        expect(48000 * oversamplingFactorFor(48000)).toBeGreaterThanOrEqual(192000);
        expect(96000 * oversamplingFactorFor(96000)).toBeGreaterThanOrEqual(192000);
        expect(oversamplingFactorFor(48000)).toBe(4);
        expect(oversamplingFactorFor(96000)).toBe(2);
    });

    it('does not invent peaks on steady DC', () => {
        // Measured away from the buffer edges, where the step into DC produces a
        // real (and correctly reported) inter-sample overshoot.
        const detector = new TruePeakDetector(48000);
        for (let i = 0; i < 512; i += 1) detector.processSample(0.5);
        detector.resetPeak();
        for (let i = 0; i < 512; i += 1) detector.processSample(0.5);
        expect(linearToDb(detector.peak)).toBeCloseTo(linearToDb(0.5), 2);
    });
});

describe('true-peak detection', () => {
    it('reports +3.01 dBTP for a 0 dBFS fs/4 sine at 45°', () => {
        const signal = sine(20000, 48000, 12000, 1, Math.PI / 4);
        expect(samplePeakDb(signal)).toBeCloseTo(-3.01, 1);
        const truePeak = measureTruePeakDbtp([signal], 48000);
        expect(Math.abs(truePeak - 0)).toBeLessThanOrEqual(TOLERANCE_DB);
    });

    it('is close to 0 dBTP for a full-scale 997 Hz sine', () => {
        const signal = sine(48000, 48000, 997, 1);
        const truePeak = measureTruePeakDbtp([signal], 48000);
        expect(Math.abs(truePeak)).toBeLessThanOrEqual(TOLERANCE_DB);
    });

    it('beats linear interpolation on high-frequency content', () => {
        const signal = sine(20000, 48000, 12000, 1, Math.PI / 4);
        // Linear interpolation between samples of this signal never exceeds the
        // sample peak, i.e. it misses the ~3 dB of inter-sample energy entirely.
        const linearEstimate = samplePeakDb(signal);
        const truePeak = measureTruePeakDbtp([signal], 48000);
        expect(truePeak - linearEstimate).toBeGreaterThan(2.5);
    });

    it('takes the maximum across channels', () => {
        const quiet = sine(2048, 48000, 997, 0.1);
        const loud = sine(2048, 48000, 997, 0.9);
        expect(measureTruePeakDbtp([quiet, loud], 48000)).toBeCloseTo(
            measureTruePeakDbtp([loud], 48000),
            5,
        );
    });

    it('treats non-finite samples as silence', () => {
        const signal = sine(2048, 48000, 997, 0.5);
        signal[100] = NaN;
        signal[200] = Infinity;
        const truePeak = measureTruePeakDbtp([signal], 48000);
        expect(Number.isFinite(truePeak)).toBe(true);
        expect(truePeak).toBeLessThan(0);
    });

    it('detects nothing above 0 for silence', () => {
        const detector = new TruePeakDetector(48000);
        for (let i = 0; i < 1024; i += 1) detector.processSample(0);
        expect(detector.peak).toBe(0);
    });
});

describe('TruePeakLimiter', () => {
    const sampleRate = 48000;

    it('holds a -1 dBTP ceiling on a hot high-frequency signal', () => {
        const limiter = new TruePeakLimiter(sampleRate, 2, { ceilingDbtp: -1 });
        // Worst-case ISP material: full-scale fs/4 tone at 45°.
        const left = sine(48000, sampleRate, 12000, 1, Math.PI / 4, 2000);
        const right = Float32Array.from(left);
        const output = runLimiter(limiter, [left, right]);

        const truePeak = measureTruePeakDbtp(output, sampleRate, 8);
        expect(truePeak).toBeLessThanOrEqual(-1);
    });

    it('holds the ceiling on a hot broadband transient', () => {
        const limiter = new TruePeakLimiter(sampleRate, 2, { ceilingDbtp: -1 });
        const frames = 48000;
        const left = new Float32Array(frames);
        const right = new Float32Array(frames);
        for (let i = 0; i < frames; i += 1) {
            // Quiet bed with periodic full-scale clicks.
            const fade = Math.min(1, i / 2000, (frames - i) / 2000);
            const bed = 0.2 * Math.sin((2 * Math.PI * 220 * i) / sampleRate);
            const click = i > 4800 && i % 4800 < 8 ? (i % 2 === 0 ? 1 : -1) : 0;
            left[i] = fade * Math.max(-1, Math.min(1, bed + click));
            right[i] = left[i];
        }
        const output = runLimiter(limiter, [left, right]);
        expect(measureTruePeakDbtp(output, sampleRate, 8)).toBeLessThanOrEqual(-1);
    });

    it('honours a louder ceiling too', () => {
        const limiter = new TruePeakLimiter(sampleRate, 2, { ceilingDbtp: -3 });
        const signal = sine(24000, sampleRate, 8000, 1, Math.PI / 4, 2000);
        const output = runLimiter(limiter, [signal, Float32Array.from(signal)]);
        expect(measureTruePeakDbtp(output, sampleRate, 8)).toBeLessThanOrEqual(-3);
    });

    it('leaves signals below the ceiling untouched apart from the latency delay', () => {
        const limiter = new TruePeakLimiter(sampleRate, 2, { ceilingDbtp: -1 });
        const signal = sine(8192, sampleRate, 440, 0.25);
        const output = runLimiter(limiter, [signal, Float32Array.from(signal)]);

        const delay = Math.round(limiter.latencySeconds * sampleRate);
        expect(delay).toBeGreaterThan(0);
        for (let i = delay; i < 8192; i += 1) {
            expect(output[0][i]).toBeCloseTo(signal[i - delay], 5);
        }
        expect(limiter.takeStats().gainReductionDb).toBe(0);
    });

    it('passes audio through unchanged when bypassed', () => {
        const limiter = new TruePeakLimiter(sampleRate, 2, { enabled: false });
        const signal = sine(2048, sampleRate, 12000, 1, Math.PI / 4);
        const output = runLimiter(limiter, [signal, Float32Array.from(signal)]);
        expect(limiter.latencySeconds).toBe(0);
        for (let i = 0; i < signal.length; i += 1) {
            expect(output[0][i]).toBe(signal[i]);
        }
    });

    it('monitor-only mode is zero latency and clamps in the sample domain', () => {
        const limiter = new TruePeakLimiter(sampleRate, 2, {
            monitorOnly: true,
            ceilingDbtp: -6,
        });
        expect(limiter.latencySeconds).toBe(0);

        const signal = sine(2048, sampleRate, 997, 1);
        const output = runLimiter(limiter, [signal, Float32Array.from(signal)]);
        const ceiling = dbToLinear(-6);
        for (const value of output[0]) {
            expect(Math.abs(value)).toBeLessThanOrEqual(ceiling + 1e-6);
        }
        expect(limiter.takeStats().clipped).toBe(true);
    });

    it('reports gain reduction while limiting and clears it after reading', () => {
        const limiter = new TruePeakLimiter(sampleRate, 2, { ceilingDbtp: -6 });
        const signal = sine(24000, sampleRate, 997, 1, 0, 2000);
        runLimiter(limiter, [signal, Float32Array.from(signal)]);

        const stats = limiter.takeStats();
        expect(stats.gainReductionDb).toBeLessThan(-4);
        expect(limiter.takeStats().gainReductionDb).toBe(0);
    });

    it('reports lookahead as monitor latency and clamps absurd requests', () => {
        const limiter = new TruePeakLimiter(sampleRate, 2, { lookaheadMs: 1.5 });
        const lookaheadFrames = Math.round((1.5 / 1000) * sampleRate);
        // Latency is lookahead plus the detector's group delay.
        expect(limiter.latencySeconds * sampleRate).toBeGreaterThanOrEqual(lookaheadFrames);
        expect(limiter.latencySeconds).toBeLessThan((MAX_LOOKAHEAD_MS + 1) / 1000);

        limiter.setSettings({ lookaheadMs: 1000 });
        expect(limiter.latencySeconds).toBeLessThanOrEqual((MAX_LOOKAHEAD_MS + 1) / 1000);
    });

    it('survives NaN input without muting or latching the master', () => {
        const limiter = new TruePeakLimiter(sampleRate, 2);
        const signal = sine(8192, sampleRate, 440, 0.5);
        signal[1000] = NaN;
        signal[1001] = Infinity;
        const output = runLimiter(limiter, [signal, Float32Array.from(signal)]);
        for (const value of output[0]) {
            expect(Number.isFinite(value)).toBe(true);
        }
        // Audio after the glitch is still passing.
        const tail = output[0].subarray(4096);
        expect(Math.max(...tail)).toBeGreaterThan(0.1);
    });

    it('allocates nothing per render quantum', () => {
        const limiter = new TruePeakLimiter(sampleRate, 2, DEFAULT_LIMITER_SETTINGS);
        const input = [new Float32Array(128), new Float32Array(128)];
        const output = [new Float32Array(128), new Float32Array(128)];
        for (let i = 0; i < 128; i += 1) {
            input[0][i] = Math.sin(i);
            input[1][i] = Math.sin(i);
        }
        limiter.process(input, output, 128); // warm up

        let allocations = 0;
        const originals: Array<[string, unknown]> = [];
        for (const name of ['Float32Array', 'Float64Array', 'Int32Array', 'Array']) {
            const original = (globalThis as Record<string, unknown>)[name];
            originals.push([name, original]);
            (globalThis as Record<string, unknown>)[name] = new Proxy(original as object, {
                construct(target, args, newTarget) {
                    allocations += 1;
                    return Reflect.construct(target as never, args, newTarget);
                },
            });
        }
        try {
            limiter.process(input, output, 128);
        } finally {
            for (const [name, original] of originals) {
                (globalThis as Record<string, unknown>)[name] = original;
            }
        }
        expect(allocations).toBe(0);
    });
});
