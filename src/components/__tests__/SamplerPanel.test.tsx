import { render, screen } from '@testing-library/react';
import { SamplerPanel } from '../SamplerPanel';
import { describe, it, expect, vi } from 'vitest';

// Mock dependencies
vi.mock('../../services/Supertonic', () => ({
    SupertonicService: {
        getInstance: () => ({
            init: vi.fn().mockResolvedValue(undefined),
            isServiceReady: vi.fn().mockReturnValue(true),
            generate: vi.fn()
        })
    }
}));

const mockAudioContext = {
    createBuffer: vi.fn(),
    decodeAudioData: vi.fn(),
} as unknown as AudioContext;

const defaultBankParams = {
    sampleName: 'bank_0',
    playbackSpeed: 1.0,
    volume: 1.0,
    filterCutoff: 20000,
    filterResonance: 0,
    drive: 0,
    delaySend: 0,
    mode: 'loop' as const,
    grainSize: 4410,
    timeRatio: 1.0,
    pitchScale: 1.0,
    formantShift: 0,
    vibratoDepth: 0,
    breathIntensity: 0
};

describe('SamplerPanel', () => {
    const defaultProps = {
        params: Array(8).fill(defaultBankParams),
        onChange: vi.fn(),
        onLoadSample: vi.fn(),
        audioContext: mockAudioContext,
        audioEngine: undefined,
        activeBankIdx: 0,
        onBankChange: vi.fn(),
        ttsPhrases: Array(8).fill(""),
        onTtsPhraseChange: vi.fn(),
    };

    it('renders bank tabs correctly', () => {
        render(<SamplerPanel {...defaultProps} />);
        expect(screen.getByRole('tab', { name: 'Select Bank 1' })).toBeDefined();
    });

    it('shows loaded status when bank is loaded', () => {
        const loadedBanks = [true, false, false, false, false, false, false, false];
        render(<SamplerPanel {...defaultProps} loadedBanks={loadedBanks} />);

        // Check for (Loaded) in aria-label
        const bank1 = screen.getByRole('tab', { name: 'Select Bank 1 (Loaded)' });
        expect(bank1).toBeDefined();

        const bank2 = screen.getByRole('tab', { name: 'Select Bank 2' });
        expect(bank2).toBeDefined();
    });
});
