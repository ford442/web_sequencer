/**
 * Offline export path: loudness reporting, normalisation, live-vs-file parity.
 */

import { describe, expect, it } from 'vitest';

import { analyzeLoudness, normalizeToTarget, formatLufs } from '../offline';
import { LoudnessMeter } from '../loudnessMeter';
import { TruePeakLimiter } from '../limiter';
import { measureTruePeakDbtp } from '../truePeak';
import { LOUDNESS_TARGETS, SILENCE_LUFS } from '../types';
import {
    loadLimiterSettings,
    saveLimiterSettings,
    sanitizeLimiterSettings,
    LIMITER_STORAGE_KEY,
} from '../settings';
import { DEFAULT_LIMITER_SETTINGS } from '../types';

const SAMPLE_RATE = 48000;

/** Pseudo-music: a few partials plus transients, deterministic across runs. */
function mixdown(seconds: number, sampleRate = SAMPLE_RATE, amplitude = 0.5): Float32Array[] {
    const frames = Math.round(seconds * sampleRate);
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    let seed = 12345;
    for (let i = 0; i < frames; i += 1) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        const noise = (seed / 0x7fffffff) * 2 - 1;
        const fade = Math.min(1, i / 2000, (frames - i) / 2000);
        const tone =
            0.6 * Math.sin((2 * Math.PI * 110 * i) / sampleRate) +
            0.3 * Math.sin((2 * Math.PI * 440 * i) / sampleRate) +
            0.1 * Math.sin((2 * Math.PI * 3000 * i) / sampleRate);
        const transient = i % 12000 < 32 ? 0.8 * noise : 0.02 * noise;
        left[i] = fade * amplitude * (tone + transient);
        right[i] = fade * amplitude * (tone - transient);
    }
    return [left, right];
}

describe('offline loudness report', () => {
    it('reports integrated loudness, true peak and sample peak', () => {
        const report = analyzeLoudness(mixdown(6), SAMPLE_RATE);
        expect(Number.isFinite(report.integrated)).toBe(true);
        expect(report.truePeak).toBeGreaterThanOrEqual(report.samplePeak - 0.01);
        expect(report.maxShortTerm).toBeGreaterThanOrEqual(report.integrated - 5);
        expect(report.maxMomentary).toBeGreaterThanOrEqual(report.maxShortTerm - 5);
    });

    it('formats silence readably', () => {
        expect(formatLufs(SILENCE_LUFS)).toBe('-inf');
        expect(formatLufs(-13.94)).toBe('-13.9');
    });
});

describe('live vs offline parity', () => {
    // The worklet and the export path run the same DSP, so a mix limited in
    // 128-frame quanta must measure the same as the offline analysis of the
    // rendered result.
    it('matches within 0.1 LU and 0.1 dBTP', () => {
        const source = mixdown(8);

        // "Live": limit in render quanta, metering the limiter output.
        const limiter = new TruePeakLimiter(SAMPLE_RATE, 2, { ceilingDbtp: -1 });
        const meter = new LoudnessMeter({ sampleRate: SAMPLE_RATE, channelCount: 2 });
        const rendered = source.map((channel) => new Float32Array(channel.length));
        const inViews: Float32Array[] = [];
        const outViews: Float32Array[] = [];
        for (let offset = 0; offset < source[0].length; offset += 128) {
            const size = Math.min(128, source[0].length - offset);
            for (let ch = 0; ch < 2; ch += 1) {
                inViews[ch] = source[ch].subarray(offset, offset + size);
                outViews[ch] = rendered[ch].subarray(offset, offset + size);
            }
            limiter.process(inViews, outViews, size);
            meter.process(outViews, size);
        }

        // "File": analyse the rendered buffer in one pass.
        const offline = analyzeLoudness(rendered, SAMPLE_RATE);
        expect(Math.abs(offline.integrated - meter.integrated)).toBeLessThanOrEqual(0.1);
        expect(Math.abs(offline.truePeak - meter.truePeakDb)).toBeLessThanOrEqual(0.1);
    });
});

