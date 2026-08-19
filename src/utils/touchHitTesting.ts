/** WCAG 2.1 AA minimum touch target (CSS pixels). */
export const MIN_TOUCH_TARGET_PX = 44;

export interface KnobHitControl {
    x: number;
    y: number;
    size: number;
}

export interface FindHitKnobOptions {
    /** Minimum hit radius in CSS pixels (default half of MIN_TOUCH_TARGET_PX). */
    minHitRadiusPx?: number;
    /** Extra multiplier on computed knob radius (fat-finger tolerance). */
    hitRadiusMultiplier?: number;
}

/**
 * Find the closest knob under a pointer, with expanded hit zones for touch.
 * Returns -1 when no knob is within range.
 */
export function findHitKnobIndex(
    controls: KnobHitControl[],
    clientX: number,
    clientY: number,
    rect: DOMRect,
    options: FindHitKnobOptions = {}
): number {
    const minHitRadiusPx = options.minHitRadiusPx ?? MIN_TOUCH_TARGET_PX / 2;
    const hitRadiusMultiplier = options.hitRadiusMultiplier ?? 1.15;
    const scale = Math.max(rect.width, rect.height);
    const minDim = Math.min(rect.width, rect.height);
    const normX = (clientX - rect.left) / scale;
    const normY = (clientY - rect.top) / scale;
    const minHitNorm = minHitRadiusPx / scale;

    let bestIndex = -1;
    let bestDist = Infinity;

    for (let i = 0; i < controls.length; i++) {
        const k = controls[i];
        const kNormX = (k.x * rect.width) / scale;
        const kNormY = (k.y * rect.height) / scale;
        const kSizeNorm = (k.size * minDim) / scale;
        const hitRadius = Math.max(kSizeNorm * 2.0 * hitRadiusMultiplier, minHitNorm);

        const dx = kNormX - normX;
        const dy = kNormY - normY;
        const distCenter = Math.hypot(dx, dy);

        const labelNormY = ((k.y + k.size * 0.8) * rect.height) / scale;
        const distLabel = Math.hypot(dx, labelNormY - normY);
        const dist = Math.min(distCenter, distLabel);

        if (dist < hitRadius && dist < bestDist) {
            bestDist = dist;
            bestIndex = i;
        }
    }

    return bestIndex;
}

/**
 * Hit-test against each knob canvas's layout box. WebGPU presents into the
 * canvas bitmap; CSS transforms on that canvas can desync the visible image
 * from reconstructed x/y math, so prefer the element's own rect.
 */
export function findHitKnobIndexFromCanvases(
    canvases: Array<HTMLCanvasElement | null | undefined>,
    clientX: number,
    clientY: number,
    options: FindHitKnobOptions = {}
): number {
    const minHitRadiusPx = options.minHitRadiusPx ?? MIN_TOUCH_TARGET_PX / 2;
    const hitRadiusMultiplier = options.hitRadiusMultiplier ?? 1.15;

    let bestIndex = -1;
    let bestDist = Infinity;

    for (let i = 0; i < canvases.length; i++) {
        const canvas = canvases[i];
        if (!canvas) continue;
        const rect = canvas.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;

        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const visualR = Math.min(rect.width, rect.height) / 2;
        const hitRadius = Math.max(visualR * hitRadiusMultiplier, minHitRadiusPx);

        const dx = clientX - cx;
        const dy = clientY - cy;
        const distCenter = Math.hypot(dx, dy);
        const distLabel = Math.hypot(dx, clientY - (cy + visualR * 0.8));
        const dist = Math.min(distCenter, distLabel);

        if (dist < hitRadius && dist < bestDist) {
            bestDist = dist;
            bestIndex = i;
        }
    }

    return bestIndex;
}
