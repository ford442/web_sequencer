/**
 * The piano roll as a flat list of coloured quads.
 *
 * Both renderers draw exactly this list — the WebGPU one as instances of one
 * quad pipeline, the Canvas2D fallback as `fillRect`s — so what is on screen
 * does not depend on which backend the probe gave us, and the scene can be
 * unit-tested without either.
 *
 * Quad layout: `[x, y, w, h, r, g, b, a]` in CSS pixels, straight alpha
 * 0–1, painter's order. Every quad is clipped to its region (keys, grid,
 * lane) here, so the GPU path needs no scissor and the 2D path no clip().
 *
 * The playhead is not part of the scene: it is one quad rewritten per frame
 * (`playheadQuad`) so playback never rebuilds the scene.
 */
import { isMidiInScale, type ScaleDefinition } from '@/utils/musicTheory';
import type { RollNote, RollRect } from '../model/rollModel';
import type { LaneProperty } from '../model/rollEdits';
import {
    gridRect,
    keysRect,
    laneRect,
    pitchToY,
    stepToX,
    visiblePitchRange,
    visibleStepRange,
    type Rect,
    type RollLayout,
} from '../model/rollGeometry';

export const QUAD_FLOATS = 8;

export type Rgba = readonly [number, number, number, number];

export interface RollTheme {
    background: Rgba;
    rowBlackKey: Rgba;
    rowOutOfScale: Rgba;
    rowOctave: Rgba;
    stepLine: Rgba;
    beatLine: Rgba;
    barLine: Rgba;
    outOfLoop: Rgba;
    keyWhite: Rgba;
    keyBlack: Rgba;
    keyDivider: Rgba;
    noteOutline: Rgba;
    selectedOutline: Rgba;
    ghost: Rgba;
    tie: Rgba;
    cursor: Rgba;
    marqueeFill: Rgba;
    marqueeEdge: Rgba;
    laneBackground: Rgba;
    laneDivider: Rgba;
    laneEmpty: Rgba;
    playhead: Rgba;
}

export const DEFAULT_ROLL_THEME: RollTheme = {
    background: [0.043, 0.051, 0.063, 1],
    rowBlackKey: [0.027, 0.031, 0.04, 1],
    rowOutOfScale: [0, 0, 0, 0.35],
    rowOctave: [0.3, 0.35, 0.42, 0.35],
    stepLine: [0.25, 0.28, 0.33, 0.25],
    beatLine: [0.35, 0.4, 0.47, 0.45],
    barLine: [0.55, 0.62, 0.7, 0.6],
    outOfLoop: [0, 0, 0, 0.45],
    keyWhite: [0.82, 0.84, 0.86, 1],
    keyBlack: [0.09, 0.1, 0.12, 1],
    keyDivider: [0.45, 0.48, 0.52, 1],
    noteOutline: [0, 0, 0, 0.6],
    selectedOutline: [1, 1, 1, 0.95],
    ghost: [0.6, 0.65, 0.72, 0.18],
    tie: [0.98, 0.75, 0.14, 0.9],
    cursor: [0.13, 0.83, 0.93, 1],
    marqueeFill: [0.13, 0.83, 0.93, 0.12],
    marqueeEdge: [0.13, 0.83, 0.93, 0.8],
    laneBackground: [0.03, 0.035, 0.045, 1],
    laneDivider: [0.25, 0.28, 0.33, 1],
    laneEmpty: [0.6, 0.65, 0.72, 0.25],
    playhead: [0.98, 0.98, 0.98, 0.85],
};

export interface RollSceneInput {
    layout: RollLayout;
    notes: readonly RollNote[];
    selected: ReadonlySet<string>;
    /** Notes of other tracks drawn dimmed behind this one. */
    ghosts?: readonly RollNote[];
    /** Track colour, 0–1 RGB. */
    color: readonly [number, number, number];
    /** Columns drawn (the longest loop in the song). */
    columns: number;
    /** This track's loop; steps at or past it are shaded. */
    loopLength: number;
    stepsPerBeat: number;
    stepsPerBar: number;
    /** Out-of-scale rows are shaded when a scale is set. */
    scale?: ScaleDefinition | null;
    laneProperty: LaneProperty;
    /** Keyboard cursor cell (position snapped to the grid unit). */
    cursor?: { position: number; pitch: number; width: number } | null;
    marquee?: RollRect | null;
    theme?: RollTheme;
}

export interface RollScene {
    quads: Float32Array<ArrayBuffer>;
    count: number;
}

const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);

class QuadWriter {
    private data: Float32Array<ArrayBuffer>;
    count = 0;

    constructor(capacity = 1024) {
        this.data = new Float32Array(capacity * QUAD_FLOATS);
    }

