/**
 * The waveform painter (#1629 P2) draws only when something changed: its
 * input, the view (scroll, size) or the peaks it draws from.
 */
import { describe, expect, it, vi } from 'vitest';
import { MediaStore } from '@/audio/media/MediaStore';
import { PeakCache } from '@/audio/media/peakCache';
import { buildPeaks } from '@/audio/media/peaks';
import type { RollFrame, RollRenderer } from '../../piano-roll/render/rollRenderers';
import { WaveformPainter } from '../waveformPainter';

const MEDIA = 'a'.repeat(64);

function setup() {
    const cache = new PeakCache({ store: new MediaStore(), createWorker: null });
    const painter = new WaveformPainter(cache);
    const frames: RollFrame[] = [];
    const renderer: RollRenderer = { kind: 'canvas2d', draw: (f) => frames.push(f), dispose: vi.fn() };
    painter.setRenderer(renderer);
    painter.setInput({
        pxPerStep: 4, rowHeight: 34, insetTop: 3, insetBottom: 4, tracks: ['audio-1'],
        clips: [{ kind: 'audio', id: 'clip-1', track: 'audio-1', mediaId: MEDIA, startStep: 0, lengthSteps: 16, offsetFrames: 0, gainDb: 0, warp: 'off' }],
        media: { [MEDIA]: { name: 'a.wav', sampleRate: 48000, channels: 1, frames: 48000 } },
        clock: { tempo: 120, swing: 0 },
        selectedId: null,
    });
    return { cache, painter, frames };
}

describe('WaveformPainter', () => {
    it('waits for a size, then draws once and stays idle', () => {
        const { painter, frames } = setup();
        expect(painter.tick()).toBe(false);
        painter.setView(300, 34, 0);
        expect(painter.tick()).toBe(true);
        for (let i = 0; i < 10; i++) expect(painter.tick()).toBe(false);
        painter.setView(300, 34, 0);
        expect(painter.tick()).toBe(false);
        expect(frames).toHaveLength(1);
        expect(frames[0].layout).toEqual({ width: 300, height: 34 });
        expect(frames[0].playhead).toBeNull();
    });

    it('redraws on scroll and when the peaks arrive', () => {
        const { cache, painter, frames } = setup();
        painter.setView(300, 34, 0);
        painter.tick();
        // Loading: the zero line only.
        expect(frames[0].scene.count).toBe(1);
        painter.setView(300, 34, 8);
        expect(painter.tick()).toBe(true);
        cache.prime(MEDIA, buildPeaks([Float32Array.from({ length: 48000 }, (_, i) => (i & 1 ? 0.5 : -0.5))]));
        expect(painter.tick()).toBe(true);
        // The 1 s file covers 8 of the 16 steps: 32 px, less the 8 scrolled away, plus the zero line.
        expect(frames.at(-1)!.scene.count).toBe(25);
        expect(painter.tick()).toBe(false);
    });

    it('draws nothing without a renderer', () => {
        const { painter } = setup();
        painter.setRenderer(null);
        painter.setView(300, 34, 0);
        expect(painter.tick()).toBe(false);
        expect(painter.drawCount).toBe(0);
    });
});
