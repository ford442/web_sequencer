import { describe, expect, it } from 'vitest';
import { fitSequencerLayout } from '../sequencerFit';

describe('fitSequencerLayout', () => {
    it('is null until the panel has been measured', () => {
        expect(fitSequencerLayout({ columns: 32, zoom: 1, availWidth: 0, availHeight: 0 })).toBeNull();
    });

    it('fills the panel at zoom 1 with a uniform scale', () => {
        const fit = fitSequencerLayout({ columns: 32, zoom: 1, availWidth: 968, availHeight: 384 })!;
        expect(fit.cssWidth).toBeCloseTo(968);
        expect(fit.cssHeight).toBe(384);
        // Uniform: px-per-unit is the same on both axes, so nothing is letterboxed.
        expect(fit.cssWidth / fit.viewBoxWidth).toBeCloseTo(fit.cssHeight / fit.viewBoxHeight, 5);
        expect(fit.scrollY).toBe(false);
    });

    it('lays the 8 rows out inside the viewBox', () => {
        const fit = fitSequencerLayout({ columns: 32, zoom: 1, availWidth: 968, availHeight: 384 })!;
        const lastRowBottom = 40 + 7 * fit.rowPitch + fit.stepScaleY * 50;
        expect(lastRowBottom).toBeLessThanOrEqual(fit.viewBoxHeight);
    });

    it('gives rows more room on a taller panel, up to a cap', () => {
        const short = fitSequencerLayout({ columns: 32, zoom: 1, availWidth: 968, availHeight: 384 })!;
        const tall = fitSequencerLayout({ columns: 32, zoom: 1, availWidth: 968, availHeight: 600 })!;
        const huge = fitSequencerLayout({ columns: 32, zoom: 1, availWidth: 968, availHeight: 4000 })!;
        expect(tall.rowPitch).toBeGreaterThan(short.rowPitch);
        expect(huge.rowPitch).toBeLessThanOrEqual(84);
        expect(huge.scrollY).toBe(false);
    });

    it('scrolls vertically instead of crushing rows below the minimum pitch', () => {
        const fit = fitSequencerLayout({ columns: 32, zoom: 1, availWidth: 968, availHeight: 120 })!;
        expect(fit.rowPitch).toBe(36);
        expect(fit.scrollY).toBe(true);
        expect(fit.cssHeight).toBeGreaterThan(120);
    });

    it('zooming in widens past the panel; zooming out stays inside it', () => {
        const out = fitSequencerLayout({ columns: 32, zoom: 0.5, availWidth: 968, availHeight: 384 })!;
        const zin = fitSequencerLayout({ columns: 32, zoom: 2, availWidth: 968, availHeight: 384 })!;
        expect(out.cssWidth).toBeLessThan(968);
        expect(zin.cssWidth).toBeGreaterThan(968);
    });

    it('keeps steps usably wide on long patterns by scrolling sideways', () => {
        const fit = fitSequencerLayout({ columns: 128, zoom: 1, availWidth: 968, availHeight: 384 })!;
        expect(fit.cssWidth / fit.viewBoxWidth).toBeGreaterThanOrEqual(0.8);
        expect(fit.cssWidth).toBeGreaterThan(968);
    });
});
