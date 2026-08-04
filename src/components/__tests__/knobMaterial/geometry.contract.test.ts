import { describe, expect, it } from 'vitest';

import { buildKnobShaderCode } from '../../KnobGPUContext';
import { buildKnob2DDrawCalls, type Knob2DDrawCommand } from '../../knobRender';
import { KNOB_MATERIAL, rgbToHex, rgbToWgsl, wgslAngleToCanvas } from '../../knobMaterial';

import { isValueArcCommand, TEST_DIMS } from './shared';

describe('holographic knob derivation contract', () => {
    it('locks sweep constants and WGSL↔Canvas angle agreement', () => {
        expect(KNOB_MATERIAL.geometry.sweepStartAngle).toBeCloseTo(-(3 * Math.PI) / 4, 10);
        expect(KNOB_MATERIAL.geometry.sweepTotal).toBeCloseTo((3 * Math.PI) / 2, 10);

        const drawCalls = buildKnob2DDrawCalls(KNOB_MATERIAL, 1.0, TEST_DIMS);
        const valueArc = drawCalls.find(isValueArcCommand);
        if (!valueArc) {
            throw new Error(`Expected value arc command in draw calls, got: ${JSON.stringify(drawCalls)}`);
        }

        const expectedStart = wgslAngleToCanvas(KNOB_MATERIAL.geometry.sweepStartAngle);
        expect(valueArc.args[3]).toBeCloseTo(expectedStart, 10);
        expect(valueArc.args[4] - valueArc.args[3]).toBeCloseTo(KNOB_MATERIAL.geometry.sweepTotal, 10);
    });

    it('derives color and geometry from input material (no hardcoded literals)', () => {
        const custom = {
            ...KNOB_MATERIAL,
            palette: {
                ...KNOB_MATERIAL.palette,
                ring: { r: 0.42, g: 0.17, b: 0.91 },
            },
            geometry: {
                ...KNOB_MATERIAL.geometry,
                arcRadius: 0.77,
            },
        };

        const customShader = buildKnobShaderCode(custom);
        expect(customShader).toContain(rgbToWgsl(custom.palette.ring));
        expect(customShader).toContain((custom.geometry.arcRadius * 0.5).toFixed(4));
        expect(customShader).not.toContain(rgbToWgsl(KNOB_MATERIAL.palette.ring));

        const custom2D = buildKnob2DDrawCalls(custom, 0.5, TEST_DIMS);
        const strokeColor = custom2D.find(
            (cmd): cmd is Extract<Knob2DDrawCommand, { op: 'strokeStyle' }> => cmd.op === 'strokeStyle'
        );
        expect(strokeColor?.value).toBe(rgbToHex(custom.palette.ring));
    });
});
