/// <reference types="@webgpu/types" />
/**
 * Session-wide WebGPU probe: one adapter, one GPUDevice.
 * Voice backends may still fall back WASM/JS via BackendRegistry when this fails.
 * GPU viz/chores must hard-fail — never open a WebGL context.
 */
import { engineTelemetry } from '../../utils/engineTelemetry';

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

/** JSON-safe probe result (no live GPU handles). HUD / engine reports. */
export type WebGpuProbeSnapshot = {
    ok: boolean;
    reason: string | null;
    browser: WebGpuBrowserSnapshot;
    adapter: WebGpuAdapterSnapshot | null;
    ts: number;
};

export type WebGpuProbe = WebGpuProbeSnapshot & {
    device: GPUDevice | null;
    adapterHandle: GPUAdapter | null;
};

let last: WebGpuProbe | null = null;
let inflight: Promise<WebGpuProbe> | null = null;

export function getLastWebGpuProbe(): WebGpuProbe | null {
    return last;
}

/** Clear cached probe (unit tests, or after GPU device-lost so a retry can run). */
export function resetWebGpuProbeForTests(): void {
    last = null;
    inflight = null;
}

export async function probeWebGPU(): Promise<WebGpuProbe> {
    if (last) return last;
    if (inflight) return inflight;
    inflight = runProbe().finally(() => {
        inflight = null;
    });
    return inflight;
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
        });
    } catch {
        /* telemetry must never break GPU init */
    }
}

function fail(
    browser: WebGpuBrowserSnapshot,
    ts: number,
    reason: string,
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
    };
}

async function runProbe(): Promise<WebGpuProbe> {
    const browser = readBrowser();
    const ts = Date.now();
    const gpu = typeof navigator !== 'undefined' ? navigator.gpu : undefined;
    if (!gpu) {
        const probe = fail(browser, ts, 'navigator.gpu unavailable (browser lacks WebGPU)');
        publish(probe);
        return probe;
    }

    try {
        const adapter = await gpu.requestAdapter();
        if (!adapter) {
            const probe = fail(
                browser,
                ts,
                'requestAdapter() returned null (no compatible GPU adapter)',
            );
            publish(probe);
            return probe;
        }

        const adapterSnap = await readAdapterInfo(adapter);
        const device = await adapter.requestDevice();
        if (device.lost) {
            void device.lost.then(() => {
                if (last?.device === device) {
                    last = null;
                }
            });
        }

        const probe: WebGpuProbe = {
            ok: true,
            reason: null,
            browser,
            adapter: adapterSnap,
            device,
            adapterHandle: adapter,
            ts,
        };
        publish(probe);
        return probe;
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const probe = fail(browser, ts, `GPUDevice or adapter request failed: ${msg}`);
        publish(probe);
        return probe;
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
