// src/__tests__/SingingVoiceSlice.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SingingVoice, clampStretchRatio, STRETCH_RATIO_LIMITS } from '../engines/SingingVoice';
import type { AlignmentResult } from '../engines/rubberband/PhonemeAligner';

// Mock AudioContext and related APIs
class MockAudioWorkletNode {
    port = {
        postMessage: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
    };

    parameters = new Map([
        ['pitchScale', { setValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() }],
        ['timeRatio', { setValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() }],
        ['vibratoDepth', { setValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() }],
        ['vibratoRate', { setValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() }],
        ['tremoloDepth', { setValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() }],
        ['tremoloRate', { setValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() }],
        ['breathIntensity', { setValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() }],
        ['grainPitchQuantize', { setValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() }]
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

    it('should reset time stretch to 1.0 when no targetDuration is provided', async () => {
        const audio = new Float32Array(100);
        await voice.triggerSlice(audio, 0, mockAlignment);

        expect(mockWorkletNode.parameters.get('timeRatio').setValueAtTime).toHaveBeenCalledWith(1.0, 0);
    });

    it('should apply computed stretch ratio when targetDuration is provided', async () => {
        // sliceIndex=1: phoneme 'EH', start=0.1, end=0.3 => nativeDuration~0.2s
        // targetDuration=0.4 => rawRatio~2.0 (within [0.25, 4.0], no clamping)
        const audio = new Float32Array(44100 * 0.6);
        await voice.triggerSlice(audio, 1, mockAlignment, 1.0, false, 0.4);

        expect(mockWorkletNode.parameters.get('timeRatio').setValueAtTime).toHaveBeenCalledWith(
            expect.closeTo(2.0, 5), 0
        );
    });

    it('should clamp stretch ratio to MAX when targetDuration is very large', async () => {
        // sliceIndex=0: nativeDuration=0.1s, targetDuration=10s => ratio=100 → clamped to 4.0
        const audio = new Float32Array(44100 * 0.6);
        await voice.triggerSlice(audio, 0, mockAlignment, 1.0, false, 10.0);

        expect(mockWorkletNode.parameters.get('timeRatio').setValueAtTime).toHaveBeenCalledWith(
            STRETCH_RATIO_LIMITS.MAX, 0
        );
    });

    it('should clamp stretch ratio to MIN when targetDuration is very small', async () => {
        // sliceIndex=0: nativeDuration=0.1s, targetDuration=0.001s => ratio=0.01 → clamped to 0.25
        const audio = new Float32Array(44100 * 0.6);
        await voice.triggerSlice(audio, 0, mockAlignment, 1.0, false, 0.001);

        expect(mockWorkletNode.parameters.get('timeRatio').setValueAtTime).toHaveBeenCalledWith(
            STRETCH_RATIO_LIMITS.MIN, 0
        );
    });

    it('should emit console.warn when stretch ratio is clamped', async () => {
        const warnSpy = vi.spyOn(console, 'warn');
        const audio = new Float32Array(44100 * 0.6);
        // ratio=100 => out of [0.25, 4.0] => warn
        await voice.triggerSlice(audio, 0, mockAlignment, 1.0, false, 10.0);

        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[SingingVoice]'));
        warnSpy.mockRestore();
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

    it('should set grainPitchQuantize on the worklet parameter', () => {
        voice.setGrainPitchQuantize(7);
        expect(mockWorkletNode.parameters.get('grainPitchQuantize').setValueAtTime).toHaveBeenCalledWith(7, 0);
    });
});

describe('clampStretchRatio', () => {
    it('returns ratio unchanged when within valid range', () => {
        expect(clampStretchRatio(1.0)).toBe(1.0);
        expect(clampStretchRatio(0.25)).toBe(0.25);
        expect(clampStretchRatio(4.0)).toBe(4.0);
        expect(clampStretchRatio(2.5)).toBe(2.5);
    });

    it('clamps to MIN when ratio is below range', () => {
        expect(clampStretchRatio(0.1)).toBe(STRETCH_RATIO_LIMITS.MIN);
        expect(clampStretchRatio(0.0)).toBe(STRETCH_RATIO_LIMITS.MIN);
    });

    it('clamps to MAX when ratio is above range', () => {
        expect(clampStretchRatio(5.0)).toBe(STRETCH_RATIO_LIMITS.MAX);
        expect(clampStretchRatio(100)).toBe(STRETCH_RATIO_LIMITS.MAX);
    });

    it('emits console.warn when ratio is below MIN', () => {
        const warnSpy = vi.spyOn(console, 'warn');
        clampStretchRatio(0.1);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[SingingVoice]'));
        warnSpy.mockRestore();
    });

    it('emits console.warn when ratio is above MAX', () => {
        const warnSpy = vi.spyOn(console, 'warn');
        clampStretchRatio(10);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[SingingVoice]'));
        warnSpy.mockRestore();
    });

    it('does NOT emit console.warn when ratio is within valid range', () => {
        const warnSpy = vi.spyOn(console, 'warn');
        clampStretchRatio(2.0);
        expect(warnSpy).not.toHaveBeenCalled();
        warnSpy.mockRestore();
    });
});
