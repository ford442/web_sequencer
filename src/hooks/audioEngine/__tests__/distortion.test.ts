import { describe, expect, it } from 'vitest';
import { makeDistortionCurve } from '../distortion';

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
