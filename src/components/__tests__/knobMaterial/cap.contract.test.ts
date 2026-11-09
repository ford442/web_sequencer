import { describe, expect, it } from 'vitest';
import { buildKnob2DDrawCalls, type Knob2DDrawCommand } from '../../knobRender';
import { buildKnobCapLayers, KNOB_CAP_FRAME } from '../../knobCapRender';
import { buildKnobCapShaderCode } from '../../knobCapShader';
import { buildKnobShaderCode } from '../../KnobGPUContext';
import {
    KNOB_MATERIAL,
    KNOB_MATERIAL_CHASSIS,
    resolveKnobCap,
    resolveKnobLighting,
    normalizedLightDir,
} from '../../knobMaterial';

const DIMS = { w: 100, h: 100 };
const CAP_ONLY_OPS = new Set(['save', 'restore', 'lineCap', 'shadow', 'createRadialGradient', 'fillStyleGradient']);

function ops(cmds: Knob2DDrawCommand[]): string[] {
    return cmds.map((c) => c.op);
}

describe('physical knob cap contract (#1581)', () => {
    it('KNOB_MATERIAL has no cap, so the holographic draw list never uses cap ops', () => {
        expect(resolveKnobCap(KNOB_MATERIAL)).toBeNull();
        expect(buildKnobCapLayers(KNOB_MATERIAL, 0.5, DIMS)).toBeNull();
        for (const v of [0, 0.5, 1]) {
            expect(ops(buildKnob2DDrawCalls(KNOB_MATERIAL, v, DIMS)).some((op) => CAP_ONLY_OPS.has(op))).toBe(false);
        }
    });

    it('the default WGSL is the holographic shader, not the cap shader', () => {
        expect(buildKnobCapShaderCode(KNOB_MATERIAL)).toBeNull();
        const shader = buildKnobShaderCode(KNOB_MATERIAL);
        expect(shader).toContain('Holographic Scanlines');
        expect(shader).not.toContain('Premultiplied "over"');
    });

    it('chassis material resolves a full cap and lighting', () => {
        const cap = resolveKnobCap(KNOB_MATERIAL_CHASSIS)!;
        expect(cap).toMatchObject({ radius: 0.74, topRadius: 0.62, knurlCount: 36, bevel: 0.12 });
        const [x, y, z] = normalizedLightDir(resolveKnobLighting(KNOB_MATERIAL_CHASSIS));
        expect(Math.hypot(x, y, z)).toBeCloseTo(1, 6);
        expect(x).toBeLessThan(0); // key light from the left
        expect(y).toBeLessThan(0); // ...and above (screen y down)
    });

    it('cap draw list is transparent (no background fill) so it composes on any surface', () => {
        const cmds = buildKnob2DDrawCalls(KNOB_MATERIAL_CHASSIS, 0.5, DIMS);
        expect(cmds.some((c) => c.op === 'fillRect')).toBe(false);
        expect(cmds.some((c) => c.op === 'shadow')).toBe(true);
        expect(cmds.some((c) => c.op === 'createRadialGradient')).toBe(true);
    });

    it('static layer is value-independent (cacheable); dynamic layer turns with the value', () => {
        const a = buildKnobCapLayers(KNOB_MATERIAL_CHASSIS, 0.2, DIMS)!;
        const b = buildKnobCapLayers(KNOB_MATERIAL_CHASSIS, 0.8, DIMS)!;
        expect(a.staticLayer).toEqual(b.staticLayer);
        expect(a.dynamicLayer).not.toEqual(b.dynamicLayer);
    });

    it('knurl rotates with the value while the specular highlight stays fixed to the light', () => {
        const a = buildKnobCapLayers(KNOB_MATERIAL_CHASSIS, 0.1, DIMS)!.dynamicLayer;
        const b = buildKnobCapLayers(KNOB_MATERIAL_CHASSIS, 0.9, DIMS)!.dynamicLayer;
        const firstMove = (cmds: Knob2DDrawCommand[]) => cmds.find((c) => c.op === 'moveTo');
        expect(firstMove(a)).not.toEqual(firstMove(b));
        const highlight = (cmds: Knob2DDrawCommand[]) => cmds.filter((c) => c.op === 'ellipse').at(-1);
        expect(highlight(a)).toEqual(highlight(b));
    });

    it('value 0 draws no lit arc; any positive value does', () => {
        const zero = buildKnobCapLayers(KNOB_MATERIAL_CHASSIS, 0, DIMS)!.dynamicLayer;
        const some = buildKnobCapLayers(KNOB_MATERIAL_CHASSIS, 0.3, DIMS)!.dynamicLayer;
        const hasArcGradient = (cmds: Knob2DDrawCommand[]) =>
            cmds.some((c) => c.op === 'createLinearGradient' && c.id === 'capArc');
        expect(hasArcGradient(zero)).toBe(false);
        expect(hasArcGradient(some)).toBe(true);
    });

    it('everything stays inside the canvas (frame leaves room for shadow + ticks)', () => {
        const R = (DIMS.w / 2) * KNOB_CAP_FRAME;
        const tickOuter = R * (KNOB_MATERIAL_CHASSIS.scale!.tickRadius! + KNOB_MATERIAL_CHASSIS.scale!.majorTickLength! / 2);
        expect(tickOuter).toBeLessThanOrEqual(DIMS.w / 2);
    });

    it('cap WGSL interpolates the material and keeps the uniform layout', () => {
        const shader = buildKnobShaderCode(KNOB_MATERIAL_CHASSIS);
        expect(shader).toBe(buildKnobCapShaderCode(KNOB_MATERIAL_CHASSIS));
        expect(shader).toContain('struct Uniforms {\n      time: f32,\n      value: f32,\n      resolution: vec2f,');
        expect(shader).toContain('fn vs_main');
        expect(shader).toContain('fn fs_main');
        expect(shader).toContain('sin(local_ang * 36.0000)'); // knurlCount
        expect(shader).toContain('let cap_r = 0.7400;');
        expect(shader).toContain('let top = 0.6200;');
        expect(shader).toContain('array<f32, 7>('); // 7 ticks
        // Interpolation never leaks a JS non-number into the shader.
        expect(shader).not.toMatch(/NaN|undefined|Infinity/);
    });
});
