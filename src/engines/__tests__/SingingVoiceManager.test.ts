import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SingingVoiceManager } from '../SingingVoiceManager';

// Mock SingingVoice
vi.mock('../SingingVoice', () => {
    return {
        // vitest 4 invokes mock implementations with `new` via Reflect.construct,
        // so the implementation must be a constructable function, not an arrow.
        SingingVoice: vi.fn().mockImplementation(function () { return {
            isActive: false,
            initWorklet: vi.fn().mockResolvedValue(undefined),
            connectOutput: vi.fn(),
            disconnectOutput: vi.fn(),
            setFormantShift: vi.fn(),
            setVibratoDepth: vi.fn(),
            setBreathIntensity: vi.fn(),
            setGrainPitchQuantize: vi.fn(),
            loadBuffer: vi.fn(),
            play: vi.fn(),
            setTimeRatio: vi.fn(),
            setPitch: vi.fn(),
            setPitchFromMidi: vi.fn(),
            alignPhonemes: vi.fn(),
            triggerSlice: vi.fn(),
            noteOff: vi.fn()
        }; })
    };
});

describe('SingingVoiceManager', () => {
    let audioContext: AudioContext;
    let manager: SingingVoiceManager;

    beforeEach(() => {
        audioContext = {
            createGain: vi.fn(),
            createStereoPanner: vi.fn(),
            destination: {},
            currentTime: 0,
            state: 'running',
            resume: vi.fn(),
            sampleRate: 44100
        } as unknown as AudioContext;

        manager = new SingingVoiceManager(audioContext, 4); // Small pool for testing
    });

    it('initializes the correct number of voices', async () => {
        await manager.init();
        expect(manager.getAllVoices().length).toBe(4);
    });

    it('acquires free voices correctly', async () => {
        await manager.init();

        const v1 = manager.acquireVoice();
        manager.registerActiveVoice(v1.index, 'C4', 0);
        v1.voice.isActive = true;
        expect(v1.index).toBe(0);

        const v2 = manager.acquireVoice();
        manager.registerActiveVoice(v2.index, 'E4', 0);
        v2.voice.isActive = true;
        expect(v2.index).toBe(1);
    });

    it('steals the oldest voice when full', async () => {
        await manager.init();

        // Fill all 4 voices
        for (let i = 0; i < 4; i++) {
            const v = manager.acquireVoice();
            manager.registerActiveVoice(v.index, `Note${i}`, i * 10); // Start times: 0, 10, 20, 30
            v.voice.isActive = true;
        }

        // Try to acquire 5th voice
        const stolen = manager.acquireVoice();

        // Should steal index 0 (start time 0)
        expect(stolen.index).toBe(0);
    });

    it('releases voices correctly', async () => {
        await manager.init();

        const v1 = manager.acquireVoice();
        manager.registerActiveVoice(v1.index, 'C4', 0);

        manager.releaseVoice(v1.index);
        v1.voice.isActive = false;

        // Should get index 0 again as it's free
        const v2 = manager.acquireVoice();
        expect(v2.index).toBe(0);
    });
});
