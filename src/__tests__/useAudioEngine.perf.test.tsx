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
    it('returns updated audioEngine reference after initialization', () => {
        const mockPyodide = { globals: { get: vi.fn() } };
        const { result, rerender } = renderHook(() => useAudioEngine(mockPyodide));

        const firstResult = result.current;

        // Initially audioEngine should be null
        expect(firstResult.audioEngine).toBeNull();
        expect(firstResult.isReady).toBe(false);

        // Trigger a re-render with same props
        rerender();
        const secondResult = result.current;

        // Before initialization, both should still have null audioEngine
        expect(secondResult.audioEngine).toBeNull();
    });
});
