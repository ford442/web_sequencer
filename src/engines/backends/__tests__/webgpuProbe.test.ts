import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    probeWebGPU,
    getLastWebGpuProbe,
    resetWebGpuProbeForTests,
} from '../webgpuProbe';

describe('probeWebGPU', () => {
    beforeEach(() => {
        resetWebGpuProbeForTests();
    });

    afterEach(() => {
        resetWebGpuProbeForTests();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('fails once when navigator.gpu is missing and does not call requestAdapter later', async () => {
        const requestAdapter = vi.fn();
        vi.stubGlobal('navigator', { gpu: undefined });

        const first = await probeWebGPU();
        expect(first.ok).toBe(false);
        expect(first.reason).toMatch(/navigator\.gpu unavailable/);
        expect(getLastWebGpuProbe()).toBe(first);

        vi.stubGlobal('navigator', { gpu: { requestAdapter } });
        const second = await probeWebGPU();
        expect(second).toBe(first);
        expect(requestAdapter).not.toHaveBeenCalled();
    });

    it('records Chrome vs Edge adapter-null failure without requesting a device', async () => {
        const requestDevice = vi.fn();
        vi.stubGlobal('navigator', {
            userAgent: 'Mozilla/5.0 Edg/120.0.0.0 Chrome/120.0.0.0',
            userAgentData: {
                brands: [{ brand: 'Microsoft Edge', version: '120' }],
                platform: 'Windows',
            },
            gpu: {
                requestAdapter: vi.fn().mockResolvedValue(null),
            },
        });

        const probe = await probeWebGPU();
        expect(probe.ok).toBe(false);
        expect(probe.reason).toMatch(/requestAdapter\(\) returned null/);
        expect(probe.browser.engineHint).toBe('edge');
        expect(probe.device).toBeNull();
        expect(requestDevice).not.toHaveBeenCalled();
    });

    it('returns the same GPUDevice to concurrent and sequential callers', async () => {
        const device = { id: 'shared-device', lost: undefined };
        const requestDevice = vi.fn().mockResolvedValue(device);
        const requestAdapter = vi.fn().mockResolvedValue({ requestDevice });
        vi.stubGlobal('navigator', { gpu: { requestAdapter } });

        const [a, b] = await Promise.all([probeWebGPU(), probeWebGPU()]);
        const c = await probeWebGPU();

        expect(a.ok).toBe(true);
        expect(a.device).toBe(device);
        expect(b.device).toBe(device);
        expect(c.device).toBe(device);
        expect(requestAdapter).toHaveBeenCalledTimes(1);
        expect(requestDevice).toHaveBeenCalledTimes(1);
    });
});
