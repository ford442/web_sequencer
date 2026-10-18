/// <reference types="@webgpu/types" />
/**
 * Session-wide WebGPU probe: one adapter, one GPUDevice.
 * Voice backends may still fall back WASM/JS via BackendRegistry when this fails.
 * GPU viz/chores must hard-fail — never open a WebGL context.
 *
 * Device lifecycle (#1345 Phase 0):
 *
 * - The adapter is requested with the user's power preference
 *   (`src/webgpu/powerPreference.ts`, Engine HUD) and the device with an
 *   explicit descriptor (`src/webgpu/deviceRequirements.ts`).
 * - `uncapturederror` on the shared device goes to `engineTelemetry`.
 * - On `device.lost` the cached probe is dropped, every
 *   `onWebGpuDeviceChange` listener hears `lost`, and — unless the loss was
 *   an ordinary `destroy()` — the probe runs once more and listeners hear
 *   `restored` (new device: rebuild pipelines) or `unavailable` (fall back).
 *   A storm guard stops automatic recovery after repeated losses.
 * - `restartWebGpuDevice()` swaps the device on purpose (power-preference
 *   change, forced-loss test hook) through the same path.
 */
import { engineTelemetry } from '../../utils/engineTelemetry';
import {
    getStoredGpuPowerPreference,
    type GpuPowerPreference,
} from '../../webgpu/powerPreference';
import {
    buildSharedDeviceDescriptor,
    snapshotDeviceFeatures,
    snapshotDeviceLimits,
    SHARED_DEVICE_LABEL,
    type SharedDeviceLimitName,
} from '../../webgpu/deviceRequirements';

export type WebGpuAdapterSnapshot = {
    vendor?: string;
    architecture?: string;
    device?: string;
    description?: string;
};

export type WebGpuBrowserSnapshot = {
    brands?: unknown;
    platform?: string;
    engineHint: string;
};

/** What the shared device came up with (JSON-safe). */
export type WebGpuDeviceInfoSnapshot = {
    label: string;
    features: string[];
    limits: Partial<Record<SharedDeviceLimitName, number>>;
    timestampQuery: boolean;
};

/** JSON-safe probe result (no live GPU handles). HUD / engine reports. */
export type WebGpuProbeSnapshot = {
    ok: boolean;
    reason: string | null;
    browser: WebGpuBrowserSnapshot;
    adapter: WebGpuAdapterSnapshot | null;
    ts: number;
    /** Preference the adapter was requested with. Absent on pre-#1345 reports. */
    powerPreference?: GpuPowerPreference;
    /** Present when `ok`. */
    deviceInfo?: WebGpuDeviceInfoSnapshot | null;
    /** 1 for the first device of the session, +1 for every replacement. */
    generation?: number;
};

export type WebGpuProbe = WebGpuProbeSnapshot & {
    device: GPUDevice | null;
    adapterHandle: GPUAdapter | null;
};

export type WebGpuDeviceChange =
    /** The device is gone. Stop submitting and release everything built on it. */
    | {
          type: 'lost';
          device: GPUDevice;
          reason: string;
          message: string;
          /** True when a re-probe follows (a `restored` or `unavailable` event). */
          willRecover: boolean;
      }
    /** A new device replaced the lost one. Rebuild pipelines from `probe.device`. */
    | { type: 'restored'; probe: WebGpuProbe; previous: GPUDevice | null }
    /** Recovery failed or was refused. Stay on the fallback path. */
    | { type: 'unavailable'; probe: WebGpuProbe };

export type WebGpuDeviceChangeListener = (change: WebGpuDeviceChange) => void;

/** Automatic recoveries allowed inside `RECOVERY_WINDOW_MS` before giving up. */
const MAX_RECOVERIES_PER_WINDOW = 3;
const RECOVERY_WINDOW_MS = 60_000;
/** Uncaptured GPU errors echoed to the console before going quiet. */
const MAX_CONSOLE_GPU_ERRORS = 5;

