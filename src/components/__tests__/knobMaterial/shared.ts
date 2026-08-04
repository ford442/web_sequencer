import { KNOB_MATERIAL } from '../../knobMaterial';
import type { Knob2DDrawCommand } from '../../knobRender';

export const TEST_DIMS = { w: 100, h: 100 };
export const FLOAT_EPSILON = 1e-7;

export function isValueArcCommand(cmd: Knob2DDrawCommand): cmd is Extract<Knob2DDrawCommand, { op: 'arc' }> {
    return (
        cmd.op === 'arc' &&
        Math.abs(cmd.args[2] - TEST_DIMS.w * 0.5 * KNOB_MATERIAL.geometry.arcRadius) < FLOAT_EPSILON
    );
}