    push(clip: Rect, x: number, y: number, w: number, h: number, c: Rgba, alpha = 1): void {
        // Clip to the region; drop what is fully outside.
        const x0 = Math.max(x, clip.x);
        const y0 = Math.max(y, clip.y);
        const x1 = Math.min(x + w, clip.x + clip.w);
        const y1 = Math.min(y + h, clip.y + clip.h);
        if (x1 <= x0 || y1 <= y0) return;
        const a = c[3] * alpha;
        if (a <= 0) return;
        if ((this.count + 1) * QUAD_FLOATS > this.data.length) {
            const grown = new Float32Array(this.data.length * 2);
            grown.set(this.data);
            this.data = grown;
        }
        const o = this.count * QUAD_FLOATS;
        const d = this.data;
        d[o] = x0;
        d[o + 1] = y0;
        d[o + 2] = x1 - x0;
        d[o + 3] = y1 - y0;
        d[o + 4] = c[0];
        d[o + 5] = c[1];
        d[o + 6] = c[2];
        d[o + 7] = a;
        this.count += 1;
    }

    outline(clip: Rect, x: number, y: number, w: number, h: number, c: Rgba, t = 1): void {
        this.push(clip, x, y, w, t, c);
        this.push(clip, x, y + h - t, w, t, c);
        this.push(clip, x, y + t, t, h - 2 * t, c);
        this.push(clip, x + w - t, y + t, t, h - 2 * t, c);
    }

    finish(): RollScene {
        return { quads: this.data.subarray(0, this.count * QUAD_FLOATS), count: this.count };
    }
}

function mix(a: readonly [number, number, number], b: readonly [number, number, number], t: number): Rgba {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, 1];
}

const DARK: readonly [number, number, number] = [0.05, 0.06, 0.08];
const LIGHT: readonly [number, number, number] = [1, 1, 1];

/** Fill colour for a note: brightness follows velocity, selection lightens. */
export function noteFill(color: readonly [number, number, number], velocity: number, selected: boolean, chordTone: boolean): Rgba {
    const base = mix(DARK, color, 0.45 + 0.55 * Math.min(1, Math.max(0, velocity)));
    const rgb: [number, number, number] = [base[0], base[1], base[2]];
    if (chordTone) {
        rgb[0] *= 0.85;
        rgb[1] *= 0.85;
        rgb[2] *= 0.85;
    }
    return selected ? mix(rgb, LIGHT, 0.35) : [rgb[0], rgb[1], rgb[2], 1];
}

function laneValue(note: RollNote, property: LaneProperty): number | null {
    if (property === 'velocity') return note.velocity;
    if (property === 'probability') return note.probability;
    return note.timbre;
}

