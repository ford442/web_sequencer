import type { KnobMaterial } from './knobMaterial';
import { normalizedFromWgslAngle, resolveDetentPositions } from './knobMaterial';

/** Minimal knob fields needed to resolve the canvas / needle render value. */
export interface KnobCanvasValueSource {
    value: number;
    isAutomated?: boolean;
    automatedValue?: number;
    isRecording?: boolean;
    recordingValue?: number;
}

/**
 * Authoritative normalized (0–1) value for knob canvas rendering.
 * Prefers drag override, then smooth recording preview, then live automation.
 */
export function getKnobCanvasValue(
    ctrl: KnobCanvasValueSource,
    dragOverride?: number | null
): number {
    if (dragOverride != null) {
        return dragOverride;
    }
    if (ctrl.isRecording && ctrl.recordingValue !== undefined) {
        return ctrl.recordingValue;
    }
    if (ctrl.isAutomated && ctrl.automatedValue !== undefined) {
        return ctrl.automatedValue;
    }
    return ctrl.value;
}

/** Fraction of body radius — pointer must land within this band of the arc to click-set. */
export const ARC_CLICK_TOLERANCE = 0.14;

/** Normalized distance below which a value snaps to a landmark tick. */
export const VALUE_SNAP_THRESHOLD = 0.035;

export const DEFAULT_SNAP_VALUES = [0, 0.25, 0.5, 0.75, 1];

/**
 * Pointer offset from knob center (screen coords, y increases downward)
 * → WGSL angle (0 = up, + = clockwise).
 */
export function wgslAngleFromPointer(dx: number, dy: number): number {
    return Math.atan2(dx, -dy);
}

export function isPointerNearArcRing(
    dx: number,
    dy: number,
    bodyRadius: number,
    material: KnobMaterial,
    toleranceFraction: number = ARC_CLICK_TOLERANCE
): boolean {
    const dist = Math.sqrt(dx * dx + dy * dy);
    const arcR = bodyRadius * material.geometry.arcRadius;
    const tol = bodyRadius * toleranceFraction;
    return Math.abs(dist - arcR) < tol;
}

export interface SnapKnobValueOptions {
    min?: number;
    max?: number;
    step?: number;
    snapValues?: number[];
    snapThreshold?: number;
    /** When true, prefer material detent positions for snapping. */
    useDetents?: boolean;
    material?: KnobMaterial;
}

/** Runtime detent snap configuration passed from UI controls. */
export interface KnobDetentSnapOptions {
    enabled?: boolean;
    positions?: number[];
    snapThreshold?: number;
    material?: KnobMaterial;
}

/**
 * Bias a parameter-space value toward the nearest detent within a deadzone.
 * Returns the original value when no detent is close enough.
 */
export function applyDetentSnap(
    value: number,
    min: number,
    max: number,
    options: KnobDetentSnapOptions = {}
): number {
    if (!options.enabled) return value;

    const material = options.material;
    const positions = options.positions
        ?? (material ? resolveDetentPositions(material) : DEFAULT_SNAP_VALUES);
    const threshold = options.snapThreshold
        ?? material?.detents?.snapThreshold
        ?? VALUE_SNAP_THRESHOLD;

    const range = max - min;
    if (range <= 0) return value;

    let normalized = (value - min) / range;
    normalized = Math.max(0, Math.min(1, normalized));

    for (const detent of positions) {
        if (Math.abs(normalized - detent) < threshold) {
            return min + detent * range;
        }
    }

    return value;
}

export function resolveSnapValues(options: SnapKnobValueOptions): number[] {
    if (options.useDetents && options.material) {
        return resolveDetentPositions(options.material);
    }
    return options.snapValues ?? DEFAULT_SNAP_VALUES;
}

/**
 * Clamp, step-quantize, and snap a normalized 0..1 knob value.
 * When min/max are provided, input/output are in parameter space instead.
 */
export function snapKnobValue(
    raw: number,
    options: SnapKnobValueOptions = {}
): number {
    const {
        min = 0,
        max = 1,
        step,
        snapValues,
        snapThreshold = VALUE_SNAP_THRESHOLD,
        useDetents,
        material,
    } = options;

    const range = max - min;
    let normalized = range > 0 ? (raw - min) / range : raw;
    normalized = Math.max(0, Math.min(1, normalized));

    const landmarks = resolveSnapValues({ snapValues, useDetents, material });
    const threshold = useDetents && material?.detents?.snapThreshold
        ? material.detents.snapThreshold
        : snapThreshold;

    for (const landmark of landmarks) {
        if (Math.abs(normalized - landmark) < threshold) {
            normalized = landmark;
            break;
        }
    }

    let value = min + normalized * range;

    if (step !== undefined && step > 0) {
        value = Math.round(value / step) * step;
    }

    return Math.max(min, Math.min(max, value));
}

export function valueFromArcPointer(
    dx: number,
    dy: number,
    geometry: KnobMaterial['geometry'],
    options: SnapKnobValueOptions = {}
): number {
    const angle = wgslAngleFromPointer(dx, dy);
    const normalized = normalizedFromWgslAngle(angle, geometry);
    const { min = 0, max = 1, ...rest } = options;
    const range = max - min;
    return snapKnobValue(min + normalized * range, { min, max, ...rest });
}

// --- Vertical drag (hardware-style pointer drag) ---

/** Pixels of vertical travel for a full min→max sweep at 1× sensitivity. */
export const KNOB_DRAG_PIXELS_PER_FULL_RANGE = 200;

