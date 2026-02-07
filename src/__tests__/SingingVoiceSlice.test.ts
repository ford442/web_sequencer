// src/__tests__/SingingVoiceSlice.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SingingVoice } from '../engines/SingingVoice';
import type { AlignmentResult } from '../engines/rubberband/PhonemeAligner';

// Mock AudioContext and related APIs
class MockAudioWorkletNode {
    port = {
        postMessage: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
    };

    parameters = new Map([
        ['pitchScale', { setValueAtTime: vi.fn() }],
        ['timeRatio', { setValueAtTime: vi.fn() }],
        ['vibratoDepth', { setValueAtTime: vi.fn() }],
        ['vibratoRate', { setValueAtTime: vi.fn() }],
        ['tremoloDepth', { setValueAtTime: vi.fn() }],
        ['tremoloRate', { setValueAtTime: vi.fn() }],
        ['breathIntensity', { setValueAtTime: vi.fn() }]
    ]);

    connect = vi.fn().mockReturnThis();
    disconnect = vi.fn();
}

class MockAudioContext {
    sampleRate = 44100;
    currentTime = 0;
    audioWorklet = {
        addModule: vi.fn().mockResolvedValue(undefined)
    };

    createBiquadFilter() {
        return {
            type: 'peaking',
            frequency: { value: 0, setValueAtTime: vi.fn() },
            Q: { value: 0, setValueAtTime: vi.fn() },
            gain: { value: 0, setValueAtTime: vi.fn() },
            connect: vi.fn().mockReturnThis(),
            disconnect: vi.fn()
        };
    }
}

globalThis.AudioWorkletNode = MockAudioWorkletNode as any;

describe('SingingVoice Slice Triggering', () => {
    let audioContext: AudioContext;
    let voice: SingingVoice;
    let mockWorkletNode: any;

    beforeEach(async () => {
        audioContext = new MockAudioContext() as any;
        voice = new SingingVoice(audioContext, { enablePhonemeStretching: true });

        // Manual setup to bypass initWorklet complexity and timeouts
        mockWorkletNode = new MockAudioWorkletNode();

        // Inject dependencies into private fields
        Object.defineProperty(voice, 'workletNode', { value: mockWorkletNode, writable: true });
        Object.defineProperty(voice, 'inputRingBuffer', { value: {}, writable: true });

        vi.clearAllMocks();
    });

    const mockAlignment: AlignmentResult = {
        phonemes: [
            { phoneme: 'HH', start: 0.0, end: 0.1, isVowel: false },
            { phoneme: 'EH', start: 0.1, end: 0.3, isVowel: true },
            { phoneme: 'L',  start: 0.3, end: 0.4, isVowel: false },
            { phoneme: 'OW', start: 0.4, end: 0.6, isVowel: true }
        ],
        sampleRate: 44100,
        duration: 0.6,
        text: 'hello'
    };

    it('should trigger correct slice for valid index', async () => {
        const audio = new Float32Array(44100 * 0.6);
        const sliceIndex = 1; // 'EH' 0.1 to 0.3

        await voice.triggerSlice(audio, sliceIndex, mockAlignment);

        expect(mockWorkletNode.port.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'noteOn',
                data: expect.objectContaining({
                    startSample: 4410,  // 0.1 * 44100
                    endSample: 13230    // 0.3 * 44100
                })
            })
        );
    });

    it('should handle out of bounds index gracefully', async () => {
        const audio = new Float32Array(100);
        const spy = vi.spyOn(console, 'warn');

        await voice.triggerSlice(audio, 99, mockAlignment);

        expect(spy).toHaveBeenCalled();
        expect(mockWorkletNode.port.postMessage).not.toHaveBeenCalledWith(
            expect.objectContaining({ type: 'noteOn' })
        );
    });

    it('should reset time stretch when triggering slice', async () => {
        const audio = new Float32Array(100);
        await voice.triggerSlice(audio, 0, mockAlignment);

        expect(mockWorkletNode.parameters.get('timeRatio').setValueAtTime).toHaveBeenCalledWith(1.0, 0);
    });

    it('should set pitch when triggering slice', async () => {
        const audio = new Float32Array(100);
        const pitch = 1.5;
        await voice.triggerSlice(audio, 0, mockAlignment, pitch);

        expect(mockWorkletNode.parameters.get('pitchScale').setValueAtTime).toHaveBeenCalledWith(pitch, 0);
    });

    it('should pass startSample and endSample via process', async () => {
        const audio = new Float32Array(100);
        await voice.process(audio, 50, 80);

        expect(mockWorkletNode.port.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'noteOn',
                data: expect.objectContaining({
                    startSample: 50,
                    endSample: 80
                })
            })
        );
    });
});
