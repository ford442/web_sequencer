import { describe, expect, it } from 'vitest';
import { buildKnobCapLayers } from '../../knobCapRender';
import { buildKnobShaderCode } from '../../KnobGPUContext';
import {
    KNOB_MATERIAL,
    KNOB_MATERIAL_CAP_DARK,
    KNOB_MATERIAL_CHASSIS,
    knobCapMaterialForSurface,
    resolveKnobCap,
    resolveKnobLighting,
    type Rgb,
} from '../../knobMaterial';

const DIMS = { w: 100, h: 100 };

/** WCAG relative luminance. */
function luminance({ r, g, b }: Rgb): number {
    const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(a: Rgb, b: Rgb): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

describe('cap materials per surface (#1581 §6)', () => {
    it('picks the cap material by panel surface', () => {
        expect(knobCapMaterialForSurface('light')).toBe(KNOB_MATERIAL_CHASSIS);
        expect(knobCapMaterialForSurface('dark')).toBe(KNOB_MATERIAL_CAP_DARK);
        expect(KNOB_MATERIAL_CAP_DARK.id).not.toBe(KNOB_MATERIAL_CHASSIS.id);
    });

    it('dark cap ticks read on the dark legacy panel background', () => {
        const bg = KNOB_MATERIAL.palette.background;
        expect(contrast(KNOB_MATERIAL_CAP_DARK.palette.scaleMajor, bg)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(KNOB_MATERIAL_CAP_DARK.palette.scaleMinor, bg)).toBeGreaterThanOrEqual(3);
        // ...which the white-chassis ticks do not.
        expect(contrast(KNOB_MATERIAL_CHASSIS.palette.scaleMajor, bg)).toBeLessThan(3);
    });

    it('dark cap has a brighter rim and a subtler shadow than the white chassis', () => {
        const dark = resolveKnobCap(KNOB_MATERIAL_CAP_DARK)!;
        const light = resolveKnobCap(KNOB_MATERIAL_CHASSIS)!;
        expect(dark.rimHighlight).toBeGreaterThan(light.rimHighlight);
        const ds = resolveKnobLighting(KNOB_MATERIAL_CAP_DARK).dropShadow;
        const ls = resolveKnobLighting(KNOB_MATERIAL_CHASSIS).dropShadow;
        expect(ds.offsetY).toBeLessThan(ls.offsetY);
        expect(ds.blur).toBeLessThan(ls.blur);
    });

    it('rim highlight defaults to 0.12, clamps, and 0 disables it in Canvas 2D', () => {
        expect(resolveKnobCap(KNOB_MATERIAL_CHASSIS)!.rimHighlight).toBe(0.12);
        const over = { ...KNOB_MATERIAL_CHASSIS, cap: { ...KNOB_MATERIAL_CHASSIS.cap!, rimHighlight: 3 } };
        expect(resolveKnobCap(over)!.rimHighlight).toBe(1);

        const rimStroke = (alpha: number) => (c: { op: string; value?: unknown }) =>
            c.op === 'strokeStyle' && c.value === `rgba(255, 255, 255, ${alpha.toFixed(3)})`;
        const withRim = buildKnobCapLayers(KNOB_MATERIAL_CAP_DARK, 0.5, DIMS)!.staticLayer;
        expect(withRim.some(rimStroke(0.2))).toBe(true);

        const off = { ...KNOB_MATERIAL_CAP_DARK, cap: { ...KNOB_MATERIAL_CAP_DARK.cap!, rimHighlight: 0 } };
        const noRim = buildKnobCapLayers(off, 0.5, DIMS)!.staticLayer;
        expect(noRim.length).toBeLessThan(withRim.length);
    });

    it('rim stays in the cacheable static layer', () => {
        const a = buildKnobCapLayers(KNOB_MATERIAL_CAP_DARK, 0.1, DIMS)!;
        const b = buildKnobCapLayers(KNOB_MATERIAL_CAP_DARK, 0.9, DIMS)!;
        expect(a.staticLayer).toEqual(b.staticLayer);
    });

    it('dark cap WGSL interpolates its own palette and rim', () => {
        const shader = buildKnobShaderCode(KNOB_MATERIAL_CAP_DARK);
        expect(shader).toContain('vec3f(0.2000 * (1.0 - smoothstep(0.0, px, rim_d)))');
        expect(shader).toContain('vec3f(0.0800, 0.0800, 0.0900)'); // cap body
        expect(shader).not.toBe(buildKnobShaderCode(KNOB_MATERIAL_CHASSIS));
        expect(shader).not.toMatch(/NaN|undefined|Infinity/);
    });
});