/** Shift-held drag multiplier (~10× faster). */
export const KNOB_COARSE_MULTIPLIER = 10;

/** Alt/Ctrl-held drag multiplier (~10× slower). */
export const KNOB_FINE_MULTIPLIER = 0.1;

/** Gentle power curve — small moves stay precise, longer throws accelerate slightly. */
export const KNOB_DRAG_CURVE_EXPONENT = 1.06;

export type KnobDragModifier = 'normal' | 'coarse' | 'fine';

type ModifierEvent = Pick<PointerEvent | MouseEvent | WheelEvent, 'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey'>;

export function getKnobDragModifier(event: ModifierEvent): KnobDragModifier {
    if (event.shiftKey) return 'coarse';
    if (event.altKey || event.ctrlKey || event.metaKey) return 'fine';
    return 'normal';
}

export function getKnobDragMultiplier(modifier: KnobDragModifier): number {
    switch (modifier) {
        case 'coarse':
            return KNOB_COARSE_MULTIPLIER;
        case 'fine':
            return KNOB_FINE_MULTIPLIER;
        default:
            return 1;
    }
}

export function getKnobDragCursor(modifier: KnobDragModifier, dragging: boolean): string {
    if (!dragging) return 'pointer';
    switch (modifier) {
        case 'coarse':
            return 'grabbing';
        case 'fine':
            return 'col-resize';
        default:
            return 'ns-resize';
    }
}

export function getKnobDragHudLabel(modifier: KnobDragModifier): string | null {
    if (modifier === 'coarse') return 'COARSE';
    if (modifier === 'fine') return 'FINE';
    return null;
}

export interface KnobDragAnchor {
    startY: number;
    startValue: number;
    modifier: KnobDragModifier;
}

export function createKnobDragAnchor(
    clientY: number,
    startValue: number,
    event?: ModifierEvent
): KnobDragAnchor {
    return {
        startY: clientY,
        startValue,
        modifier: event ? getKnobDragModifier(event) : 'normal',
    };
}

/**
 * Re-anchor drag origin when modifier keys change mid-drag so the value
 * does not jump until the pointer moves again.
 */
export function reanchorDragIfModifierChanged(
    anchor: KnobDragAnchor,
    clientY: number,
    currentValue: number,
    event: ModifierEvent
): KnobDragModifier {
    const next = getKnobDragModifier(event);
    if (next !== anchor.modifier) {
        anchor.startY = clientY;
        anchor.startValue = currentValue;
        anchor.modifier = next;
    }
    return anchor.modifier;
}

export function applyKnobDragCurve(
    deltaY: number,
    exponent: number = KNOB_DRAG_CURVE_EXPONENT
): number {
    if (deltaY === 0) return 0;
    const sign = Math.sign(deltaY);
    return sign * Math.pow(Math.abs(deltaY), exponent);
}

export interface ComputeKnobDragValueOptions {
    min?: number;
    max?: number;
    step?: number;
    logarithmic?: boolean;
    pixelsPerFullRange?: number;
    curveExponent?: number;
    detentSnap?: KnobDetentSnapOptions;
}

/**
 * Compute the next knob value from a vertical drag gesture.
 * Reads modifier keys from the move event; re-anchors on modifier change.
 */
export function computeKnobDragValue(
    anchor: KnobDragAnchor,
    clientY: number,
    event: ModifierEvent,
    currentValue: number,
    options: ComputeKnobDragValueOptions = {}
): { value: number; modifier: KnobDragModifier } {
    const {
        min = 0,
        max = 1,
        step,
        logarithmic = false,
        pixelsPerFullRange = KNOB_DRAG_PIXELS_PER_FULL_RANGE,
        curveExponent = KNOB_DRAG_CURVE_EXPONENT,
    } = options;

    const modifier = reanchorDragIfModifierChanged(anchor, clientY, currentValue, event);
    const multiplier = getKnobDragMultiplier(modifier);
    const curvedDy = applyKnobDragCurve(anchor.startY - clientY, curveExponent);

    let newValue: number;
    if (logarithmic) {
        const effectiveMin = min <= 0 ? 0.001 : min;
        const logMin = Math.log(effectiveMin);
        const logMax = Math.log(max);
        const safeStart = anchor.startValue <= 0 ? effectiveMin : anchor.startValue;
        const range = logMax - logMin;
        const sensitivity = range / pixelsPerFullRange;
        newValue = Math.exp(Math.log(safeStart) + curvedDy * sensitivity * multiplier);
    } else {
        const range = max - min;
        const sensitivity = range / pixelsPerFullRange;
        newValue = anchor.startValue + curvedDy * sensitivity * multiplier;
    }

    if (step !== undefined && step > 0) {
        newValue = Math.round(newValue / step) * step;
    }

    newValue = applyDetentSnap(newValue, min, max, options.detentSnap ?? {});

    return {
        value: Math.max(min, Math.min(max, newValue)),
        modifier,
    };
}

/** Expected value delta for a linear drag of `pixels` at the given modifier. */
export function expectedKnobDragDelta(
    pixels: number,
    options: { min?: number; max?: number; modifier?: KnobDragModifier; pixelsPerFullRange?: number } = {}
): number {
    const {
        min = 0,
        max = 1,
        modifier = 'normal',
        pixelsPerFullRange = KNOB_DRAG_PIXELS_PER_FULL_RANGE,
    } = options;
    const range = max - min;
    const curvedDy = applyKnobDragCurve(pixels);
    return curvedDy * (range / pixelsPerFullRange) * getKnobDragMultiplier(modifier);
}
