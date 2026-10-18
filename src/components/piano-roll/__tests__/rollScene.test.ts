import { describe, expect, it } from 'vitest';
import type { Note } from '@/types';
import { stepsToRollNotes } from '../model/rollModel';
import { DEFAULT_LAYOUT, gridRect, hitTest, laneRect, pitchToY, stepToX, type RollLayout } from '../model/rollGeometry';
import { buildRollScene, DEFAULT_ROLL_THEME, playheadQuad, QUAD_FLOATS, type RollSceneInput } from '../render/rollScene';

const n = (note: string, extra: Partial<Note> = {}): Note => ({ note, velocity: 1, length: 1, slide: false, ...extra });

const layout: RollLayout = { ...DEFAULT_LAYOUT, width: 600, height: 300, scrollY: pitchToY({ ...DEFAULT_LAYOUT, scrollY: 0 }, 72) };

function input(steps: (Note | null)[], extra: Partial<RollSceneInput> = {}): RollSceneInput {
    return {
        layout,
        notes: stepsToRollNotes(steps),
        selected: new Set(),
        color: [0, 0.7, 0.8],
        columns: 32,
        loopLength: 32,
        stepsPerBeat: 4,
        stepsPerBar: 16,
        laneProperty: 'velocity',
        ...extra,
    };
}

function quads(scene: { quads: Float32Array; count: number }) {
    const out: number[][] = [];
    for (let i = 0; i < scene.count; i++) out.push(Array.from(scene.quads.subarray(i * QUAD_FLOATS, (i + 1) * QUAD_FLOATS)));
    return out;
}

function isNoteFill(q: number[], l: RollLayout, step: number, pitch: number, length = 1) {
    return q[0] === stepToX(l, step) + 1 && q[1] === pitchToY(l, pitch) + 1 && q[2] === length * l.pxPerStep - 2 && q[3] === l.rowHeight - 2;
}

describe('buildRollScene', () => {
    it('draws one filled rectangle per note voice at its step / pitch / length', () => {
        const scene = buildRollScene(input([n('C5', { length: 2 }), null, n('A4', { chord: ['C5'] })]));
        const all = quads(scene);
        expect(all.filter((q) => isNoteFill(q, layout, 0, 72, 2))).toHaveLength(1);
        expect(all.filter((q) => isNoteFill(q, layout, 2, 69))).toHaveLength(1);
        expect(all.filter((q) => isNoteFill(q, layout, 2, 72))).toHaveLength(1);
    });

    it('clips every quad to its region', () => {
        const scene = buildRollScene(input([n('C5', { length: 40 })]));
        const grid = gridRect(layout);
        const lane = laneRect(layout);
        for (const q of quads(scene)) {
            const inGrid = q[0] >= grid.x - 1e-6 && q[0] + q[2] <= grid.x + grid.w + 1e-6 && q[1] >= 0 && q[1] + q[3] <= grid.h + 1e-6;
            const inLane = q[1] >= lane.y - 1e-6 && q[1] + q[3] <= layout.height + 1e-6;
            const inKeys = q[0] + q[2] <= layout.keysWidth + 1e-6;
            expect(inGrid || inLane || inKeys).toBe(true);
            expect(q[2]).toBeGreaterThan(0);
            expect(q[3]).toBeGreaterThan(0);
        }
    });

    it('culls notes outside the visible pitch window', () => {
        const visible = quads(buildRollScene(input([n('C5')]))).length;
        const hidden = quads(buildRollScene(input([n('C0')]))).length;
        expect(hidden).toBeLessThan(visible);
    });

    it('outlines selected notes in the selection colour and draws the cursor and marquee', () => {
        const steps = [n('C5')];
        const plain = quads(buildRollScene(input(steps)));
        const selected = quads(buildRollScene(input(steps, {
            selected: new Set(['0:0']),
            cursor: { position: 4, pitch: 70, width: 1 },
            marquee: { start: 1, end: 3, low: 70, high: 71 },
        })));
        const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
        const isSel = (q: number[]) => near(q[4], DEFAULT_ROLL_THEME.selectedOutline[0]) && near(q[7], DEFAULT_ROLL_THEME.selectedOutline[3]);
        expect(plain.some(isSel)).toBe(false);
        expect(selected.filter(isSel).length).toBe(4);
        expect(selected.some((q) => near(q[4], DEFAULT_ROLL_THEME.cursor[0]) && near(q[5], DEFAULT_ROLL_THEME.cursor[1]))).toBe(true);
        expect(selected.some((q) => near(q[7], DEFAULT_ROLL_THEME.marqueeFill[3]))).toBe(true);
    });

    it('scales the lane bar by the lane property', () => {
        const lane = laneRect(layout);
        const scene = (velocity: number) => quads(buildRollScene(input([n('C5', { velocity })])))
            .filter((q) => q[1] >= lane.y + 1 && q[0] === stepToX(layout, 0) + 2);
        const loud = scene(1)[0];
        const soft = scene(0.25)[0];
        expect(soft[3]).toBeCloseTo(loud[3] / 4, 5);
    });

    it('stays well inside budget at 8 tracks × 64 steps × 4-note chords', () => {
        const chord = n('C5', { chord: ['E5', 'G5', 'B5'] });
        const many = Array.from({ length: 64 }, () => chord);
        const ghosts = Array.from({ length: 7 }, () => stepsToRollNotes(many)).flat();
        const wide = { ...layout, width: 64 * DEFAULT_LAYOUT.pxPerStep + 48 };
        const t0 = performance.now();
        const scene = buildRollScene({ ...input(many), layout: wide, columns: 64, loopLength: 64, ghosts });
        const ms = performance.now() - t0;
        expect(scene.count).toBeGreaterThan(64 * 4);
        // A scene rebuild is per edit, not per frame; even so it is a small
        // fraction of a 16.7 ms frame on a CI runner.
        expect(ms).toBeLessThan(50);
    });
});

describe('playheadQuad', () => {
    it('is a 2px full-height quad at the position, null when stopped or off-screen', () => {
        const q = playheadQuad(layout, 3.5)!;
        expect(q[0]).toBe(stepToX(layout, 3.5) - 1);
        expect(q[2]).toBe(2);
        expect(q[3]).toBe(layout.height);
        expect(playheadQuad(layout, null)).toBeNull();
        expect(playheadQuad(layout, 500)).toBeNull();
    });
});

describe('hitTest', () => {
    it('resolves keys / grid note body / note end / lane', () => {
        const notes = stepsToRollNotes([n('C5', { length: 2 })]);
        const y = pitchToY(layout, 72) + 4;
        expect(hitTest(layout, notes, 10, y)).toMatchObject({ region: 'keys', pitch: 72 });
        expect(hitTest(layout, notes, stepToX(layout, 0.5), y)).toMatchObject({ region: 'grid', edge: 'body' });
        expect(hitTest(layout, notes, stepToX(layout, 2) - 2, y)).toMatchObject({ region: 'grid', edge: 'end' });
        expect(hitTest(layout, notes, stepToX(layout, 5), y)).toMatchObject({ region: 'grid', note: null, pitch: 72 });
        const lane = laneRect(layout);
        expect(hitTest(layout, notes, stepToX(layout, 1), lane.y + lane.h / 2)).toMatchObject({ region: 'lane', value: 0.5 });
    });
});