describe('normalizeToTarget', () => {
    it('brings a quiet mix up to the streaming target', () => {
        const channels = mixdown(8, SAMPLE_RATE, 0.05);
        const result = normalizeToTarget(channels, SAMPLE_RATE, 'streaming');
        expect(result.targetLufs).toBe(LOUDNESS_TARGETS.streaming);
        expect(result.appliedGain).toBeGreaterThan(1);
        expect(Math.abs(result.resultingIntegrated - LOUDNESS_TARGETS.streaming)).toBeLessThan(1);
    });

    it('brings a hot mix down and keeps the ceiling', () => {
        const channels = mixdown(8, SAMPLE_RATE, 0.9);
        const result = normalizeToTarget(channels, SAMPLE_RATE, -23, { ceilingDbtp: -1 });
        expect(result.appliedGain).toBeLessThan(1);
        expect(Math.abs(result.resultingIntegrated + 23)).toBeLessThan(1);
        expect(measureTruePeakDbtp(channels, SAMPLE_RATE, 8)).toBeLessThanOrEqual(-1);
    });

    it('accepts a numeric target and reports what was actually achieved', () => {
        const channels = mixdown(6, SAMPLE_RATE, 0.4);
        const result = normalizeToTarget(channels, SAMPLE_RATE, LOUDNESS_TARGETS.club, {
            ceilingDbtp: -1,
        });
        expect(result.targetLufs).toBe(-9);
        // A -9 LUFS target under a -1 dBTP ceiling may fall short; the caller is
        // told the truth rather than being left to assume the target was met.
        expect(result.resultingIntegrated).toBeLessThanOrEqual(-9 + 0.5);
        expect(measureTruePeakDbtp(channels, SAMPLE_RATE, 8)).toBeLessThanOrEqual(-1);
    });

    it('leaves silence alone instead of applying infinite gain', () => {
        const channels = [new Float32Array(48000), new Float32Array(48000)];
        const result = normalizeToTarget(channels, SAMPLE_RATE, 'streaming');
        expect(result.appliedGain).toBe(1);
        expect(channels[0].every((value) => value === 0)).toBe(true);
    });
});

describe('limiter settings persistence', () => {
    it('round-trips through storage as primitives only', () => {
        const store = new Map<string, string>();
        const storage = {
            getItem: (key: string) => store.get(key) ?? null,
            setItem: (key: string, value: string) => store.set(key, value),
        } as unknown as Storage;

        saveLimiterSettings({ ...DEFAULT_LIMITER_SETTINGS, ceilingDbtp: -2.5 }, storage);
        const raw = store.get(LIMITER_STORAGE_KEY)!;
        const parsed = JSON.parse(raw);
        for (const value of Object.values(parsed)) {
            expect(['number', 'boolean']).toContain(typeof value);
        }
        expect(loadLimiterSettings(storage).ceilingDbtp).toBe(-2.5);
    });

    it('falls back to defaults on corrupted or hostile values', () => {
        expect(sanitizeLimiterSettings(null)).toEqual(DEFAULT_LIMITER_SETTINGS);
        expect(sanitizeLimiterSettings({ ceilingDbtp: NaN }).ceilingDbtp).toBe(
            DEFAULT_LIMITER_SETTINGS.ceilingDbtp,
        );
        expect(sanitizeLimiterSettings({ ceilingDbtp: 40 }).ceilingDbtp).toBe(
            DEFAULT_LIMITER_SETTINGS.ceilingDbtp,
        );
        expect(sanitizeLimiterSettings({ lookaheadMs: -5 }).lookaheadMs).toBe(
            DEFAULT_LIMITER_SETTINGS.lookaheadMs,
        );
        expect(sanitizeLimiterSettings({ enabled: 'yes' }).enabled).toBe(
            DEFAULT_LIMITER_SETTINGS.enabled,
        );
    });

    it('survives a storage backend that throws', () => {
        const hostile = {
            getItem: () => {
                throw new Error('denied');
            },
            setItem: () => {
                throw new Error('quota');
            },
        } as unknown as Storage;
        expect(loadLimiterSettings(hostile)).toEqual(DEFAULT_LIMITER_SETTINGS);
        expect(() => saveLimiterSettings(DEFAULT_LIMITER_SETTINGS, hostile)).not.toThrow();
    });
});
