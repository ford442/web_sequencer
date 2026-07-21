import '@testing-library/jest-dom';
import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SamplerPanel } from '../components/SamplerPanel';
import type { SamplerParams } from '../types';
import { Knob } from '../components/Knob';

// Mock Knob to track renders
vi.mock('../components/Knob', () => ({
    Knob: vi.fn(() => <div data-testid="knob">Knob</div>)
}));

// Mock AudioContext
const mockAudioContext = {
    createBuffer: vi.fn((_channels: number, length: number) => ({
        getChannelData: () => new Float32Array(length)
    }))
} as any;

describe('SamplerPanel Memoization', () => {
    // Helper to create valid params
    const createParams = (): SamplerParams => Array(8).fill(null).map((_, i) => ({
        sampleName: `bank_${i}`,
        playbackSpeed: 1.0,
        volume: 1.0,
        filterCutoff: 20000,
        filterResonance: 0,
        drive: 0,
        delaySend: 0,
        mode: 'loop',
        grainSize: 4410
    }));

    const defaultProps = {
        params: createParams(),
        onChange: vi.fn(),
        onLoadSample: vi.fn(),
        audioContext: mockAudioContext,
        activeBankIdx: 0,
        onBankChange: vi.fn(),
        isVoiceEditorOpen: false,
        ttsPhrases: Array(8).fill("Hello World"),
        onTtsPhraseChange: vi.fn()
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('re-renders children when active bank params change', () => {
        const { rerender } = render(<SamplerPanel {...defaultProps} />);

        // Initial render: 48 knobs
        expect(Knob).toHaveBeenCalledTimes(48);
        vi.clearAllMocks();

        // Update params for ACTIVE bank (0)
        // Maintain referential equality for other banks
        const newParams = [...defaultProps.params];
        newParams[0] = { ...newParams[0], volume: 0.5 };

        rerender(<SamplerPanel {...defaultProps} params={newParams} />);

        // Should re-render (48 knobs now)
        expect(Knob).toHaveBeenCalledTimes(48);
    });

    it('does NOT re-render children when inactive bank params change', () => {
        const { rerender } = render(<SamplerPanel {...defaultProps} />);

        // Initial render: 48
        expect(Knob).toHaveBeenCalledTimes(48);
        vi.clearAllMocks();

        // Update params for INACTIVE bank (1)
        // Maintain referential equality for active bank (0)
        const newParams = [...defaultProps.params];
        newParams[1] = { ...newParams[1], volume: 0.5 };

        rerender(<SamplerPanel {...defaultProps} params={newParams} />);

        // Optimization Verified: Should NOT have called Knob again
        expect(Knob).toHaveBeenCalledTimes(0);
    });

    it('re-renders children when activeBankIdx changes', () => {
        const { rerender } = render(<SamplerPanel {...defaultProps} />);
        vi.clearAllMocks();

        rerender(<SamplerPanel {...defaultProps} activeBankIdx={1} />);

        // Should re-render (48 knobs now)
        expect(Knob).toHaveBeenCalledTimes(48);
    });
});