let last: WebGpuProbe | null = null;
let inflight: Promise<WebGpuProbe> | null = null;
let generation = 0;
let recoveryTimes: number[] = [];
let consoleGpuErrors = 0;
const listeners = new Set<WebGpuDeviceChangeListener>();
/** Devices destroyed on purpose — their `destroyed` loss is recovered. */
const intentionalLosses = new WeakSet<GPUDevice>();
/** Devices whose loss has already been handled (the `lost` promise and a second probe can race). */
const handledLosses = new WeakSet<GPUDevice>();
const restartWaiters = new Map<GPUDevice, Array<(probe: WebGpuProbe) => void>>();

export function getLastWebGpuProbe(): WebGpuProbe | null {
    return last;
}

/**
 * Drop the cached probe so the next `probeWebGPU()` requests a fresh adapter
 * and device. Does not destroy the current device and does not notify
 * listeners — use `restartWebGpuDevice()` for a live swap. Unit tests call
 * this between cases; it also clears the recovery storm guard.
 */
export function resetWebGpuProbe(): void {
    last = null;
    inflight = null;
    recoveryTimes = [];
    consoleGpuErrors = 0;
}

/**
 * Subscribe to device loss / replacement. Every consumer that builds GPU
 * objects on the shared device must listen: objects from a lost device are
 * dead, and a restored device needs its own pipelines and buffers.
 */
