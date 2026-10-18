import { afterEach, describe, expect, it } from 'vitest';
import {
    DEFAULT_GPU_POWER_PREFERENCE,
    GPU_POWER_PREFERENCE_STORAGE_KEY,
    getStoredGpuPowerPreference,
    parseGpuPowerPreference,
    setStoredGpuPowerPreference,
} from '../powerPreference';

describe('GPU power preference', () => {
    afterEach(() => localStorage.removeItem(GPU_POWER_PREFERENCE_STORAGE_KEY));

    it('defaults to high-performance', () => {
        expect(DEFAULT_GPU_POWER_PREFERENCE).toBe('high-performance');
        expect(getStoredGpuPowerPreference()).toBe('high-performance');
    });

    it('round-trips through storage and rejects unknown values', () => {
        setStoredGpuPowerPreference('low-power');
        expect(getStoredGpuPowerPreference()).toBe('low-power');
        localStorage.setItem(GPU_POWER_PREFERENCE_STORAGE_KEY, 'turbo');
        expect(getStoredGpuPowerPreference()).toBe('high-performance');
        expect(parseGpuPowerPreference(null)).toBeNull();
    });
});
