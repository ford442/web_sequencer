import { describe, it, expect } from 'vitest';
import { computeRms } from '../hooks/useLevelMeter';

describe('computeRms', () => {
    it('returns 0 for an empty array', () => {
        expect(computeRms(new Float32Array(0))).toBe(0);
    });

    it('returns 0 for all-zero samples', () => {
        expect(computeRms(new Float32Array(256))).toBe(0);
    });

    it('returns 1 for all-ones samples (max amplitude)', () => {
        const buf = new Float32Array(128).fill(1);
        expect(computeRms(buf)).toBeCloseTo(1, 5);
    });

    it('RMS of a full-scale square wave (±1) is 1.0', () => {
        const buf = new Float32Array(16);
        for (let i = 0; i < 16; i++) buf[i] = i % 2 === 0 ? 1 : -1;
        expect(computeRms(buf)).toBeCloseTo(1, 5);
    });

    it('RMS of a full-scale sine wave is 1/sqrt(2) ≈ 0.7071', () => {
        const n = 1024;
        const buf = new Float32Array(n);
        for (let i = 0; i < n; i++) buf[i] = Math.sin((2 * Math.PI * i) / n);
        expect(computeRms(buf)).toBeCloseTo(1 / Math.sqrt(2), 2);
    });

    it('scales linearly with amplitude (half amplitude → half RMS)', () => {
        const n = 512;
        const full = new Float32Array(n);
        const half = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            full[i] = Math.sin((2 * Math.PI * i) / n);
            half[i] = full[i] * 0.5;
        }
        expect(computeRms(half)).toBeCloseTo(computeRms(full) * 0.5, 4);
    });

    it('is always non-negative regardless of sign of samples', () => {
        const neg = new Float32Array(64).fill(-0.8);
        expect(computeRms(neg)).toBeGreaterThan(0);
    });

    it('returns a number, never NaN or Infinity', () => {
        const buf = new Float32Array(64).fill(0.5);
        const result = computeRms(buf);
        expect(Number.isFinite(result)).toBe(true);
    });
});
