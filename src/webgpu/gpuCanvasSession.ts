/// <reference types="@webgpu/types" />
/**
 * Lifecycle for one canvas drawn on the shared GPUDevice.
 *
 * A canvas consumer supplies `create(device, surface)` — build pipelines and
 * buffers, start a frame loop, return something that can `dispose()` it all.
 * This module owns the rest: probing, configuring the canvas, tearing down
 * when the device is lost, and calling `create` again with the replacement
 * device when the probe restores one. Nothing built on a lost device is ever
 * reused, and no consumer keeps a dead `GPUDevice` around.
 */
import { onWebGpuDeviceChange, probeWebGPU, type WebGpuProbe } from '../engines/backends/webgpuProbe';
import { configureCanvas, unconfigureCanvas, type ConfiguredCanvas } from './configureCanvas';

export interface GpuCanvasSession {
    dispose(): void;
}

export interface GpuCanvasSessionOptions {
    /** Build everything for `device`; called again after every device restore. */
    create: (device: GPUDevice, surface: ConfiguredCanvas) => GpuCanvasSession | null;
    alphaMode?: GPUCanvasAlphaMode;
    colorSpace?: PredefinedColorSpace;
    /** WebGPU unavailable, recovery failed, or `create` threw: show the fallback. */
    onUnavailable?: (reason: string) => void;
    /** A session is running on `device` (first start or after a restore). */
    onActive?: (device: GPUDevice) => void;
    /** Defaults to the shared probe; injectable for tests. */
    probe?: () => Promise<WebGpuProbe>;
}

/** Start drawing `canvas` on the shared device. Returns the stop function. */
export function startGpuCanvasSession(canvas: HTMLCanvasElement, options: GpuCanvasSessionOptions): () => void {
    let stopped = false;
    let current: { device: GPUDevice; surface: ConfiguredCanvas; session: GpuCanvasSession } | null = null;

    const teardown = () => {
        if (!current) return;
        const { surface, session } = current;
        current = null;
        try {
            session.dispose();
        } catch (err) {
            console.error('[webgpu] canvas session dispose threw', err);
        }
        unconfigureCanvas(surface);
    };

    const unavailable = (reason: string) => {
        teardown();
        options.onUnavailable?.(reason);
    };

    const build = (probe: WebGpuProbe) => {
        if (stopped) return;
        if (!probe.ok || !probe.device) {
            unavailable(probe.reason ?? 'WebGPU unavailable');
            return;
        }
        const device = probe.device;
        if (current?.device === device) return;
        teardown();
        const surface = configureCanvas(canvas, {
            device,
            alphaMode: options.alphaMode,
            colorSpace: options.colorSpace,
        });
        if (!surface) {
            unavailable('canvas has no webgpu context');
            return;
        }
        try {
            const session = options.create(device, surface);
            if (!session) {
                unconfigureCanvas(surface);
                options.onUnavailable?.('GPU session declined to start');
                return;
            }
            current = { device, surface, session };
            options.onActive?.(device);
        } catch (err) {
            unconfigureCanvas(surface);
            options.onUnavailable?.(err instanceof Error ? err.message : String(err));
        }
    };

    const unsubscribe = onWebGpuDeviceChange((change) => {
        if (stopped) return;
        if (change.type === 'lost') {
            if (current?.device === change.device) teardown();
        } else if (change.type === 'restored') {
            build(change.probe);
        } else {
            unavailable(change.probe.reason ?? 'WebGPU unavailable');
        }
    });

    void (options.probe ?? probeWebGPU)().then(build, (err: unknown) => {
        if (!stopped) unavailable(err instanceof Error ? err.message : String(err));
    });

    return () => {
        stopped = true;
        unsubscribe();
        teardown();
    };
}
