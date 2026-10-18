import { describe, expect, it } from 'vitest';
import {
    buildSharedDeviceDescriptor,
    COMPUTE_CHAIN_MAX_BYTES,
    maxComputeElements,
    SHARED_DEVICE_LABEL,
    SHARED_DEVICE_LIMITS,
} from '../deviceRequirements';

function adapter(limits: Record<string, number> | undefined, features: string[] = []): GPUAdapter {
    return { limits, features: new Set(features) } as unknown as GPUAdapter;
}

describe('buildSharedDeviceDescriptor', () => {
    it('asks for every declared limit, never above what the adapter supports', () => {
        const generous = Object.fromEntries(
            Object.keys(SHARED_DEVICE_LIMITS).map((k) => [k, Number.MAX_SAFE_INTEGER]),
        );
        const d = buildSharedDeviceDescriptor(adapter(generous));
        expect(d.requiredLimits).toEqual(SHARED_DEVICE_LIMITS);

        const tight = buildSharedDeviceDescriptor(adapter({ maxStorageBufferBindingSize: 1024, maxBufferSize: 2048 }));
        expect(tight.requiredLimits).toEqual({ maxStorageBufferBindingSize: 1024, maxBufferSize: 2048 });
    });

    it('labels the device and queue and only requests features the adapter has', () => {
        const d = buildSharedDeviceDescriptor(adapter({}, ['timestamp-query', 'depth-clip-control']));
        expect(d.label).toBe(SHARED_DEVICE_LABEL);
        expect(d.defaultQueue?.label).toBeTruthy();
        expect(d.requiredFeatures).toEqual(['timestamp-query']);
        expect(buildSharedDeviceDescriptor(adapter({})).requiredFeatures).toEqual([]);
    });

    it('omits limits entirely when the adapter exposes none (old implementations, mocks)', () => {
        expect(buildSharedDeviceDescriptor(adapter(undefined)).requiredLimits).toEqual({});
    });

    it('declares the compute chain buffer as the largest storage binding', () => {
        expect(SHARED_DEVICE_LIMITS.maxStorageBufferBindingSize).toBe(COMPUTE_CHAIN_MAX_BYTES);
    });
});

describe('maxComputeElements', () => {
    it('is bounded by the workgroup count of one dispatch dimension, not just the byte guard', () => {
        const device = { limits: { maxStorageBufferBindingSize: COMPUTE_CHAIN_MAX_BYTES, maxComputeWorkgroupsPerDimension: 65535 } };
        // 64 MiB of f32 = 16.7 M elements, but 65535 workgroups × 64 = 4.19 M.
        expect(maxComputeElements(device as unknown as GPUDevice)).toBe(65535 * 64);
    });

    it('is bounded by the storage binding size when that is smaller', () => {
        const device = { limits: { maxStorageBufferBindingSize: 4096, maxComputeWorkgroupsPerDimension: 65535 } };
        expect(maxComputeElements(device as unknown as GPUDevice)).toBe(1024);
    });

    it('falls back to spec defaults without a device', () => {
        expect(maxComputeElements(null)).toBe(65535 * 64);
    });
});
