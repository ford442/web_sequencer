/**
 * Backend choice and frame loop for a canvas of quads (the piano roll, the
 * arrangement's waveforms).
 *
 * WebGPU through `startGpuCanvasSession` on the shared device (a lost device
 * is rebuilt on the restored one), Canvas2D on a second canvas when the probe
 * fails: a canvas that once gave out a `webgpu` context cannot give a 2D one.
 * One `requestAnimationFrame` loop calls `painter.tick` for the canvas's
 * lifetime; the painter decides whether anything needs drawing.
 */
import { useEffect, useState, type RefObject } from 'react';
import { engineDegradationStore } from '@/stores/engineDegradationStore';
import { startGpuCanvasSession } from '@/webgpu/gpuCanvasSession';
import {
    createCanvas2dRollRenderer,
    createGpuRollRenderer,
    type QuadRendererOptions,
    type RollBackend,
    type RollRenderer,
} from './rollRenderers';

/** What the loop drives: it owns the renderer and draws when it has something new. */
export interface QuadPainter {
    getRenderer(): RollRenderer | null;
    setRenderer(renderer: RollRenderer | null): void;
    tick(now: number): boolean;
}

export interface QuadCanvasOptions extends QuadRendererOptions {
    /** `engineDegradationStore` id reported when the canvas falls back to Canvas2D. */
    degradationId: string;
    /** What the degradation report says. */
    fallbackMessage: string;
}

export function useQuadCanvas(
    painter: QuadPainter,
    gpuCanvasRef: RefObject<HTMLCanvasElement | null>,
    canvas2dRef: RefObject<HTMLCanvasElement | null>,
    { degradationId, fallbackMessage, transparent }: QuadCanvasOptions,
): RollBackend | 'pending' {
    const [backend, setBackend] = useState<RollBackend | 'pending'>('pending');

    // WebGPU session on the shared device.
    useEffect(() => {
        const canvas = gpuCanvasRef.current;
        if (!canvas) return;
        return startGpuCanvasSession(canvas, {
            alphaMode: transparent ? 'premultiplied' : 'opaque',
            create: (device, surface) => {
                const renderer = createGpuRollRenderer(device, surface, { transparent });
                painter.setRenderer(renderer);
                return {
                    dispose() {
                        if (painter.getRenderer() === renderer) painter.setRenderer(null);
                        renderer.dispose();
                    },
                };
            },
            onActive: () => {
                engineDegradationStore.resolve(degradationId);
                setBackend('webgpu');
            },
            onUnavailable: (reason) => {
                engineDegradationStore.report({
                    id: degradationId,
                    subsystem: degradationId,
                    category: 'gpu',
                    message: fallbackMessage,
                    reason,
                    status: 'active',
                    activeBackend: 'canvas-2d',
                    requestedBackend: 'webgpu',
                    retryable: false,
                });
                setBackend('canvas2d');
            },
        });
    }, [degradationId, fallbackMessage, gpuCanvasRef, painter, transparent]);

    // Canvas2D fallback.
    useEffect(() => {
        if (backend !== 'canvas2d') return;
        const canvas = canvas2dRef.current;
        if (!canvas) return;
        const renderer = createCanvas2dRollRenderer(canvas, { transparent });
        if (!renderer) return;
        painter.setRenderer(renderer);
        return () => {
            if (painter.getRenderer() === renderer) painter.setRenderer(null);
            renderer.dispose();
        };
    }, [backend, canvas2dRef, painter, transparent]);

    // One frame loop for the canvas's lifetime.
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

    return backend;
}
