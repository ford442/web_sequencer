import { describe, expect, it } from 'vitest';
import { findHitKnobIndex, findHitKnobIndexFromCanvases, MIN_TOUCH_TARGET_PX } from '../touchHitTesting';

describe('touchHitTesting', () => {
    const rect = new DOMRect(0, 0, 400, 400);
    const controls = [
        { x: 0.25, y: 0.3, size: 0.08 },
        { x: 0.75, y: 0.3, size: 0.08 },
    ];

    it('returns -1 when pointer is outside all knobs', () => {
        expect(findHitKnobIndex(controls, 5, 5, rect)).toBe(-1);
    });

    it('hits the nearest knob center', () => {
        const index = findHitKnobIndex(controls, 100, 120, rect);
        expect(index).toBe(0);
    });

    it('hits the second knob when pointer is on the right', () => {
        const index = findHitKnobIndex(controls, 300, 120, rect);
        expect(index).toBe(1);
    });

    it('expands hit radius for fat-finger tolerance', () => {
        const tight = findHitKnobIndex(controls, 100, 120, rect, { hitRadiusMultiplier: 1.0, minHitRadiusPx: 4 });
        const loose = findHitKnobIndex(controls, 100, 120, rect, { hitRadiusMultiplier: 2.0, minHitRadiusPx: MIN_TOUCH_TARGET_PX / 2 });
        expect(loose).toBe(tight);
        const edge = findHitKnobIndex(controls, 60, 120, rect, { hitRadiusMultiplier: 2.5, minHitRadiusPx: MIN_TOUCH_TARGET_PX / 2 });
        expect(edge).toBe(0);
    });

    it('includes label zone below knob in hit test', () => {
        const index = findHitKnobIndex(controls, 100, 150, rect, { hitRadiusMultiplier: 1.5 });
        expect(index).toBe(0);
    });
});

describe('findHitKnobIndexFromCanvases', () => {
    function fakeCanvas(left: number, top: number, width: number, height: number): HTMLCanvasElement {
        return {
            getBoundingClientRect: () => new DOMRect(left, top, width, height),
        } as HTMLCanvasElement;
    }

    it('hits the canvas whose layout box contains the pointer', () => {
        const canvases = [
            fakeCanvas(80, 80, 40, 40),
            fakeCanvas(280, 80, 40, 40),
        ];
        expect(findHitKnobIndexFromCanvases(canvases, 100, 100)).toBe(0);
        expect(findHitKnobIndexFromCanvases(canvases, 300, 100)).toBe(1);
    });

    it('uses the canvas box even when it is offset from a parent origin', () => {
        const canvases = [fakeCanvas(160, 40, 80, 80)];
        expect(findHitKnobIndexFromCanvases(canvases, 200, 80)).toBe(0);
        expect(findHitKnobIndexFromCanvases(canvases, 10, 10)).toBe(-1);
    });
});
