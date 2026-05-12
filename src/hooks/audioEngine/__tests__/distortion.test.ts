import { describe, expect, it } from 'vitest';
import { makeDistortionCurve, makeLimiterCurve } from '../distortion';

const sampleCount = 8192;

describe('makeDistortionCurve', () => {
    it('reuses cached curves for equivalent rounded amounts', () => {
        const firstCurve = makeDistortionCurve(12.34);
        const secondCurve = makeDistortionCurve(12.3);

        expect(secondCurve).toBe(firstCurve);
        expect(firstCurve).toHaveLength(8192);
    });

    it('creates different curves for different rounded amounts', () => {
        expect(makeDistortionCurve(12.3)).not.toBe(makeDistortionCurve(12.5));
    });
});

describe('makeLimiterCurve', () => {
    it('passes through values below threshold with threshold=0.95', () => {
        const threshold = 0.95;
        const curve = makeLimiterCurve(threshold);
        // Exact index where x = 0.5: i = (0.5 + 1) * 8192 / 2 = 6144
        const i = 6144;
        const x = (i * 2) / sampleCount - 1;
        expect(x).toBe(0.5);
        expect(curve[i]).toBeCloseTo(x / threshold, 5);
    });

    it('outputs exactly 1.0 at the threshold with threshold=0.95', () => {
        const threshold = 0.95;
        const curve = makeLimiterCurve(threshold);
        // First index where x >= 0.95: i = 7988
        const i = 7988;
        const x = (i * 2) / sampleCount - 1;
        expect(x).toBeGreaterThanOrEqual(threshold);
        expect(curve[i]).toBe(1.0);
    });

    it('hard-clips at 1.0 for x=1.0 with threshold=0.95', () => {
        const curve = makeLimiterCurve(0.95);
        const i = sampleCount - 1; // 8191 -> x ≈ 0.99976, which is > threshold
        expect(curve[i]).toBe(1.0);
    });

    it('is linear when threshold=1.0 (limiter fully open)', () => {
        const threshold = 1.0;
        const curve = makeLimiterCurve(threshold);
        // Spot-check a few points: output should equal input
        const checks = [0, 2048, 4096, 6144, 7000, 8191];
        for (const i of checks) {
            const x = (i * 2) / sampleCount - 1;
            expect(curve[i]).toBeCloseTo(x, 5);
        }
    });
});
