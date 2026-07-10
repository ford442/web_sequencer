import { describe, expect, it } from 'vitest';
import { getStepHitRect, getTrackSlotHitRect } from '../../components/sequencer/stepHitGeometry';

describe('stepHitGeometry', () => {
    it('expands narrow step hit width', () => {
        const hit = getStepHitRect(18, 50);
        expect(hit.width).toBeGreaterThanOrEqual(18);
        expect(hit.height).toBeGreaterThanOrEqual(44);
    });

    it('centers expanded hit rect on visual step', () => {
        const hit = getStepHitRect(18, 50);
        expect(hit.x).toBeLessThan(0);
        expect(hit.y).toBeLessThanOrEqual(0);
    });

    it('expands track slot hit bounds', () => {
        const hit = getTrackSlotHitRect(18, 18);
        expect(hit.width).toBeGreaterThanOrEqual(28);
        expect(hit.height).toBeGreaterThanOrEqual(28);
    });
});
