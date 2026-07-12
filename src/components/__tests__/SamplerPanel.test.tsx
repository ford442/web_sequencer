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
    breathIntensity: 0,
    choir: 0,
    tremoloDepth: 0,
    tremoloRate: 0.1,
    freeze: 0,
    grainPitchQuantize: 0,
    formantLfoRate: 0,
    formantLfoDepth: 0,
    formantEnvAttack: 0.1,
    formantEnvDecay: 0.5,
    formantEnvAmount: 0,
    characterMorph: 0,
    morphTarget: 'female' as 'default' | 'male' | 'female' | 'child' | 'deep' | 'bright',
    attack: 0.05,
    decay: 0.1,
    sustain: 1.0,
    release: 0.1,
    rootNote: 60,
    coarseTune: 0,
    fineTune: 0,
    quality: 'good' as 'preview' | 'good' | 'better' | 'best',
    stretchMode: 'Pitch' as 'Time' | 'Pitch' | 'Formant',
    lockToSequencer: false
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
        isVoiceEditorOpen: false,
        ttsPhrases: Array(8).fill(""),
        onTtsPhraseChange: vi.fn(),
    };

    it('renders bank tabs correctly', () => {
        render(<SamplerPanel {...defaultProps} />);
        expect(screen.getByRole('tab', { name: 'Select sample bank 1' })).toBeDefined();
    });

    it('shows loaded status when bank is loaded', () => {
        const loadedBanks = [true, false, false, false, false, false, false, false];
        render(<SamplerPanel {...defaultProps} loadedBanks={loadedBanks} />);

        // Check for (Loaded) in aria-label
        const bank1 = screen.getByRole('tab', { name: 'Select sample bank 1 (Loaded)' });
        expect(bank1).toBeDefined();

        const bank2 = screen.getByRole('tab', { name: 'Select sample bank 2' });
        expect(bank2).toBeDefined();
    });

    it('provides accessible value text for Grain Size slider in stretch mode', () => {
        const stretchParams = { ...defaultBankParams, mode: 'stretch' as const, grainSize: 4410 };
        const params = Array(8).fill(defaultBankParams);
        params[0] = stretchParams;

        render(<SamplerPanel {...defaultProps} params={params} activeBankIdx={0} />);

        const slider = screen.getByLabelText('Grain Size');
        expect(slider).toBeInTheDocument();
        expect(slider).toHaveAttribute('aria-valuetext', '100ms');
    });

    it('renders Grain Quantization knob', () => {
        const params = Array(8).fill({ ...defaultBankParams, grainPitchQuantize: 0 });
        render(<SamplerPanel {...defaultProps} params={params} activeBankIdx={0} />);

        const knob = screen.getByLabelText('Grain Quant');
        expect(knob).toBeInTheDocument();
        expect(knob).toHaveAttribute('tabIndex', '0');
    });
});
