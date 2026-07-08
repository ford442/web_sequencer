import { describe, expect, it } from 'vitest';

import { KNOB_MATERIAL } from '../knobMaterial';
import {
    isPointerNearArcRing,
    snapKnobValue,
    valueFromArcPointer,
    wgslAngleFromPointer,
    expectedKnobDragDelta,
    applyDetentSnap,
    createKnobDragAnchor,
    computeKnobDragValue,
    getKnobCanvasValue,
} from '../knobInteraction';
import { resolveDetentPositions, usesHardwarePointer } from '../knobMaterial';
import { buildKnob2DDrawCalls } from '../knobRender';

describe('knobInteraction', () => {
    it('maps pointer at sweep start to min value', () => {
        const bodyR = 50;
        const arcR = bodyR * KNOB_MATERIAL.geometry.arcRadius;
        const startAngle = KNOB_MATERIAL.geometry.sweepStartAngle;
        const dx = Math.sin(startAngle) * arcR;
        const dy = -Math.cos(startAngle) * arcR;
        expect(isPointerNearArcRing(dx, dy, bodyR, KNOB_MATERIAL)).toBe(true);
        expect(valueFromArcPointer(dx, dy, KNOB_MATERIAL.geometry, { min: 0, max: 1, step: 0.05 })).toBe(0);
    });

    it('maps pointer at sweep end to max value', () => {
        const bodyR = 50;
        const arcR = bodyR * KNOB_MATERIAL.geometry.arcRadius;
        const endAngle =
            KNOB_MATERIAL.geometry.sweepStartAngle + KNOB_MATERIAL.geometry.sweepTotal;
        const dx = Math.sin(endAngle) * arcR;
        const dy = -Math.cos(endAngle) * arcR;
        expect(valueFromArcPointer(dx, dy, KNOB_MATERIAL.geometry, { min: 0, max: 1, step: 0.05 })).toBe(1);
    });

    it('snaps to musical landmarks', () => {
        expect(snapKnobValue(48, { min: 0, max: 100, step: 1 })).toBe(50);
        expect(snapKnobValue(0.02, { min: 0, max: 1 })).toBe(0);
    });

    it('rejects clicks far from the arc ring', () => {
        expect(isPointerNearArcRing(0, 0, 50, KNOB_MATERIAL)).toBe(false);
        expect(isPointerNearArcRing(10, 0, 50, KNOB_MATERIAL)).toBe(false);
    });

    it('uses up = 0 WGSL convention for pointer angles', () => {
        expect(wgslAngleFromPointer(0, -10)).toBeCloseTo(0, 5);
        expect(wgslAngleFromPointer(10, 0)).toBeCloseTo(Math.PI / 2, 5);
    });
});

describe('getKnobCanvasValue', () => {
    it('returns manual value when not automated', () => {
        expect(getKnobCanvasValue({ value: 0.35 })).toBe(0.35);
    });

    it('prefers automated value when automation is active', () => {
        expect(
            getKnobCanvasValue({ value: 0.2, isAutomated: true, automatedValue: 0.8 })
        ).toBe(0.8);
    });

    it('falls back to manual value when automated flag is set but value is missing', () => {
        expect(getKnobCanvasValue({ value: 0.2, isAutomated: true })).toBe(0.2);
    });

    it('drag override wins over automation for live manual grab', () => {
        expect(
            getKnobCanvasValue({ value: 0.2, isAutomated: true, automatedValue: 0.8 }, 0.45)
        ).toBe(0.45);
    });

    it('prefers recording preview over automated value', () => {
        expect(
            getKnobCanvasValue({ value: 0.2, isAutomated: true, automatedValue: 0.8, isRecording: true, recordingValue: 0.55 })
        ).toBe(0.55);
    });
});

describe('applyDetentSnap', () => {
    it('snaps toward nearest detent within deadzone', () => {
        expect(applyDetentSnap(0.48, 0, 1, { enabled: true, positions: [0, 0.5, 1] })).toBe(0.5);
        expect(applyDetentSnap(0.03, 0, 1, { enabled: true, positions: [0, 0.5, 1] })).toBe(0);
    });

    it('leaves value alone when disabled or outside deadzone', () => {
        expect(applyDetentSnap(0.48, 0, 1, { enabled: false, positions: [0, 0.5, 1] })).toBe(0.48);
        expect(applyDetentSnap(0.2, 0, 1, { enabled: true, positions: [0, 0.5, 1] })).toBe(0.2);
    });
});

describe('knob material detents', () => {
    it('resolves default detent positions from material', () => {
        expect(resolveDetentPositions({ detents: { positions: [0, 0.25, 1] } } as never)).toEqual([0, 0.25, 1]);
    });

    it('2D renderer includes detent draw ops when material defines detents', () => {
        const calls = buildKnob2DDrawCalls({ ...KNOB_MATERIAL, detents: { positions: [0, 1] } }, 0.5, { w: 100, h: 100 });
        expect(calls.filter((c) => c.op === 'fill').length).toBeGreaterThan(0);
        expect(calls.some((c) => c.op === 'ellipse')).toBe(true);
    });

    it('uses hardware pointer variant by default in KNOB_MATERIAL', () => {
        expect(usesHardwarePointer(KNOB_MATERIAL)).toBe(true);
    });
});

describe('knob vertical drag modifiers', () => {
    const noMod = { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false };
    const shiftMod = { shiftKey: true, altKey: false, ctrlKey: false, metaKey: false };

    it('shift drag moves ~10× farther than normal for the same pixel travel', () => {
        const normal = expectedKnobDragDelta(50, { min: 0, max: 100, modifier: 'normal' });
        const coarse = expectedKnobDragDelta(50, { min: 0, max: 100, modifier: 'coarse' });
        expect(coarse / normal).toBeCloseTo(10, 1);
    });

    it('alt drag moves ~10× slower than normal', () => {
        const normal = expectedKnobDragDelta(50, { modifier: 'normal' });
        const fine = expectedKnobDragDelta(50, { modifier: 'fine' });
        expect(normal / fine).toBeCloseTo(10, 1);
    });

    it('does not jump when modifier changes without pointer movement', () => {
        const anchor = createKnobDragAnchor(200, 0.5, noMod);
        const afterMove = computeKnobDragValue(anchor, 170, noMod, 0.5, { min: 0, max: 1 }).value;
        const afterShiftOnly = computeKnobDragValue(anchor, 170, shiftMod, afterMove, { min: 0, max: 1 }).value;
        expect(afterShiftOnly).toBeCloseTo(afterMove, 10);
    });
});