export function onWebGpuDeviceChange(listener: WebGpuDeviceChangeListener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export async function probeWebGPU(): Promise<WebGpuProbe> {
    if (last) return last;
    if (inflight) return inflight;
    inflight = runProbe().finally(() => {
        inflight = null;
    });
    return inflight;
}

/**
 * Replace the shared device on purpose and resolve with the probe that
 * follows. Listeners see the same `lost` → `restored` sequence as a real
 * loss, so this doubles as the forced-loss hook for tests and e2e
 * (`window.__HYPHON_WEBGPU__.loseDevice()` in `?e2e=1`).
 */
export async function restartWebGpuDevice(reason = 'restart requested'): Promise<WebGpuProbe> {
    const current = last ?? (inflight ? await inflight : null);
    const device = current?.device ?? null;
    if (!device || typeof device.destroy !== 'function') {
        // Nothing live to swap: just probe again and tell fallback consumers
        // if a device is now available.
        last = null;
        const probe = await probeWebGPU();
        emit(probe.ok ? { type: 'restored', probe, previous: null } : { type: 'unavailable', probe });
        return probe;
    }
    intentionalLosses.add(device);
    const done = new Promise<WebGpuProbe>((resolve) => {
        const waiters = restartWaiters.get(device) ?? [];
        waiters.push(resolve);
        restartWaiters.set(device, waiters);
    });
    device.destroy();
    if (!lostPromise(device)) {
        // No lost promise to drive recovery (old implementation / mock).
        void handleDeviceLost(device, { reason: 'destroyed', message: reason });
    }
    return done;
}

function emit(change: WebGpuDeviceChange): void {
    for (const listener of [...listeners]) {
        try {
            listener(change);
        } catch (err) {
            console.error('[webgpu] device-change listener threw', err);
        }
    }
}

function publish(probe: WebGpuProbe): void {
    last = probe;
    try {
        engineTelemetry.recordWebGpuProbe({
            ok: probe.ok,
            reason: probe.reason,
            browser: probe.browser,
            adapter: probe.adapter,
            ts: probe.ts,
            powerPreference: probe.powerPreference,
            deviceInfo: probe.deviceInfo ?? null,
            generation: probe.generation,
        });
    } catch {
        /* telemetry must never break GPU init */
    }
}

function fail(
    browser: WebGpuBrowserSnapshot,
    ts: number,
    reason: string,
    powerPreference: GpuPowerPreference,
    adapter: WebGpuAdapterSnapshot | null = null,
): WebGpuProbe {
    return {
        ok: false,
        reason,
        browser,
        adapter,
        device: null,
        adapterHandle: null,
        ts,
        powerPreference,
        deviceInfo: null,
        generation,
    };
}

async function requestAdapter(gpu: GPU, powerPreference: GpuPowerPreference): Promise<GPUAdapter | null> {
    const adapter = await gpu.requestAdapter({ powerPreference });
    if (adapter) return adapter;
    // The preference is a hint; an implementation that cannot honour it should
    // still hand out its default adapter, but some return null instead.
    return gpu.requestAdapter();
}

async function requestDevice(adapter: GPUAdapter): Promise<GPUDevice> {
    try {
        return await adapter.requestDevice(buildSharedDeviceDescriptor(adapter));
    } catch (err) {
        // A descriptor the implementation rejects must not cost the session its
        // GPU: retry with the defaults and let consumers size from device.limits.
        console.warn('[webgpu] requestDevice with descriptor failed, retrying with defaults', err);
        return adapter.requestDevice({ label: SHARED_DEVICE_LABEL });
    }
}

async function runProbe(): Promise<WebGpuProbe> {
    const browser = readBrowser();
    const ts = Date.now();
    const powerPreference = getStoredGpuPowerPreference();
    const gpu = typeof navigator !== 'undefined' ? navigator.gpu : undefined;
    if (!gpu) {
        const probe = fail(browser, ts, 'navigator.gpu unavailable (browser lacks WebGPU)', powerPreference);
        publish(probe);
        return probe;
    }

    try {
        const adapter = await requestAdapter(gpu, powerPreference);
        if (!adapter) {
            const probe = fail(
                browser,
                ts,
                'requestAdapter() returned null (no compatible GPU adapter)',
                powerPreference,
            );
            publish(probe);
            return probe;
        }

        const adapterSnap = await readAdapterInfo(adapter);
        const device = await requestDevice(adapter);
        generation += 1;
        watchDevice(device);

        const features = snapshotDeviceFeatures(device);
        const probe: WebGpuProbe = {
            ok: true,
            reason: null,
            browser,
            adapter: adapterSnap,
            device,
            adapterHandle: adapter,
            ts,
            powerPreference,
            deviceInfo: {
                label: device.label || SHARED_DEVICE_LABEL,
                features,
                limits: snapshotDeviceLimits(device),
                timestampQuery: features.includes('timestamp-query'),
            },
            generation,
        };
        publish(probe);
        return probe;
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const probe = fail(browser, ts, `GPUDevice or adapter request failed: ${msg}`, powerPreference);
        publish(probe);
        return probe;
    }
}

/** `device.lost`, which older implementations and test mocks lack. */
function lostPromise(device: GPUDevice): Promise<GPUDeviceLostInfo> | null {
    const lost = (device as { lost?: Partial<Promise<GPUDeviceLostInfo>> }).lost;
    return typeof lost?.then === 'function' ? (lost as Promise<GPUDeviceLostInfo>) : null;
}

function watchDevice(device: GPUDevice): void {
    if (typeof device.addEventListener === 'function') {
        device.addEventListener('uncapturederror', (event) => {
            onUncapturedError(device, event);
        });
    }
    const lost = lostPromise(device);
    if (lost) void lost.then((info) => handleDeviceLost(device, info));
}

function onUncapturedError(device: GPUDevice, event: GPUUncapturedErrorEvent): void {
    const error = event?.error;
    const type = error?.constructor?.name || 'GPUError';
    const message = error?.message || 'uncaptured WebGPU error';
    try {
        engineTelemetry.recordWebGpuError({ type, message, deviceLabel: device.label || SHARED_DEVICE_LABEL });
    } catch {
        /* telemetry optional */
    }
    if (consoleGpuErrors < MAX_CONSOLE_GPU_ERRORS) {
        consoleGpuErrors += 1;
        console.warn(`[webgpu] uncaptured ${type}: ${message}`);
    }
}

function withinRecoveryBudget(now: number): boolean {
    recoveryTimes = recoveryTimes.filter((t) => now - t < RECOVERY_WINDOW_MS);
    return recoveryTimes.length < MAX_RECOVERIES_PER_WINDOW;
}

async function handleDeviceLost(
    device: GPUDevice,
    info: Pick<GPUDeviceLostInfo, 'reason' | 'message'> | undefined,
): Promise<void> {
    if (handledLosses.has(device)) return;
    handledLosses.add(device);

    const reason = String(info?.reason ?? 'unknown');
    const message = info?.message || 'GPU device lost';
    const intentional = intentionalLosses.has(device);
    const isCurrent = last?.device === device;
    if (isCurrent) last = null;

    const now = Date.now();
    const automatic = !intentional && reason !== 'destroyed';
    const recover = intentional || (automatic && withinRecoveryBudget(now));
    try {
        engineTelemetry.recordWebGpuDeviceLost({ reason, message, intentional, willRecover: recover });
    } catch {
        /* telemetry optional */
    }

    // A device that was already replaced (a stale handle) has no consumers left.
    if (!isCurrent && !intentional) return;

    emit({ type: 'lost', device, reason, message, willRecover: recover });

    if (!recover) {
        if (automatic) {
            const probe = fail(
                readBrowser(),
                now,
                `GPU device lost ${recoveryTimes.length + 1} times in ${RECOVERY_WINDOW_MS / 1000}s; WebGPU disabled for this session (${message})`,
                getStoredGpuPowerPreference(),
            );
            publish(probe);
            emit({ type: 'unavailable', probe });
        }
        return;
    }

    if (automatic) recoveryTimes.push(now);
    const probe = await probeWebGPU();
    emit(probe.ok ? { type: 'restored', probe, previous: device } : { type: 'unavailable', probe });

    const waiters = restartWaiters.get(device);
    if (waiters) {
        restartWaiters.delete(device);
        for (const resolve of waiters) resolve(probe);
    }
}

function readBrowser(): WebGpuBrowserSnapshot {
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    const uad = nav
        ? (nav as Navigator & { userAgentData?: { brands?: unknown; platform?: string } })
              .userAgentData
        : undefined;
    return {
        brands: uad?.brands,
        platform: uad?.platform,
        engineHint: inferEngineHint(uad?.brands, nav?.userAgent),
    };
}

function inferEngineHint(brands: unknown, userAgent: string | undefined): string {
    const brandList: string[] = [];
    if (Array.isArray(brands)) {
        for (const b of brands) {
            if (b && typeof b === 'object' && 'brand' in b) {
                brandList.push(String((b as { brand: unknown }).brand).toLowerCase());
            } else {
                brandList.push(String(b).toLowerCase());
            }
        }
    }
    const ua = (userAgent ?? '').toLowerCase();
    const joined = brandList.join(' ');
    if (joined.includes('edg') || ua.includes('edg/')) return 'edge';
    if (joined.includes('firefox') || ua.includes('firefox')) return 'firefox';
    if (joined.includes('safari') && !joined.includes('chrome') && ua.includes('safari') && !ua.includes('chrome')) {
        return 'safari';
    }
    if (joined.includes('google chrome') || joined.includes('chromium') || ua.includes('chrome')) {
        return 'chromium';
    }
    if (ua.includes('safari')) return 'safari';
    return 'unknown';
}

async function readAdapterInfo(adapter: GPUAdapter): Promise<WebGpuAdapterSnapshot | null> {
    const withInfo = adapter as GPUAdapter & {
        info?: GPUAdapterInfo;
        requestAdapterInfo?: () => Promise<GPUAdapterInfo>;
    };
    const fromInfo = snapshotAdapterInfo(withInfo.info);
    if (fromInfo) return fromInfo;
    if (typeof withInfo.requestAdapterInfo === 'function') {
        try {
            return snapshotAdapterInfo(await withInfo.requestAdapterInfo());
        } catch {
            return null;
        }
    }
    return null;
}

function snapshotAdapterInfo(info: GPUAdapterInfo | undefined): WebGpuAdapterSnapshot | null {
    if (!info) return null;
    return {
        vendor: info.vendor || undefined,
        architecture: info.architecture || undefined,
        device: info.device || undefined,
        description: info.description || undefined,
    };
}
