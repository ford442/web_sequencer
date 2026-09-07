import { describe, expect, it, vi } from 'vitest';
import { SingingVoiceManager } from '../../../engines/SingingVoiceManager';
import type { MultisampleBank } from '../../../engines/MultisampleGenerator';
import { applySamplerVoiceParamUpdate, applyVoiceParamUpdate, createSampleLibraryControls } from '../sampleManagement';

function createVoiceMock() {
    return {
        setTimeRatio: vi.fn(),
        setPitch: vi.fn(),
        setFormantShift: vi.fn(),
        setVibratoDepth: vi.fn(),
        setBreathIntensity: vi.fn(),
        setAttack: vi.fn(),
        setRelease: vi.fn(),
        setRootNote: vi.fn(),
        setCoarseTune: vi.fn(),
        setFineTune: vi.fn(),
        setPitchAttack: vi.fn(),
        setPitchDecay: vi.fn(),
    };
}

describe('sampleManagement helpers', () => {
    it('broadcasts voice parameter updates and adjusts choir gains', () => {
        const voice = createVoiceMock();
        const gainNode = () => ({ gain: { setTargetAtTime: vi.fn() } }) as unknown as GainNode;
        const choirLeftGain = gainNode();
        const choirRightGain = gainNode();
        const manager = { getAllVoices: () => [voice] } as unknown as SingingVoiceManager;

        applyVoiceParamUpdate({
            manager,
            choirLeftGain,
            choirRightGain,
            currentTime: 1.25,
            key: 'formantShift',
            value: 3,
        });

        expect(voice.setFormantShift).toHaveBeenCalledWith(3, undefined, undefined);

        applyVoiceParamUpdate({
            manager,
            choirLeftGain,
            choirRightGain,
            currentTime: 2,
            key: 'choir',
            value: 0.5,
        });

        expect(choirLeftGain.gain.setTargetAtTime).toHaveBeenCalledWith(0.35, 2, 0.05);
        expect(choirRightGain.gain.setTargetAtTime).toHaveBeenCalledWith(0.35, 2, 0.05);
    });

    it('applies sampler voice updates to every active singing voice', () => {
        const firstVoice = createVoiceMock();
        const secondVoice = createVoiceMock();
        const manager = { getAllVoices: () => [firstVoice, secondVoice] } as unknown as SingingVoiceManager;

        applySamplerVoiceParamUpdate({
            manager,
            currentTime: 4,
            param: 'formantShift',
            value: 7,
        });

        expect(firstVoice.setFormantShift).toHaveBeenCalledWith(7, 4);
        expect(secondVoice.setFormantShift).toHaveBeenCalledWith(7, 4);

        applySamplerVoiceParamUpdate({
            manager,
            currentTime: 0,
            param: 'coarseTune',
            value: -12,
        });

        expect(firstVoice.setCoarseTune).toHaveBeenCalledWith(-12);
        expect(secondVoice.setCoarseTune).toHaveBeenCalledWith(-12);
    });

    it('stores sampler buffers at the live context sample rate', async () => {
        const context = { sampleRate: 48000 } as AudioContext;
        const loaded = new Map<string, AudioBuffer>();
        const banks = new Map<string, MultisampleBank>();
        const { loadSampleToEngine } = createSampleLibraryControls({
            audioContextRef: { current: context },
            loadedSampleBuffersRef: { current: loaded },
            multisampleBanksRef: { current: banks },
            multisampleGeneratorRef: { current: null },
            vocalAlignmentsRef: { current: new Map() },
            singingVoiceManagerRef: { current: null },
        });

        const buffer = { sampleRate: 48000, duration: 1, numberOfChannels: 1 } as AudioBuffer;
        await loadSampleToEngine('bank_0', buffer);
        expect(loaded.get('bank_0')).toBe(buffer);
        expect(loaded.get('bank_0')?.sampleRate).toBe(context.sampleRate);
    });
});
