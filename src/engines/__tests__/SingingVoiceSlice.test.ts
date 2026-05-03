import { vi, describe, it, expect, beforeEach } from 'vitest';
import { SingingVoice } from '../SingingVoice';

describe('SingingVoice - Slice & Granular Features', () => {
    let voice: SingingVoice;
    let mockContext: any;
    let mockWorkletNode: any;

    beforeEach(() => {
        mockContext = {
            currentTime: 0,
            createGain: vi.fn().mockReturnValue({ gain: { value: 1, setValueAtTime: vi.fn() }, connect: vi.fn() })
        };

        mockWorkletNode = {
            parameters: new Map([
                ['grainPitchQuantize', { setValueAtTime: vi.fn() }],
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
});
