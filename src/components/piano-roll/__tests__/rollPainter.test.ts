import { afterEach, describe, expect, it, vi } from 'vitest';
import { RollPainter } from '../render/useRollPainter';
import type { RollFrame, RollRenderer } from '../render/rollRenderers';
import { transportPlayhead } from '@/sequencer/transportPlayhead';

function fakeRenderer() {
    const frames: RollFrame[] = [];
    const renderer: RollRenderer = { kind: 'canvas2d', draw: (f) => frames.push(f), dispose: vi.fn() };
    return { renderer, frames };
}

const input = {
    notes: [],
    selected: new Set<string>(),
    color: [1, 1, 1] as const,
    columns: 16,
    loopLength: 16,
    stepsPerBeat: 4,
    stepsPerBar: 16,
    laneProperty: 'velocity' as const,
};

const steps = { partA: -1, partB: -1, bass2: -1, kick: -1, snare: -1, closedHat: -1, openHat: -1, sampler: -1 };

describe('RollPainter', () => {
    afterEach(() => transportPlayhead.stop());

    it('submits nothing while idle and rebuilds the scene only on change', () => {
        const painter = new RollPainter();
        const { renderer, frames } = fakeRenderer();
        painter.setRenderer(renderer);
        painter.setInput(input);
        expect(painter.tick(0)).toBe(true);
        for (let t = 1; t < 30; t++) expect(painter.tick(t)).toBe(false);
        expect(frames).toHaveLength(1);

        painter.setLayout({ scrollX: 40 });
        expect(painter.tick(31)).toBe(true);
        painter.setLayout({ scrollX: 40 });
        expect(painter.tick(32)).toBe(false);
        expect(painter.sceneBuilds).toBe(2);
    });

    it('moves only the playhead during playback, reusing the scene', () => {
        const painter = new RollPainter();
        const { renderer, frames } = fakeRenderer();
        painter.setRenderer(renderer);
        painter.setInput(input);
        painter.playheadTrack = 'partA';
        painter.tick(0);
        const builds = painter.sceneBuilds;

        transportPlayhead.publish(4, { ...steps, partA: 4 }, 0.125);
        const at = transportPlayhead.get().at;
        expect(painter.tick(at)).toBe(true);
        expect(painter.tick(at + 40)).toBe(true);
        expect(painter.sceneBuilds).toBe(builds);
        expect(frames.at(-1)?.scene).toBe(frames.at(-2)?.scene);
        expect(frames.at(-1)?.playhead).not.toBeNull();
        expect(frames.at(-1)!.playhead![0]).toBeGreaterThan(frames.at(-2)!.playhead![0]);

        transportPlayhead.stop();
        expect(painter.tick(at + 80)).toBe(true);
        expect(frames.at(-1)?.playhead).toBeNull();
    });

    it('waits for a renderer (device lost / not yet probed)', () => {
        const painter = new RollPainter();
        painter.setInput(input);
        expect(painter.tick(0)).toBe(false);
        const { renderer, frames } = fakeRenderer();
        painter.setRenderer(renderer);
        expect(painter.tick(1)).toBe(true);
        expect(frames).toHaveLength(1);
    });
});
