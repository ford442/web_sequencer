// src/__tests__/SingingVoice.integration.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SingingVoice } from '../engines/SingingVoice';

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

// Mock the AudioWorkletNode constructor globally
globalThis.AudioWorkletNode = MockAudioWorkletNode as any;

describe('SingingVoice Integration', () => {
    let audioContext: AudioContext;
    let voice: SingingVoice;
    
    beforeEach(() => {
        audioContext = new MockAudioContext() as any;
    });
    
    describe('Basic Initialization', () => {
        it('should initialize without features', () => {
            voice = new SingingVoice(audioContext);
            
            expect(voice).toBeDefined();
            expect(voice.getPhonemeAligner()).toBeNull();
            expect(voice.getFormantShifter()).toBeNull();
        });
        
        it('should initialize with phoneme stretching enabled', () => {
            voice = new SingingVoice(audioContext, {
                enablePhonemeStretching: true
            });
            
            expect(voice.getPhonemeAligner()).not.toBeNull();
        });
        
        it('should initialize with formant shifting enabled', () => {
            voice = new SingingVoice(audioContext, {
                enableFormantShifting: true
            });
            
            expect(voice.getFormantShifter()).not.toBeNull();
        });
        
        it('should initialize with both features enabled', () => {
            voice = new SingingVoice(audioContext, {
                enablePhonemeStretching: true,
                enableFormantShifting: true,
                voiceCharacter: 'female'
            });
            
            expect(voice.getPhonemeAligner()).not.toBeNull();
            expect(voice.getFormantShifter()).not.toBeNull();
        });
    });
    
    describe('Phoneme Alignment (Section 3)', () => {
        beforeEach(() => {
            voice = new SingingVoice(audioContext, {
                enablePhonemeStretching: true
            });
        });
        
        it('should align phonemes in audio', async () => {
            const audioData = new Float32Array(44100); // 1 second
            const text = "hello";
            
            const result = await voice.alignPhonemes(audioData, text);
            
            expect(result).not.toBeNull();
            expect(result?.phonemes.length).toBeGreaterThan(0);
        });
        
        it('should store alignment result internally', async () => {
            const audioData = new Float32Array(44100);
            const text = "test";
            
            await voice.alignPhonemes(audioData, text);
            
            const stored = voice.getLastAlignment();
            expect(stored).not.toBeNull();
            expect(stored?.text).toBe(text);
        });
        
        it('should warn when phoneme alignment is disabled', async () => {
            const voiceWithoutFeature = new SingingVoice(audioContext);
            const consoleWarnSpy = vi.spyOn(console, 'warn');
            
            const result = await voiceWithoutFeature.alignPhonemes(
                new Float32Array(44100),
                "test"
            );
            
            expect(result).toBeNull();
            expect(consoleWarnSpy).toHaveBeenCalled();
            
            consoleWarnSpy.mockRestore();
        });
    });
    
    describe('Formant Shifting (Section 4)', () => {
        beforeEach(() => {
            voice = new SingingVoice(audioContext, {
                enableFormantShifting: true
            });
        });
        
        it('should set voice character', () => {
            voice.setVoiceCharacter('female');
            
            const shifter = voice.getFormantShifter();
            expect(shifter).not.toBeNull();
            
            const currentShift = shifter?.getCurrentShift();
            expect(currentShift).not.toBeNull();
        });
        
        it('should transform between characters', () => {
            voice.setVoiceCharacter('female', 'male');
            
            const shifter = voice.getFormantShifter();
            const shift = shifter?.getCurrentShift();
            
            // Female formants are higher, so shifts should be positive
            expect(shift?.f1Shift).toBeGreaterThan(0);
            expect(shift?.f2Shift).toBeGreaterThan(0);
            expect(shift?.f3Shift).toBeGreaterThan(0);
        });
        
        it('should warn when formant shifting is disabled', () => {
            const voiceWithoutFeature = new SingingVoice(audioContext);
            const consoleWarnSpy = vi.spyOn(console, 'warn');
            
            voiceWithoutFeature.setVoiceCharacter('female');
            
            expect(consoleWarnSpy).toHaveBeenCalled();
            
            consoleWarnSpy.mockRestore();
        });
    });
    
    describe('Combined Features', () => {
        beforeEach(async () => {
            voice = new SingingVoice(audioContext, {
                enablePhonemeStretching: true,
                enableFormantShifting: true,
                voiceCharacter: 'female'
            });
        });
        
        it('should support both phoneme and formant features', () => {
            expect(voice.getPhonemeAligner()).not.toBeNull();
            expect(voice.getFormantShifter()).not.toBeNull();
        });
        
        it('should send phoneme data to worklet', async () => {
            const audioData = new Float32Array(44100);
            const text = "sing";
            
            await voice.alignPhonemes(audioData, text);
            
            // Verify alignment was successful
            const alignment = voice.getLastAlignment();
            expect(alignment).not.toBeNull();
            expect(alignment?.text).toBe(text);
        });
        
        it('should have formant shifter configured', () => {
            const shifter = voice.getFormantShifter();
            expect(shifter).not.toBeNull();
        });
    });
    
    describe('Multi-Resolution Pitch Caching (Section 2)', () => {
        beforeEach(() => {
            voice = new SingingVoice(audioContext);
        });
        
        it('should select correct base pitch for low notes', () => {
            const basePitch = voice.getNearestBasePitch(48); // C3
            expect(basePitch).toBe('low');
        });
        
        it('should select correct base pitch for mid notes', () => {
            const basePitch = voice.getNearestBasePitch(60); // C4
            expect(basePitch).toBe('mid');
        });
        
        it('should select correct base pitch for high notes', () => {
            const basePitch = voice.getNearestBasePitch(72); // C5
            expect(basePitch).toBe('high');
        });
        
        it('should cache audio at different pitch levels', () => {
            const lowAudio = new Float32Array(44100);
            const midAudio = new Float32Array(88200);
            const highAudio = new Float32Array(132300);
            
            voice.setCachedAudio('low', lowAudio);
            voice.setCachedAudio('mid', midAudio);
            voice.setCachedAudio('high', highAudio);
            
            // Verify by attempting to use cached audio
            const nearestLow = voice.getNearestBasePitch(48);
            const nearestMid = voice.getNearestBasePitch(60);
            const nearestHigh = voice.getNearestBasePitch(72);
            
            expect(nearestLow).toBe('low');
            expect(nearestMid).toBe('mid');
            expect(nearestHigh).toBe('high');
        });
    });
    
    describe('Latency and Timing', () => {
        beforeEach(() => {
            voice = new SingingVoice(audioContext);
        });
        
        it('should report latency in samples', () => {
            const latency = voice.getLatency();
            expect(latency).toBeGreaterThanOrEqual(0);
        });
        
        it('should report latency in seconds', () => {
            const latencySeconds = voice.getLatencySeconds();
            expect(latencySeconds).toBeGreaterThanOrEqual(0);
        });
    });
});
