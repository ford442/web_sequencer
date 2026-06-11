import { describe, expect, it } from 'vitest';

import { buildKnobShaderCode } from '../KnobGPUContext';
import {
    buildKnob2DDrawCalls,
    type Knob2DDrawCommand,
} from '../HardwareModule';
import {
    KNOB_MATERIAL,
    rgbToHex,
    rgbToWgsl,
    wgslAngleToCanvas,
} from '../knobMaterial';

const TEST_DIMS = { w: 100, h: 100 };
const FLOAT_EPSILON = 1e-7;

function isValueArcCommand(cmd: Knob2DDrawCommand): cmd is Extract<Knob2DDrawCommand, { op: 'arc' }> {
    return (
        cmd.op === 'arc' &&
        Math.abs(cmd.args[2] - TEST_DIMS.w * 0.5 * KNOB_MATERIAL.geometry.arcRadius) < FLOAT_EPSILON
    );
}

describe('holographic knob derivation contract', () => {
    it('snapshots WGSL derived from KNOB_MATERIAL', () => {
        const shader = buildKnobShaderCode(KNOB_MATERIAL);
        expect(shader).toMatchSnapshot();
    });

    it('snapshots Canvas2D draw-call sequence for value 0.0', () => {
        expect(buildKnob2DDrawCalls(KNOB_MATERIAL, 0.0, TEST_DIMS)).toMatchInlineSnapshot(`
          [
            {
              "op": "fillStyle",
              "value": "#0d0f13",
            },
            {
              "args": [
                0,
                0,
                100,
                100,
              ],
              "op": "fillRect",
            },
            {
              "op": "beginPath",
            },
            {
              "args": [
                50,
                50,
                55.00000000000001,
                0,
                6.283185307179586,
              ],
              "op": "arc",
            },
            {
              "op": "strokeStyle",
              "value": "#00e5ff",
            },
            {
              "op": "lineWidth",
              "value": 2,
            },
            {
              "op": "stroke",
            },
            {
              "args": [
                20.301515190165,
                79.698484809835,
                20.301515190165,
                79.698484809835,
              ],
              "id": "valueArc",
              "op": "createLinearGradient",
            },
            {
              "args": [
                0,
                "#009980",
              ],
              "id": "valueArc",
              "op": "addColorStop",
            },
            {
              "args": [
                1,
                "#33ffcc",
              ],
              "id": "valueArc",
              "op": "addColorStop",
            },
            {
              "op": "beginPath",
            },
            {
              "args": [
                50,
                50,
                42,
                -3.9269908169872414,
                -3.9269908169872414,
              ],
              "op": "arc",
            },
            {
              "id": "valueArc",
              "op": "strokeStyleGradient",
            },
            {
              "op": "lineWidth",
              "value": 3,
            },
            {
              "op": "stroke",
            },
            {
              "op": "beginPath",
            },
            {
              "args": [
                50,
                50,
              ],
              "op": "moveTo",
            },
            {
              "args": [
                14.644660940672615,
                85.35533905932738,
              ],
              "op": "lineTo",
            },
            {
              "op": "strokeStyle",
              "value": "#ffffff",
            },
            {
              "op": "lineWidth",
              "value": 2,
            },
            {
              "op": "stroke",
            },
          ]
        `);
    });

    it('snapshots Canvas2D draw-call sequence for value 0.5', () => {
        expect(buildKnob2DDrawCalls(KNOB_MATERIAL, 0.5, TEST_DIMS)).toMatchInlineSnapshot(`
          [
            {
              "op": "fillStyle",
              "value": "#0d0f13",
            },
            {
              "args": [
                0,
                0,
                100,
                100,
              ],
              "op": "fillRect",
            },
            {
              "op": "beginPath",
            },
            {
              "args": [
                50,
                50,
                55.00000000000001,
                0,
                6.283185307179586,
              ],
              "op": "arc",
            },
            {
              "op": "strokeStyle",
              "value": "#00e5ff",
            },
            {
              "op": "lineWidth",
              "value": 2,
            },
            {
              "op": "stroke",
            },
            {
              "args": [
                20.301515190165,
                79.698484809835,
                50,
                8,
              ],
              "id": "valueArc",
              "op": "createLinearGradient",
            },
            {
              "args": [
                0,
                "#009980",
              ],
              "id": "valueArc",
              "op": "addColorStop",
            },
            {
              "args": [
                1,
                "#33ffcc",
              ],
              "id": "valueArc",
              "op": "addColorStop",
            },
            {
              "op": "beginPath",
            },
            {
              "args": [
                50,
                50,
                42,
                -3.9269908169872414,
                -1.5707963267948966,
              ],
              "op": "arc",
            },
            {
              "id": "valueArc",
              "op": "strokeStyleGradient",
            },
            {
              "op": "lineWidth",
              "value": 3,
            },
            {
              "op": "stroke",
            },
            {
              "op": "beginPath",
            },
            {
              "args": [
                50,
                50,
              ],
              "op": "moveTo",
            },
            {
              "args": [
                50,
                0,
              ],
              "op": "lineTo",
            },
            {
              "op": "strokeStyle",
              "value": "#ffffff",
            },
            {
              "op": "lineWidth",
              "value": 2,
            },
            {
              "op": "stroke",
            },
          ]
        `);
    });

    it('snapshots Canvas2D draw-call sequence for value 1.0', () => {
        expect(buildKnob2DDrawCalls(KNOB_MATERIAL, 1.0, TEST_DIMS)).toMatchInlineSnapshot(`
          [
            {
              "op": "fillStyle",
              "value": "#0d0f13",
            },
            {
              "args": [
                0,
                0,
                100,
                100,
              ],
              "op": "fillRect",
            },
            {
              "op": "beginPath",
            },
            {
              "args": [
                50,
                50,
                55.00000000000001,
                0,
                6.283185307179586,
              ],
              "op": "arc",
            },
            {
              "op": "strokeStyle",
              "value": "#00e5ff",
            },
            {
              "op": "lineWidth",
              "value": 2,
            },
            {
              "op": "stroke",
            },
            {
              "args": [
                20.301515190165,
                79.698484809835,
                79.698484809835,
                79.698484809835,
              ],
              "id": "valueArc",
              "op": "createLinearGradient",
            },
            {
              "args": [
                0,
                "#009980",
              ],
              "id": "valueArc",
              "op": "addColorStop",
            },
            {
              "args": [
                1,
                "#33ffcc",
              ],
              "id": "valueArc",
              "op": "addColorStop",
            },
            {
              "op": "beginPath",
            },
            {
              "args": [
                50,
                50,
                42,
                -3.9269908169872414,
                0.7853981633974483,
              ],
              "op": "arc",
            },
            {
              "id": "valueArc",
              "op": "strokeStyleGradient",
            },
            {
              "op": "lineWidth",
              "value": 3,
            },
            {
              "op": "stroke",
            },
            {
              "op": "beginPath",
            },
            {
              "args": [
                50,
                50,
              ],
              "op": "moveTo",
            },
            {
              "args": [
                85.35533905932738,
                85.35533905932738,
              ],
              "op": "lineTo",
            },
            {
              "op": "strokeStyle",
              "value": "#ffffff",
            },
            {
              "op": "lineWidth",
              "value": 2,
            },
            {
              "op": "stroke",
            },
          ]
        `);
    });

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
