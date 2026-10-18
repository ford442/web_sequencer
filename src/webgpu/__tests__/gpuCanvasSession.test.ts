import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startGpuCanvasSession } from '../gpuCanvasSession';
import { resetWebGpuProbe, restartWebGpuDevice } from '../../engines/backends/webgpuProbe';

function makeDevice(label: string) {
    let resolveLost!: (info: GPUDeviceLostInfo) => void;
    const device = {
        label,
        lost: new Promise<GPUDeviceLostInfo>((r) => {
            resolveLost = r;
        }),
        destroy: vi.fn(() => resolveLost({ reason: 'destroyed', message: 'destroyed' } as GPUDeviceLostInfo)),
        lose: () => resolveLost({ reason: 'unknown', message: 'lost' } as unknown as GPUDeviceLostInfo),
    };
    return device;
}

describe('startGpuCanvasSession', () => {
    let context: { configure: ReturnType<typeof vi.fn>; unconfigure: ReturnType<typeof vi.fn> };
    let canvas: HTMLCanvasElement;

    beforeEach(() => {
        resetWebGpuProbe();
        context = { configure: vi.fn(), unconfigure: vi.fn() };
        canvas = document.createElement('canvas');
        canvas.getContext = vi.fn(() => context) as unknown as typeof canvas.getContext;
    });
    afterEach(() => {
        resetWebGpuProbe();
        vi.unstubAllGlobals();
    });

    function stubDevices(devices: ReturnType<typeof makeDevice>[]) {
        let i = 0;
        vi.stubGlobal('navigator', {
            gpu: {
                requestAdapter: vi.fn().mockResolvedValue({
                    requestDevice: vi.fn(async () => devices[Math.min(i++, devices.length - 1)]),
                }),
                getPreferredCanvasFormat: () => 'bgra8unorm',
            },
        });
    }

    it('rebuilds on the restored device after a loss and never reuses the old session', async () => {
        const first = makeDevice('first');
        const second = makeDevice('second');
        stubDevices([first, second]);
        const disposals: string[] = [];
        const create = vi.fn((device: GPUDevice) => ({ dispose: () => disposals.push(device.label) }));
        const onActive = vi.fn();

        const stop = startGpuCanvasSession(canvas, { create, onActive });
        await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
        expect(create.mock.calls[0]?.[0]).toBe(first);

        first.lose();
        await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(2));
        expect(disposals).toEqual(['first']);
        expect(create.mock.calls[1]?.[0]).toBe(second);
        expect(onActive).toHaveBeenCalledTimes(2);
        // Reconfigured on the new device.
        expect(context.configure).toHaveBeenLastCalledWith(expect.objectContaining({ device: second }));

        stop();
        expect(disposals).toEqual(['first', 'second']);
    });

    it('recovers through a forced restart (the e2e device-loss hook)', async () => {
        const first = makeDevice('first');
        const second = makeDevice('second');
        stubDevices([first, second]);
        const create = vi.fn(() => ({ dispose: vi.fn() }));
        const stop = startGpuCanvasSession(canvas, { create });
        await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));

        await restartWebGpuDevice('test');
        expect(create).toHaveBeenCalledTimes(2);
        stop();
    });

    it('reports unavailable when the probe fails and starts once a device appears', async () => {
        vi.stubGlobal('navigator', { gpu: undefined });
        const create = vi.fn(() => ({ dispose: vi.fn() }));
        const onUnavailable = vi.fn();
        const stop = startGpuCanvasSession(canvas, { create, onUnavailable });
        await vi.waitFor(() => expect(onUnavailable).toHaveBeenCalledWith(expect.stringMatching(/navigator\.gpu/)));
        expect(create).not.toHaveBeenCalled();

        stubDevices([makeDevice('late')]);
        await restartWebGpuDevice('power preference changed');
        expect(create).toHaveBeenCalledTimes(1);
        stop();
    });

    it('reports a create() failure as unavailable instead of throwing', async () => {
        stubDevices([makeDevice('first')]);
        const onUnavailable = vi.fn();
        const stop = startGpuCanvasSession(canvas, {
            create: () => {
                throw new Error('pipeline failed');
            },
            onUnavailable,
        });
        await vi.waitFor(() => expect(onUnavailable).toHaveBeenCalledWith('pipeline failed'));
        stop();
    });
});
