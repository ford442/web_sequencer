/**
 * What the arrangement's waveform canvas draws (#1629 P2), held outside
 * React. Scrolling, edits, drag previews and arriving peaks mark it dirty;
 * the frame loop (`useQuadCanvas`) draws only then, so an idle timeline
 * submits nothing.
 */
import { peakCache, type PeakCache } from '@/audio/media/peakCache';
import type { RollRenderer } from '../piano-roll/render/rollRenderers';
import type { QuadPainter } from '../piano-roll/render/useQuadCanvas';
import { buildWaveformScene, type WaveformSceneInput } from './waveformScene';

type PainterInput = Omit<WaveformSceneInput, 'width' | 'height' | 'scrollLeft' | 'peaks'>;

export class WaveformPainter implements QuadPainter {
    private renderer: RollRenderer | null = null;
    private input: PainterInput | null = null;
    private view = { width: 0, height: 0, scrollLeft: 0 };
    private dirty = true;
    private peaksVersion = -1;
    /** Frames that drew (tests). */
    drawCount = 0;
    private readonly cache: PeakCache;

    constructor(cache: PeakCache = peakCache) {
        this.cache = cache;
    }

    getRenderer(): RollRenderer | null {
        return this.renderer;
    }

    setRenderer(renderer: RollRenderer | null): void {
        this.renderer = renderer;
        this.dirty = true;
    }

    setInput(input: PainterInput): void {
        this.input = input;
        this.dirty = true;
    }

    setView(width: number, height: number, scrollLeft: number): void {
        const v = this.view;
        if (v.width === width && v.height === height && v.scrollLeft === scrollLeft) return;
        this.view = { width, height, scrollLeft };
        this.dirty = true;
    }

    /** Draw if anything changed since the last frame (peaks arriving included). */
    tick(): boolean {
        if (!this.renderer || !this.input) return false;
        if (this.cache.version !== this.peaksVersion) this.dirty = true;
        const { width, height } = this.view;
        if (!this.dirty || width < 1 || height < 1) return false;
        this.peaksVersion = this.cache.version;
        const scene = buildWaveformScene({ ...this.input, ...this.view, peaks: (id) => this.cache.get(id) });
        this.renderer.draw({ scene, playhead: null, layout: { width, height } });
        this.dirty = false;
        this.drawCount += 1;
        return true;
    }
}
