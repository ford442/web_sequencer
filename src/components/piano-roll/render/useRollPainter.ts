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
 * on the restored one), Canvas2D on a second canvas when the probe fails.
 */
import { useEffect, useMemo, useState, type RefObject } from 'react';
import type { TrackKey } from '@/types';
import { engineDegradationStore } from '@/stores/engineDegradationStore';
import { engineTelemetry } from '@/utils/engineTelemetry';
import { startGpuCanvasSession } from '@/webgpu/gpuCanvasSession';
import { playheadPosition, transportPlayhead } from '@/sequencer/transportPlayhead';
import { DEFAULT_LAYOUT, type RollLayout } from '../model/rollGeometry';
import { buildRollScene, playheadQuad, type RollScene, type RollSceneInput } from './rollScene';
import {
    createCanvas2dRollRenderer,
    createGpuRollRenderer,
    type RollBackend,
    type RollRenderer,
} from './rollRenderers';

export type SceneInputWithoutLayout = Omit<RollSceneInput, 'layout'>;

export class RollPainter {
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
    const [backend, setBackend] = useState<RollBackend | 'pending'>('pending');

    // WebGPU session on the shared device.
    useEffect(() => {
        const canvas = gpuCanvasRef.current;
        if (!canvas) return;
        return startGpuCanvasSession(canvas, {
            alphaMode: 'opaque',
            create: (device, surface) => {
                const renderer = createGpuRollRenderer(device, surface);
                painter.setRenderer(renderer);
                return {
                    dispose() {
                        if (painter.getRenderer() === renderer) painter.setRenderer(null);
                        renderer.dispose();
                    },
                };
            },
            onActive: () => {
                engineDegradationStore.resolve(DEGRADATION_ID);
                setBackend('webgpu');
            },
            onUnavailable: (reason) => {
                engineDegradationStore.report({
                    id: DEGRADATION_ID,
                    subsystem: DEGRADATION_ID,
                    category: 'gpu',
                    message: 'Piano roll using Canvas2D fallback',
                    reason,
                    status: 'active',
                    activeBackend: 'canvas-2d',
                    requestedBackend: 'webgpu',
                    retryable: false,
                });
                setBackend('canvas2d');
            },
        });
    }, [gpuCanvasRef, painter]);

    // Canvas2D fallback.
    useEffect(() => {
        if (backend !== 'canvas2d') return;
        const canvas = canvas2dRef.current;
        if (!canvas) return;
        const renderer = createCanvas2dRollRenderer(canvas);
        if (!renderer) return;
        painter.setRenderer(renderer);
        return () => {
            if (painter.getRenderer() === renderer) painter.setRenderer(null);
            renderer.dispose();
        };
    }, [backend, canvas2dRef, painter]);

    // One frame loop for the panel's lifetime.
    useEffect(() => {
        if (typeof requestAnimationFrame === 'undefined') return;
        let raf = 0;
        const loop = (now: number) => {
            painter.tick(now);
            raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(raf);
    }, [painter]);

    return { painter, backend };
}
