/**
 * Frame loop + backend choice for the piano roll.
 *
 * `RollPainter` holds what is drawn (layout + scene input) outside React.
 * Edits, scrolling and drag previews write to it and mark it dirty; one
 * `requestAnimationFrame` loop rebuilds the scene only when dirty and
 * otherwise redraws just the moving playhead — so playback never re-renders
 * a React component and an idle roll submits nothing.
 *
 * Backend: WebGPU through `startGpuCanvasSession` (a lost device is rebuilt
 * on the restored one), Canvas2D on a second canvas when the probe fails
 * (`useQuadCanvas`, shared with the arrangement's waveforms).
 */
import { useMemo, type RefObject } from 'react';
import type { TrackKey } from '@/types';
import { engineTelemetry } from '@/utils/engineTelemetry';
import { playheadPosition, transportPlayhead } from '@/sequencer/transportPlayhead';
import { DEFAULT_LAYOUT, type RollLayout } from '../model/rollGeometry';
import { buildRollScene, playheadQuad, type RollScene, type RollSceneInput } from './rollScene';
import type { RollBackend, RollRenderer } from './rollRenderers';
import { useQuadCanvas, type QuadPainter } from './useQuadCanvas';

export type SceneInputWithoutLayout = Omit<RollSceneInput, 'layout'>;

export class RollPainter implements QuadPainter {
    layout: RollLayout = { ...DEFAULT_LAYOUT };
    private input: SceneInputWithoutLayout | null = null;
    private renderer: RollRenderer | null = null;
    private scene: RollScene | null = null;
    private dirty = true;
    private lastPlayhead: number | null = null;
    /** Track whose playhead is drawn. */
    playheadTrack: TrackKey | null = null;
    /** Frames that actually drew (tests, perf HUD). */
    drawCount = 0;
    sceneBuilds = 0;

    getRenderer(): RollRenderer | null {
        return this.renderer;
    }

    setRenderer(renderer: RollRenderer | null): void {
        this.renderer = renderer;
        this.dirty = true;
    }

    setLayout(patch: Partial<RollLayout>): void {
        let changed = false;
        for (const key of Object.keys(patch) as (keyof RollLayout)[]) {
            const value = patch[key];
            if (value !== undefined && this.layout[key] !== value) {
                this.layout[key] = value;
                changed = true;
            }
        }
        if (changed) this.dirty = true;
    }

    setInput(input: SceneInputWithoutLayout): void {
        this.input = input;
        this.dirty = true;
    }

    getInput(): SceneInputWithoutLayout | null {
        return this.input;
    }

    invalidate(): void {
        this.dirty = true;
    }

    setPlayheadTrack(track: TrackKey | null): void {
        this.playheadTrack = track;
        this.dirty = true;
    }

    /** Draw if anything changed since the last frame. Returns true when it drew. */
    tick(now: number): boolean {
        if (!this.renderer || !this.input) return false;
        const position = this.playheadTrack ? playheadPosition(transportPlayhead.get(), this.playheadTrack, now) : null;
        if (!this.dirty && position === this.lastPlayhead) return false;
        const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
        if (this.dirty || !this.scene) {
            this.scene = buildRollScene({ ...this.input, layout: this.layout });
            this.sceneBuilds += 1;
        }
        this.renderer.draw({
            scene: this.scene,
            playhead: playheadQuad(this.layout, position),
            layout: this.layout,
        });
        this.dirty = false;
        this.lastPlayhead = position;
        this.drawCount += 1;
        if (typeof performance !== 'undefined') {
            try {
                engineTelemetry.recordLatency(`piano-roll-${this.renderer.kind}`, performance.now() - t0);
            } catch {
                /* telemetry optional */
            }
        }
        return true;
    }
}

const DEGRADATION_ID = 'webgpu-piano-roll';

export function useRollPainter(
    gpuCanvasRef: RefObject<HTMLCanvasElement | null>,
    canvas2dRef: RefObject<HTMLCanvasElement | null>,
): { painter: RollPainter; backend: RollBackend | 'pending' } {
    const painter = useMemo(() => new RollPainter(), []);
    const backend = useQuadCanvas(painter, gpuCanvasRef, canvas2dRef, {
        degradationId: DEGRADATION_ID,
        fallbackMessage: 'Piano roll using Canvas2D fallback',
    });
    return { painter, backend };
}
