import { describe, expect, it } from 'vitest';
import { COMPACT_DEFAULT_ZOOM, MIN_TOUCH_TARGET_PX, stepPitchPx } from '../stepHitGeometry';

describe('compact / touch step size', () => {
    it('opens a step at least 32px wide so a finger lands on one step', () => {
        expect(stepPitchPx(COMPACT_DEFAULT_ZOOM)).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
    });

    it('does not open so large that the timeline leaves the first screen', () => {
        expect(stepPitchPx(COMPACT_DEFAULT_ZOOM)).toBeLessThan(40);
    });

    it('matches the stock layout at zoom 1 (22 units per step at 1 unit per px)', () => {
        expect(stepPitchPx(1)).toBeCloseTo(22, 5);
    });
});
