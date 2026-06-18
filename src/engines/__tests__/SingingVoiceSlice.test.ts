import { vi, describe, it, expect, beforeEach } from 'vitest';
import { SingingVoice } from '../SingingVoice';

describe('SingingVoice - Slice & Granular Features', () => {
    let voice: SingingVoice;
    let mockContext: any;
    let mockWorkletNode: any;

    beforeEach(() => {
        mockContext = {
            currentTime: 0,

            createBiquadFilter: vi.fn().mockReturnValue({
                type: 'lowpass', frequency: { value: 0, setValueAtTime: vi.fn() },
                Q: { value: 0, setValueAtTime: vi.fn() }, gain: { value: 0, setValueAtTime: vi.fn() },
                connect: vi.fn().mockReturnThis(), disconnect: vi.fn()
            }),
            createStereoPanner: vi.fn().mockReturnValue({
                pan: { value: 0, setValueAtTime: vi.fn() },
                connect: vi.fn().mockReturnThis(), disconnect: vi.fn()
            }),
            createOscillator: vi.fn().mockReturnValue({
                type: 'sine', frequency: { value: 0, setValueAtTime: vi.fn() },
                start: vi.fn(), stop: vi.fn(),
                connect: vi.fn().mockReturnThis(), disconnect: vi.fn()
            }),
            createGain: vi.fn().mockReturnValue({
                gain: { value: 1, setValueAtTime: vi.fn() },
                connect: vi.fn().mockReturnThis(), disconnect: vi.fn()
            })

        };

        mockWorkletNode = {
            parameters: new Map([
                ['grainPitchQuantize', { setValueAtTime: vi.fn() }],
                ['granularPitchShift', { setValueAtTime: vi.fn() }],
                ['freeze', { setValueAtTime: vi.fn() }]
            ]),
            connect: vi.fn()
        };

        voice = new SingingVoice(mockContext as any);
        voice['workletNode'] = mockWorkletNode; // Inject mock
    });

    it('sets grainPitchQuantize correctly', () => {
        voice.setGrainPitchQuantize(7.0);
        expect(mockWorkletNode.parameters.get('grainPitchQuantize').setValueAtTime).toHaveBeenCalledWith(7.0, 0);
    });

    it('sets granularPitchShift correctly', () => {
        voice.setGranularPitchShift(-12.0);
        expect(mockWorkletNode.parameters.get('granularPitchShift').setValueAtTime).toHaveBeenCalledWith(-12.0, 0);
    });
});
