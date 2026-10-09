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

/** Horizontal distance between step origins in SVG units. */
export const STEP_PITCH = STEP_VISUAL_WIDTH + STEP_GAP;

/** Grid columns the stock 1050-unit sequencer layout was drawn for. */
const BASE_COLUMNS = 32;
const BASE_VIEWBOX_WIDTH = 1050;
/** Pixel width the 32-step timeline gets per unit of zoom. */
const BASE_TIMELINE_PX = 830;

/** SVG viewBox width for `columns` steps (1050 at 32, the stock layout). */
export function sequencerViewBoxWidth(columns: number): number {
    return BASE_VIEWBOX_WIDTH + (columns - BASE_COLUMNS) * STEP_PITCH;
}

/** CSS width for the sequencer SVG; identical to the stock `220px + 830px * zoom` at 32 steps. */
export function sequencerCssWidth(columns: number): string {
    const timelinePx = (BASE_TIMELINE_PX * columns) / BASE_COLUMNS;
    return `calc(220px + ${timelinePx}px * var(--zoom-level))`;
}
