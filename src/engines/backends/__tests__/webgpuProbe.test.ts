import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import {
    probeWebGPU,
    getLastWebGpuProbe,
    resetWebGpuProbe,
    onWebGpuDeviceChange,
    restartWebGpuDevice,
    type WebGpuDeviceChange,
} from '../webgpuProbe';
import { engineTelemetry } from '../../../utils/engineTelemetry';
import { GPU_POWER_PREFERENCE_STORAGE_KEY } from '../../../webgpu/powerPreference';
import { SHARED_DEVICE_LABEL } from '../../../webgpu/deviceRequirements';

describe('probeWebGPU', () => {
    beforeEach(() => {
        resetWebGpuProbe();
    });

    afterEach(() => {
        resetWebGpuProbe();
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

// ── Device lifecycle (#1345 Phase 0) ────────────────────────────────────────

type MockDevice = {
    label: string;
    lost: Promise<GPUDeviceLostInfo>;
    lose: (reason: string, message?: string) => void;
    destroy: Mock<() => void>;
    features: Set<string>;
    limits: Record<string, number>;
    listeners: Map<string, Array<(e: unknown) => void>>;
    addEventListener: (type: string, cb: (e: unknown) => void) => void;
};

function makeDevice(label = SHARED_DEVICE_LABEL): MockDevice {
    let resolveLost!: (info: GPUDeviceLostInfo) => void;
    const lost = new Promise<GPUDeviceLostInfo>((resolve) => {
        resolveLost = resolve;
    });
    const listeners = new Map<string, Array<(e: unknown) => void>>();
    const device: MockDevice = {
        label,
        lost,
        lose: (reason, message = 'lost in test') =>
            resolveLost({ reason, message } as unknown as GPUDeviceLostInfo),
        destroy: vi.fn<() => void>(() => device.lose('destroyed', 'destroy() called')),
        features: new Set(['timestamp-query']),
        limits: { maxStorageBufferBindingSize: 128 * 1024 * 1024, maxComputeWorkgroupsPerDimension: 65535 },
        listeners,
        addEventListener: (type, cb) => {
            const list = listeners.get(type) ?? [];
            list.push(cb);
            listeners.set(type, list);
        },
    };
    return device;
}

function stubGpu(devices: MockDevice[], adapterExtras: Record<string, unknown> = {}) {
    let next = 0;
    const requestDevice = vi.fn(async (_descriptor?: GPUDeviceDescriptor) => {
        const device = devices[Math.min(next, devices.length - 1)];
        next += 1;
        return device;
    });
    const adapter = {
        requestDevice,
        features: new Set(['timestamp-query', 'shader-f16']),
        limits: {
            maxStorageBufferBindingSize: 32 * 1024 * 1024,
            maxBufferSize: 256 * 1024 * 1024,
            maxStorageBuffersPerShaderStage: 8,
            maxComputeInvocationsPerWorkgroup: 256,
            maxComputeWorkgroupSizeX: 256,
            maxComputeWorkgroupsPerDimension: 65535,
        },
        ...adapterExtras,
    };
    const requestAdapter = vi.fn().mockResolvedValue(adapter);
    vi.stubGlobal('navigator', { gpu: { requestAdapter } });
    return { requestAdapter, requestDevice, adapter };
}

async function flush(): Promise<void> {
    for (let i = 0; i < 8; i++) await Promise.resolve();
}

describe('probeWebGPU device descriptor', () => {
    beforeEach(() => {
        resetWebGpuProbe();
        localStorage.removeItem(GPU_POWER_PREFERENCE_STORAGE_KEY);
    });
    afterEach(() => {
        resetWebGpuProbe();
        localStorage.removeItem(GPU_POWER_PREFERENCE_STORAGE_KEY);
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('requests the adapter with the stored power preference (default high-performance)', async () => {
        const { requestAdapter } = stubGpu([makeDevice()]);
        const probe = await probeWebGPU();
        expect(requestAdapter).toHaveBeenCalledWith({ powerPreference: 'high-performance' });
        expect(probe.powerPreference).toBe('high-performance');

        resetWebGpuProbe();
        localStorage.setItem(GPU_POWER_PREFERENCE_STORAGE_KEY, 'low-power');
        await probeWebGPU();
        expect(requestAdapter).toHaveBeenLastCalledWith({ powerPreference: 'low-power' });
    });

    it('requests a labelled device with only the features it uses and limits clamped to the adapter', async () => {
        const { requestDevice } = stubGpu([makeDevice()]);
        const probe = await probeWebGPU();
        const descriptor = requestDevice.mock.calls[0]?.[0] as unknown as GPUDeviceDescriptor;
        expect(descriptor.label).toBe(SHARED_DEVICE_LABEL);
        expect(descriptor.requiredFeatures).toEqual(['timestamp-query']);
        const limits = descriptor.requiredLimits as Record<string, number>;
        // The compute chain wants 64 MiB; this adapter only binds 32 MiB.
        expect(limits.maxStorageBufferBindingSize).toBe(32 * 1024 * 1024);
        expect(limits.maxBufferSize).toBe(64 * 1024 * 1024);
        expect(limits.maxComputeWorkgroupsPerDimension).toBe(65535);
        expect(probe.deviceInfo?.timestampQuery).toBe(true);
        expect(probe.deviceInfo?.label).toBe(SHARED_DEVICE_LABEL);
    });

    it('skips timestamp-query when the adapter lacks it', async () => {
        const { requestDevice } = stubGpu([makeDevice()], { features: new Set<string>() });
        await probeWebGPU();
        const descriptor = requestDevice.mock.calls[0]?.[0] as unknown as GPUDeviceDescriptor;
        expect(descriptor.requiredFeatures).toEqual([]);
    });

    it('retries with defaults when the implementation rejects the descriptor', async () => {
        const device = makeDevice();
        const requestDevice = vi
            .fn()
            .mockRejectedValueOnce(new Error('unknown limit'))
            .mockResolvedValueOnce(device);
        vi.stubGlobal('navigator', {
            gpu: { requestAdapter: vi.fn().mockResolvedValue({ requestDevice }) },
        });
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const probe = await probeWebGPU();
        expect(probe.ok).toBe(true);
        expect(requestDevice).toHaveBeenCalledTimes(2);
        expect(requestDevice.mock.calls[1]?.[0]).toEqual({ label: SHARED_DEVICE_LABEL });
    });

    it('routes uncapturederror on the shared device to engineTelemetry', async () => {
        const device = makeDevice();
        stubGpu([device]);
        const record = vi.spyOn(engineTelemetry, 'recordWebGpuError');
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        await probeWebGPU();
        class GPUValidationError extends Error {}
        device.listeners.get('uncapturederror')?.[0]?.({ error: new GPUValidationError('bad binding') });
        expect(record).toHaveBeenCalledWith({
            type: 'GPUValidationError',
            message: 'bad binding',
            deviceLabel: SHARED_DEVICE_LABEL,
        });
    });
});

describe('probeWebGPU device loss', () => {
    let changes: WebGpuDeviceChange[];
    let unsubscribe: () => void;

    beforeEach(() => {
        resetWebGpuProbe();
        changes = [];
        unsubscribe = onWebGpuDeviceChange((c) => changes.push(c));
    });
    afterEach(() => {
        unsubscribe();
        resetWebGpuProbe();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('re-probes once on an unexpected loss and hands listeners the new device', async () => {
        const first = makeDevice('first');
        const second = makeDevice('second');
        const { requestDevice } = stubGpu([first, second]);
        const probe = await probeWebGPU();
        const generation = probe.generation ?? 0;

        first.lose('unknown', 'driver reset');
        await vi.waitFor(() => expect(changes.map((c) => c.type)).toEqual(['lost', 'restored']));

        const lost = changes[0] as Extract<WebGpuDeviceChange, { type: 'lost' }>;
        expect(lost.device).toBe(first);
        expect(lost.willRecover).toBe(true);
        const restored = changes[1] as Extract<WebGpuDeviceChange, { type: 'restored' }>;
        expect(restored.probe.device).toBe(second);
        expect(restored.previous).toBe(first);
        expect(restored.probe.generation).toBe(generation + 1);
        expect(requestDevice).toHaveBeenCalledTimes(2);
        expect((await probeWebGPU()).device).toBe(second);
    });

    it('does not re-probe after an ordinary destroy()', async () => {
        const first = makeDevice('first');
        const { requestDevice } = stubGpu([first, makeDevice('second')]);
        await probeWebGPU();

        first.destroy();
        await vi.waitFor(() => expect(changes).toHaveLength(1));
        await flush();
        expect(changes[0]).toMatchObject({ type: 'lost', reason: 'destroyed', willRecover: false });
        expect(requestDevice).toHaveBeenCalledTimes(1);
        // The cache is dropped, so the next consumer gets a fresh device lazily.
        expect((await probeWebGPU()).device?.label).toBe('second');
    });

    it('restartWebGpuDevice swaps the device through the same lost → restored path', async () => {
        const first = makeDevice('first');
        const second = makeDevice('second');
        stubGpu([first, second]);
        await probeWebGPU();

        const probe = await restartWebGpuDevice('test');
        expect(first.destroy).toHaveBeenCalledTimes(1);
        expect(probe.device).toBe(second);
        expect(changes.map((c) => c.type)).toEqual(['lost', 'restored']);
        expect(changes[0]).toMatchObject({ reason: 'destroyed', willRecover: true });
    });

    it('gives up after repeated losses inside the recovery window', async () => {
        const devices = [makeDevice('a'), makeDevice('b'), makeDevice('c'), makeDevice('d'), makeDevice('e')];
        stubGpu(devices);
        await probeWebGPU();
        for (let i = 0; i < 3; i++) {
            devices[i].lose('unknown');
            await vi.waitFor(() => expect(changes.filter((c) => c.type === 'restored')).toHaveLength(i + 1));
        }
        devices[3].lose('unknown');
        await vi.waitFor(() => expect(changes.at(-1)?.type).toBe('unavailable'));
        const last = await probeWebGPU();
        expect(last.ok).toBe(false);
        expect(last.reason).toMatch(/WebGPU disabled for this session/);
    });

    it('ignores the loss of a device that was already replaced', async () => {
        const first = makeDevice('first');
        const second = makeDevice('second');
        stubGpu([first, second]);
        await probeWebGPU();
        resetWebGpuProbe();
        await probeWebGPU(); // second is now current
        first.lose('unknown');
        await flush();
        expect(changes).toHaveLength(0);
    });
});
