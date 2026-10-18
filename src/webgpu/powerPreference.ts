// User-selectable GPU power preference for the shared WebGPU device.
// Persisted next to the latency / sample-rate prefs (Engine HUD) and passed to
// `navigator.gpu.requestAdapter()`. Without it a dual-GPU laptop gets whichever
// adapter the browser picks, which is usually the integrated one.

export type GpuPowerPreference = 'high-performance' | 'low-power';

export const GPU_POWER_PREFERENCES: readonly GpuPowerPreference[] = ['high-performance', 'low-power'];

export const DEFAULT_GPU_POWER_PREFERENCE: GpuPowerPreference = 'high-performance';

export const GPU_POWER_PREFERENCE_STORAGE_KEY = 'hyphon.gpuPowerPreference';

export function parseGpuPowerPreference(raw: string | null): GpuPowerPreference | null {
    if (raw === 'high-performance' || raw === 'low-power') return raw;
    return null;
}

export function getStoredGpuPowerPreference(): GpuPowerPreference {
    try {
        const parsed = parseGpuPowerPreference(localStorage.getItem(GPU_POWER_PREFERENCE_STORAGE_KEY));
        if (parsed) return parsed;
    } catch {
        /* localStorage unavailable (worker, private mode) */
    }
    return DEFAULT_GPU_POWER_PREFERENCE;
}

export function setStoredGpuPowerPreference(pref: GpuPowerPreference): void {
    try {
        localStorage.setItem(GPU_POWER_PREFERENCE_STORAGE_KEY, pref);
    } catch {
        /* localStorage unavailable */
    }
}