export function buildRollScene(input: RollSceneInput): RollScene {
    const theme = input.theme ?? DEFAULT_ROLL_THEME;
    const l = input.layout;
    const grid = gridRect(l);
    const lane = laneRect(l);
    const keys = keysRect(l);
    const out = new QuadWriter(Math.max(256, input.notes.length * 2 + 512));
    const { low, high } = visiblePitchRange(l);
    const { first, last } = visibleStepRange(l, Math.max(1, input.columns));
    const contentRight = stepToX(l, input.columns);

    // Grid background + rows.
    out.push(grid, grid.x, grid.y, grid.w, grid.h, theme.background);
    for (let pitch = low; pitch <= high; pitch++) {
        const y = pitchToY(l, pitch);
        const pc = pitch % 12;
        if (BLACK_KEYS.has(pc)) out.push(grid, grid.x, y, contentRight - grid.x, l.rowHeight, theme.rowBlackKey);
        if (input.scale && !isMidiInScale(pitch, input.scale)) {
            out.push(grid, grid.x, y, contentRight - grid.x, l.rowHeight, theme.rowOutOfScale);
        }
        // Octave boundary under each C.
        if (pc === 0) out.push(grid, grid.x, y + l.rowHeight - 1, contentRight - grid.x, 1, theme.rowOctave);
    }

    // Vertical lines: step, beat, bar.
    const beat = Math.max(1, input.stepsPerBeat);
    const bar = Math.max(1, input.stepsPerBar);
    for (let s = first; s <= Math.min(last + 1, input.columns); s++) {
        const x = Math.round(stepToX(l, s));
        const c = s % bar === 0 ? theme.barLine : s % beat === 0 ? theme.beatLine : theme.stepLine;
        out.push(grid, x, grid.y, 1, grid.h, c);
        out.push(lane, x, lane.y, 1, lane.h, c, 0.5);
    }

    // Out-of-loop shade.
    if (input.loopLength < input.columns) {
        const x = stepToX(l, input.loopLength);
        out.push(grid, x, grid.y, contentRight - x, grid.h, theme.outOfLoop);
    }

    // Ghost notes of other tracks.
    if (input.ghosts) {
        for (const n of input.ghosts) {
            if (n.pitch < low || n.pitch > high) continue;
            out.push(grid, stepToX(l, n.start) + 1, pitchToY(l, n.pitch) + 1, n.length * l.pxPerStep - 2, l.rowHeight - 2, theme.ghost);
        }
    }

    // Slide ties: from the previous root note into each slid root.
    let prevRoot: RollNote | null = null;
    for (const n of input.notes) {
        if (n.voice !== 0) continue;
        if (n.slide && prevRoot) {
            const x0 = stepToX(l, prevRoot.start + prevRoot.length) - 1;
            const x1 = stepToX(l, n.start) + 1;
            const yPrev = pitchToY(l, prevRoot.pitch) + l.rowHeight / 2;
            const yThis = pitchToY(l, n.pitch) + l.rowHeight / 2;
            out.push(grid, Math.min(x0, x1), yPrev - 1, Math.abs(x1 - x0) + 2, 2, theme.tie);
            out.push(grid, x1 - 2, Math.min(yPrev, yThis) - 1, 2, Math.abs(yThis - yPrev) + 2, theme.tie);
        }
        prevRoot = n;
    }

    // Notes.
    for (const n of input.notes) {
        if (n.pitch < low || n.pitch > high) continue;
        const x = stepToX(l, n.start) + 1;
        const y = pitchToY(l, n.pitch) + 1;
        const w = Math.max(2, n.length * l.pxPerStep - 2);
        const h = Math.max(2, l.rowHeight - 2);
        const selected = input.selected.has(n.id);
        // Below-certain probability reads as translucent.
        const alpha = 0.55 + 0.45 * n.probability;
        out.push(grid, x, y, w, h, noteFill(input.color, n.velocity, selected, n.voice > 0), alpha);
        out.outline(grid, x, y, w, h, selected ? theme.selectedOutline : theme.noteOutline, selected ? 2 : 1);
    }

    // Marquee.
    if (input.marquee) {
        const m = input.marquee;
        const x0 = stepToX(l, Math.min(m.start, m.end));
        const x1 = stepToX(l, Math.max(m.start, m.end));
        const y0 = pitchToY(l, Math.max(m.low, m.high));
        const y1 = pitchToY(l, Math.min(m.low, m.high)) + l.rowHeight;
        out.push(grid, x0, y0, x1 - x0, y1 - y0, theme.marqueeFill);
        out.outline(grid, x0, y0, x1 - x0, y1 - y0, theme.marqueeEdge);
    }

    // Keyboard cursor.
    if (input.cursor) {
        const c = input.cursor;
        out.outline(grid, stepToX(l, c.position), pitchToY(l, c.pitch), Math.max(2, c.width * l.pxPerStep), l.rowHeight, theme.cursor, 2);
    }

    // Keys column (drawn over the grid's left edge).
    for (let pitch = low; pitch <= high; pitch++) {
        const y = pitchToY(l, pitch);
        const black = BLACK_KEYS.has(pitch % 12);
        out.push(keys, keys.x, y, keys.w, l.rowHeight, black ? theme.keyBlack : theme.keyWhite);
        out.push(keys, keys.x, y + l.rowHeight - 1, keys.w, 1, theme.keyDivider, black ? 0.4 : 0.6);
    }
    out.push(keys, keys.x + keys.w - 1, keys.y, 1, keys.h, theme.keyDivider);

    // Lane.
    out.push(lane, lane.x, lane.y, lane.w, lane.h, theme.laneBackground);
    out.push(lane, lane.x, lane.y, lane.w, 1, theme.laneDivider);
    const seen = new Set<number>();
    for (const n of input.notes) {
        if (n.voice !== 0 || seen.has(n.step)) continue;
        seen.add(n.step);
        const value = laneValue(n, input.laneProperty);
        const x = stepToX(l, n.start) + 2;
        const w = Math.max(3, Math.min(l.pxPerStep * 0.45, 10));
        const usable = lane.h - 6;
        if (value === null) {
            out.push(lane, x, lane.y + lane.h - 3 - usable / 2, w, 2, theme.laneEmpty);
            continue;
        }
        const h = Math.max(1, value * usable);
        const selected = input.selected.has(n.id);
        out.push(lane, x, lane.y + lane.h - 3 - h, w, h, noteFill(input.color, 1, selected, false));
    }

    return out.finish();
}

/** The playhead quad at `position` (steps), or null when it is off-screen / stopped. */
export function playheadQuad(layout: RollLayout, position: number | null, theme: RollTheme = DEFAULT_ROLL_THEME): Float32Array<ArrayBuffer> | null {
    if (position === null) return null;
    const x = stepToX(layout, position);
    const grid = gridRect(layout);
    if (x < grid.x || x > grid.x + grid.w) return null;
    const c = theme.playhead;
    return new Float32Array([x - 1, 0, 2, layout.height, c[0], c[1], c[2], c[3]]);
}

/** `#rrggbb` → 0–1 RGB. */
export function hexToRgb(hex: string): [number, number, number] {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
    if (!m) return [0.6, 0.6, 0.6];
    return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
}

