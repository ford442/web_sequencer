import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLyricHandlers } from '../useLyricHandlers';
import { SupertonicService } from '../../../services/Supertonic';

vi.mock('../../../services/Supertonic', () => ({
    SupertonicService: {
        getInstance: vi.fn()
    }
}));

vi.mock('../../../utils/resampleAudioBuffer', () => ({
    ensureBufferMatchesContext: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../../stores/transportMixStore', () => ({
    transportMixStore: {
        getSnapshot: vi.fn().mockReturnValue({ swing: 50, stepCount: 16, trackLengths: { kick: 16, snare: 16, closedHat: 16, openHat: 16 } })
    }
}));

type LyricDeps = Parameters<typeof useLyricHandlers>[0];
type MutableDeps = Omit<LyricDeps, 'currentScale' | 'setCurrentScale'> & {
    currentScale: LyricDeps['currentScale'];
    setCurrentScale: ReturnType<typeof vi.fn>;
};

describe('useLyricHandlers', () => {
    let deps: MutableDeps;
    let mockSupertonic: Record<string, unknown>;

    beforeEach(() => {
        mockSupertonic = {
            generate: vi.fn().mockResolvedValue(new Float32Array()),
            getOutputSampleRate: vi.fn().mockReturnValue(44100),
            getLastTokenDurations: vi.fn().mockReturnValue([]),
            isReady: true,
            currentStyle: {},
            textProcessor: {},
            cfgs: {}
        };
        vi.mocked(SupertonicService).getInstance.mockReturnValue(mockSupertonic as unknown as SupertonicService);

        deps = ({
            audioEngine: {
                context: { createBuffer: vi.fn().mockReturnValue({ getChannelData: vi.fn().mockReturnValue({ set: vi.fn() }) }) },
                prepareVocal: vi.fn(),
                getAlignment: vi.fn().mockReturnValue({ phonemes: [{ phoneme: 'AH', start: 0, end: 1 }] })
            },
            patternRef: { current: { kick: { steps: [] }, snare: { steps: [] }, closedHat: { steps: [] }, openHat: { steps: [] }, sampler: [] } },
            tempoRef: { current: 120 },
            activeSamplerBankRef: { current: 0 },
            samplerRef: { current: [] },
            setPattern: vi.fn(),
            setSampler: vi.fn(),
            setTtsPhrases: vi.fn(),
            setIsGenerating: vi.fn(),
            setIsLyricTrackVisible: vi.fn(),
            ttsPhrases: [],
            activeSamplerBank: 0,
            handleLoadSample: vi.fn().mockResolvedValue(undefined),
            updateStorageForTrack: vi.fn(),
            showToast: vi.fn(),
            setActiveAlignment: vi.fn(),
            currentScale: null,
            setCurrentScale: vi.fn(),
        } as unknown as MutableDeps);
    });

    it('sets Minor scale on negative sentiment when currentScale is null', async () => {
        const { result } = renderHook(() => useLyricHandlers(deps as unknown as LyricDeps));

        await act(async () => {
            await result.current.handleTextToDrums('I hate this cold dark pain');
        });

        expect(deps.setCurrentScale).toHaveBeenCalledWith({ root: 'C', scale: 'Minor', tuning: '12-TET' });
    });

    it('does not set scale on negative sentiment when currentScale is already set', async () => {
        deps.currentScale = { root: 'D', scale: 'Major', tuning: '12-TET' };
        const { result } = renderHook(() => useLyricHandlers(deps as unknown as LyricDeps));

        await act(async () => {
            await result.current.handleTextToDrums('I hate this cold dark pain');
        });

        expect(deps.setCurrentScale).not.toHaveBeenCalled();
    });
});
