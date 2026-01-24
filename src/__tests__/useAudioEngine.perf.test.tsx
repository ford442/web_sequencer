import { renderHook } from '@testing-library/react';
import { useAudioEngine } from '../hooks/useAudioEngine';
import { describe, it, expect, vi } from 'vitest';

// Mock dependencies
vi.mock('../engines/WebGpuOscillator', () => ({
    WebGpuOscillator: class {
        init = vi.fn().mockResolvedValue(undefined);
        isSupported = false;
    }
}));

vi.mock('../engines/WasmOscillator', () => ({
    WasmOscillator: class {
        init = vi.fn().mockResolvedValue(undefined);
        isReady = false;
    }
}));

vi.mock('../engines/SingingVoice', () => ({
    SingingVoice: class {
        initWorklet = vi.fn().mockResolvedValue(undefined);
        getSourceNode = vi.fn().mockReturnValue({ connect: vi.fn() });
    },
    REFERENCE_FREQUENCIES: {},
    freqToMidi: vi.fn()
}));

describe('useAudioEngine Performance', () => {
    it('returns stable object reference on subsequent renders (optimized behavior)', () => {
        const mockPyodide = { globals: { get: vi.fn() } };
        const { result, rerender } = renderHook(() => useAudioEngine(mockPyodide));

        const firstResult = result.current;

        // Trigger a re-render with same props
        rerender();
        const secondResult = result.current;

        // Optimization Verified: Reference should be stable
        expect(secondResult).toBe(firstResult);

        // Verify contents are similar
        expect(secondResult.isReady).toBe(firstResult.isReady);
    });
});
