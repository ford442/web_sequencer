/** Visual step dimensions in SVG viewBox units (matches SvgStep / MainSequencer). */
export const STEP_VISUAL_WIDTH = 18;
export const STEP_GAP = 4;
export const STEP_HEIGHT = 50;

/** Target hit size in SVG units (~44px when sequencer renders at ~1000px wide). */
export const STEP_HIT_MIN_SVG = 44;

export interface StepHitRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** Expanded invisible hit bounds centered on the visual step rect. */
export function getStepHitRect(totalWidth: number, height: number): StepHitRect {
    const width = Math.max(totalWidth, STEP_HIT_MIN_SVG * 0.6);
    const hitH = Math.max(height, STEP_HIT_MIN_SVG);
    return {
        x: (totalWidth - width) / 2,
        y: (height - hitH) / 2,
        width,
        height: hitH,
    };
}

/** Expanded hit bounds for small pattern-slot buttons in the sequencer strip. */
export function getTrackSlotHitRect(rectW: number, rectH: number): StepHitRect {
    const width = Math.max(rectW, 28);
    const height = Math.max(rectH, 28);
    return {
        x: (rectW - width) / 2,
        y: (rectH - height) / 2,
        width,
        height,
    };
}
