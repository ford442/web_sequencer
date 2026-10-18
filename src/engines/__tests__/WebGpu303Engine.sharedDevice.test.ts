/**
 * The gpu-highfid engine draws on the session's shared GPUDevice (#1345):
 * tearing the engine down must never destroy that device, and a device loss
 * must send the next render back through init on the restored device.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebGpu303Engine } from '@/engines/WebGpu303Engine';
import { probeWebGPU, resetWebGpuProbe, restartWebGpuDevice } from '@/engines/backends/webgpuProbe';

function makeDevice(label: string) {
    return {
        label,
        destroy: vi.fn(),
        createShaderModule: vi.fn(() => ({})),
        createBindGroupLayout: vi.fn(() => ({})),
        createPipelineLayout: vi.fn(() => ({})),
        createComputePipeline: vi.fn(() => ({})),
    };
}

describe('WebGpu303Engine on the shared device', () => {
    beforeEach(() => {
        resetWebGpuProbe();
        vi.stubGlobal('GPUShaderStage', { COMPUTE: 4 });
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
            },
        });
    }

    it('destroy() releases the engine without destroying the shared device', async () => {
        const shared = makeDevice('shared');
        stubDevices([shared]);
        const engine = new WebGpu303Engine();
        expect(await engine.init()).toBe(true);

        engine.destroy();
        expect(shared.destroy).not.toHaveBeenCalled();
        expect(engine.device).toBeNull();
        expect((await probeWebGPU()).device).toBe(shared);
    });

    it('re-initialises on the restored device after a loss', async () => {
        const first = makeDevice('first');
        const second = makeDevice('second');
        stubDevices([first, second]);
        const engine = new WebGpu303Engine();
        await engine.init();
        expect(engine.device).toBe(first);

        await restartWebGpuDevice('test');
        expect(engine.device).toBeNull();
        expect(await engine.init()).toBe(true);
        expect(engine.device).toBe(second);
        expect(second.createComputePipeline).toHaveBeenCalled();
        engine.destroy();
    });
});
