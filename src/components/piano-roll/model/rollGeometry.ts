/**
 * Piano-roll coordinates. One canvas holds three regions:
 *
 * ```
 * ┌──────┬──────────────────────────────┐
 * │ keys │ grid  (scrolls x and y)      │
 * │      │                              │
 * ├──────┼──────────────────────────────┤
 * │      │ lane  (scrolls x only)       │
 * └──────┴──────────────────────────────┘
 * ```
 *
 * All values are CSS pixels; the renderers apply the device pixel ratio.
 * Pitch rows run top-down from MAX_PITCH, so higher notes sit higher.
 */
import { MAX_PITCH, MIN_PITCH, noteAt, type RollNote } from './rollModel';

export interface RollLayout {
    /** Canvas size (CSS px). */
    width: number;
    height: number;
    keysWidth: number;
    laneHeight: number;
    pxPerStep: number;
    /** Height of one semitone row. */
    rowHeight: number;
    /** Scroll of the grid content (CSS px). */
    scrollX: number;
    scrollY: number;
}

export interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}

export const DEFAULT_LAYOUT: RollLayout = {
    width: 800,
    height: 400,
    keysWidth: 48,
    laneHeight: 64,
    pxPerStep: 28,
    rowHeight: 12,
    scrollX: 0,
    scrollY: 0,
};

/** Pixels from a note's right edge that grab the resize handle. */
export const RESIZE_HANDLE_PX = 6;

const ROWS = MAX_PITCH - MIN_PITCH + 1;

export function gridRect(l: RollLayout): Rect {
    return { x: l.keysWidth, y: 0, w: Math.max(0, l.width - l.keysWidth), h: Math.max(0, l.height - l.laneHeight) };
}

export function laneRect(l: RollLayout): Rect {
    return { x: l.keysWidth, y: Math.max(0, l.height - l.laneHeight), w: Math.max(0, l.width - l.keysWidth), h: l.laneHeight };
}

export function keysRect(l: RollLayout): Rect {
    return { x: 0, y: 0, w: l.keysWidth, h: Math.max(0, l.height - l.laneHeight) };
}

/** Size of the scrollable content for `columns` steps. */
export function contentSize(l: RollLayout, columns: number): { width: number; height: number } {
    return {
        width: l.keysWidth + columns * l.pxPerStep,
        height: ROWS * l.rowHeight + l.laneHeight,
    };
}

export function stepToX(l: RollLayout, position: number): number {
    return l.keysWidth + position * l.pxPerStep - l.scrollX;
}

export function pitchToY(l: RollLayout, pitch: number): number {
    return (MAX_PITCH - pitch) * l.rowHeight - l.scrollY;
}

export function xToPosition(l: RollLayout, x: number): number {
    return (x - l.keysWidth + l.scrollX) / l.pxPerStep;
}

export function yToPitch(l: RollLayout, y: number): number {
    return Math.min(MAX_PITCH, Math.max(MIN_PITCH, MAX_PITCH - Math.floor((y + l.scrollY) / l.rowHeight)));
}

/** First and last pitch row with any pixel inside the grid. */
export function visiblePitchRange(l: RollLayout): { low: number; high: number } {
    const grid = gridRect(l);
    const high = yToPitch(l, 0);
    const low = yToPitch(l, Math.max(0, grid.h - 1));
    return { low, high };
}

/** Step columns with any pixel inside the grid (clamped to [0, columns)). */
export function visibleStepRange(l: RollLayout, columns: number): { first: number; last: number } {
    const grid = gridRect(l);
    const first = Math.max(0, Math.floor(xToPosition(l, grid.x)));
    const last = Math.min(columns - 1, Math.ceil(xToPosition(l, grid.x + grid.w)));
    return { first, last };
}

/** scrollY that puts `pitch` in the middle of the grid. */
export function scrollYForPitch(l: RollLayout, pitch: number): number {
    const grid = gridRect(l);
    const maxScroll = Math.max(0, ROWS * l.rowHeight + l.laneHeight - l.height);
    const target = (MAX_PITCH - pitch + 0.5) * l.rowHeight - grid.h / 2;
    return Math.min(maxScroll, Math.max(0, Math.round(target)));
}

export type RollHit =
    | { region: 'keys'; pitch: number }
    | { region: 'grid'; position: number; pitch: number; note: RollNote | null; edge: 'body' | 'end' | null }
    | { region: 'lane'; position: number; value: number }
    | { region: 'none' };

function inside(r: Rect, x: number, y: number): boolean {
    return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

export function hitTest(l: RollLayout, notes: readonly RollNote[], x: number, y: number): RollHit {
    if (inside(keysRect(l), x, y)) return { region: 'keys', pitch: yToPitch(l, y) };
    const lane = laneRect(l);
    if (inside(lane, x, y)) {
        const value = 1 - (y - lane.y) / Math.max(1, lane.h);
        return { region: 'lane', position: xToPosition(l, x), value: Math.min(1, Math.max(0, value)) };
    }
    if (!inside(gridRect(l), x, y)) return { region: 'none' };
    const position = xToPosition(l, x);
    const pitch = yToPitch(l, y);
    const note = noteAt(notes, position, pitch);
    let edge: 'body' | 'end' | null = null;
    if (note) {
        const right = stepToX(l, note.start + note.length);
        edge = right - x <= RESIZE_HANDLE_PX && note.length * l.pxPerStep > RESIZE_HANDLE_PX * 2 ? 'end' : 'body';
    }
    return { region: 'grid', position, pitch, note, edge };
}

/** Snap a position down to the grid unit. */
export function snapPosition(position: number, grid: number): number {
    if (!(grid > 0)) return position;
    return Math.round(Math.floor(position / grid + 1e-9) * grid * 1e6) / 1e6;
}
