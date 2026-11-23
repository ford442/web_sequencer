import { createContext } from 'react';
import { clamp } from '@/utils/math';
import { sequencerViewBoxWidth } from './stepHitGeometry';

/**
 * Fit-to-area layout for the step grid.
 *
 * The grid used to be a fixed 1050x680 viewBox letterboxed (`meet`) into the
 * panel, so on any panel that was not exactly that aspect it sat in a corner at
 * well under its natural size. The layout below instead sizes the SVG to the
 * measured panel and re-derives the viewBox from it: one uniform scale for
 * both axes (so text and LEDs are never squashed), with the row pitch absorbing
 * the vertical slack.
 */

export const SEQUENCER_ROW_COUNT = 8;
/** Row block offset inside the viewBox (the `translate(100, 40)` in MainSequencer). */
export const SEQUENCER_TOP = 40;
const BOTTOM = 8;

export const BASE_ROW_PITCH = 60;
export const BASE_STEP_HEIGHT = 50;
const STEP_ROW_GAP = BASE_ROW_PITCH - BASE_STEP_HEIGHT;

/** Rows never get tighter than this (steps stay ~26 units tall) or looser than MAX_PITCH. */
const MIN_PITCH = 36;
const MAX_PITCH = 84;

/** Narrowest a step is allowed to render (px per viewBox unit) before the grid scrolls sideways. */
const MIN_SCALE = 0.8;

const BASE_COLUMNS = 32;
const BASE_TIMELINE_PX = 830;
const BASE_LABEL_PX = 220;

export interface SequencerLayoutMetrics {
    /** Vertical distance between rows, in viewBox units. */
    rowPitch: number;
    /** Vertical scale applied to the step cells (steps are plain rects, so this never distorts text). */
    stepScaleY: number;
    /** Uniform scale for the label column (chips, mute/solo, slots) so it fits the row. */
    labelScale: number;
}

/** The pre-fit geometry: 60-unit rows, 50-unit steps, full-size labels. */
export const LEGACY_LAYOUT: SequencerLayoutMetrics = {
    rowPitch: BASE_ROW_PITCH,
    stepScaleY: 1,
    labelScale: 1,
};

export const SequencerLayoutContext = createContext<SequencerLayoutMetrics>(LEGACY_LAYOUT);

export interface FitInput {
    columns: number;
    zoom: number;
    /** Content-box size of the panel, in CSS px. */
    availWidth: number;
    availHeight: number;
}

export interface SequencerFit extends SequencerLayoutMetrics {
    cssWidth: number;
    cssHeight: number;
    viewBoxWidth: number;
    viewBoxHeight: number;
    /** Rows needed more room than the panel has; the panel should scroll vertically. */
    scrollY: boolean;
}

/** Returns null while the panel has not been measured (first paint, jsdom). */
export function fitSequencerLayout(input: FitInput): SequencerFit | null {
    const { columns, zoom, availWidth, availHeight } = input;
    if (!(availWidth > 0) || !(availHeight > 0)) return null;

    const vbW = sequencerViewBoxWidth(columns);
    const timelinePx = (BASE_TIMELINE_PX * columns) / BASE_COLUMNS;

    // Zoom 1 = exactly the panel width; other zooms stretch the timeline part like before.
    const rel = (BASE_LABEL_PX + timelinePx * zoom) / (BASE_LABEL_PX + timelinePx);
    let scale = Math.max((availWidth * rel) / vbW, MIN_SCALE * rel);
    let cssWidth = vbW * scale;
    // Within a pixel of the panel: snap, so a stray horizontal scrollbar never appears.
    if (Math.abs(cssWidth - availWidth) < 2) {
        cssWidth = availWidth;
        scale = cssWidth / vbW;
    }

    const rawVbH = availHeight / scale;
    const rawPitch = (rawVbH - SEQUENCER_TOP - BOTTOM) / SEQUENCER_ROW_COUNT;
    const rowPitch = clamp(rawPitch, MIN_PITCH, MAX_PITCH);
    const scrollY = rawPitch < MIN_PITCH;
    // Content height at the chosen pitch; when the pitch is capped the extra panel height stays empty below.
    const contentVbH = SEQUENCER_TOP + SEQUENCER_ROW_COUNT * rowPitch + BOTTOM;
    const viewBoxHeight = scrollY || rawPitch > MAX_PITCH ? contentVbH : rawVbH;
    const cssHeight = scrollY ? contentVbH * scale : availHeight;

    return {
        cssWidth,
        cssHeight,
        viewBoxWidth: vbW,
        viewBoxHeight,
        scrollY,
        rowPitch,
        stepScaleY: (rowPitch - STEP_ROW_GAP) / BASE_STEP_HEIGHT,
        labelScale: clamp(rowPitch / BASE_ROW_PITCH, 0.62, 1.3),
    };
}
