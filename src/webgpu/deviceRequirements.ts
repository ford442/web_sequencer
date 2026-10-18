/// <reference types="@webgpu/types" />
/**
 * What the shared GPUDevice is asked for, in one place.
 *
 * The session has exactly one device (`probeWebGPU`). Every consumer — the
 * compute paths, the knobs, the scope, the curve editor, the piano roll —
 * shares it, so the descriptor is the union of what they bind. Each entry
 * names the consumer that needs it; a consumer that needs more must raise its
 * row here rather than assume the browser default.
 *
 * Limits are clamped to the adapter: asking for more than the adapter
 * supports rejects `requestDevice()` outright, and a smaller device is still
 * better than none. Consumers size their work from `device.limits` (see
 * `maxComputeElements`), never from these constants alone.
 */

export const SHARED_DEVICE_LABEL = 'hyphon-shared-device';
export const SHARED_QUEUE_LABEL = 'hyphon-shared-queue';

/** `WebGpuBackend.runChain` — voice-designer tensors, ping-ponged on the GPU. */
export const COMPUTE_CHAIN_MAX_BYTES = 64 * 1024 * 1024;
/** `WebGpu303Engine` — ~30 s of mono f32 at 48 kHz (freeze / multisample bounces). */
export const GPU_303_MAX_BYTES = 48_000 * 30 * 4;
/** `WebGpuOscillator` — ~5 s of mono f32 at 44.1 kHz. */
export const OSCILLATOR_MAX_BYTES = 44_100 * 5 * 4;

/** Every compute shader in the app uses `@workgroup_size(64)` or smaller. */
export const COMPUTE_WORKGROUP_SIZE = 64;

/**
 * The limits the app actually binds. `maxComputeWorkgroupsPerDimension` is the
 * one-dimensional dispatch `runChain` would need for its largest buffer; real
 * adapters cap it lower, which is why callers clamp through
 * `maxComputeElements` instead of trusting the byte guard.
 */
export const SHARED_DEVICE_LIMITS = {
    maxStorageBufferBindingSize: COMPUTE_CHAIN_MAX_BYTES,
    maxBufferSize: COMPUTE_CHAIN_MAX_BYTES,
    /** Curve editor + 303 engine bind two storage buffers in one compute stage. */
    maxStorageBuffersPerShaderStage: 2,
    maxComputeInvocationsPerWorkgroup: COMPUTE_WORKGROUP_SIZE,
    maxComputeWorkgroupSizeX: COMPUTE_WORKGROUP_SIZE,
    maxComputeWorkgroupsPerDimension: Math.ceil(COMPUTE_CHAIN_MAX_BYTES / 4 / COMPUTE_WORKGROUP_SIZE),
} as const;

export type SharedDeviceLimitName = keyof typeof SHARED_DEVICE_LIMITS;

/** Requested only when the adapter offers it: GPU pass timing for the perf HUD. */
export const OPTIONAL_DEVICE_FEATURES: readonly GPUFeatureName[] = ['timestamp-query'];

/** WebGPU spec defaults, used when a (mock or old) device exposes no `limits`. */
const SPEC_DEFAULT_LIMITS: Record<'maxStorageBufferBindingSize' | 'maxComputeWorkgroupsPerDimension', number> = {
    maxStorageBufferBindingSize: 128 * 1024 * 1024,
    maxComputeWorkgroupsPerDimension: 65_535,
};

function readLimit(limits: GPUSupportedLimits | undefined, name: string): number | undefined {
    if (!limits) return undefined;
    const value = (limits as unknown as Record<string, unknown>)[name];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * The descriptor `probeWebGPU` hands to `adapter.requestDevice()`: a label,
 * optional features the adapter actually has, and the limits above clamped to
 * what the adapter supports.
 */
export function buildSharedDeviceDescriptor(adapter: GPUAdapter): GPUDeviceDescriptor {
    const features = adapter.features;
    const requiredFeatures = OPTIONAL_DEVICE_FEATURES.filter(
        (feature) => typeof features?.has === 'function' && features.has(feature),
    );

    const requiredLimits: Record<string, number> = {};
    for (const name of Object.keys(SHARED_DEVICE_LIMITS) as SharedDeviceLimitName[]) {
        const supported = readLimit(adapter.limits, name);
        if (supported === undefined) continue;
        requiredLimits[name] = Math.min(SHARED_DEVICE_LIMITS[name], supported);
    }

    return {
        label: SHARED_DEVICE_LABEL,
        requiredFeatures,
        requiredLimits,
        defaultQueue: { label: SHARED_QUEUE_LABEL },
    };
}

/** JSON-safe view of what the device came up with, for the HUD and engine report. */
export function snapshotDeviceLimits(device: GPUDevice): Partial<Record<SharedDeviceLimitName, number>> {
    const out: Partial<Record<SharedDeviceLimitName, number>> = {};
    for (const name of Object.keys(SHARED_DEVICE_LIMITS) as SharedDeviceLimitName[]) {
        const value = readLimit(device.limits, name);
        if (value !== undefined) out[name] = value;
    }
    return out;
}

export function snapshotDeviceFeatures(device: GPUDevice): string[] {
    const out: string[] = [];
    const features = device.features;
    if (features && typeof features.forEach === 'function') {
        features.forEach((feature) => out.push(String(feature)));
    }
    return out.sort();
}

/**
 * Largest number of f32 elements one 1-D compute dispatch can cover on this
 * device: bounded by the storage binding size and by how many workgroups a
 * single dimension may launch.
 */
export function maxComputeElements(
    device: Pick<GPUDevice, 'limits'> | null | undefined,
    workgroupSize: number = COMPUTE_WORKGROUP_SIZE,
): number {
    const binding =
        readLimit(device?.limits, 'maxStorageBufferBindingSize') ?? SPEC_DEFAULT_LIMITS.maxStorageBufferBindingSize;
    const groups =
        readLimit(device?.limits, 'maxComputeWorkgroupsPerDimension') ??
        SPEC_DEFAULT_LIMITS.maxComputeWorkgroupsPerDimension;
    return Math.min(Math.floor(binding / 4), groups * workgroupSize);
}
