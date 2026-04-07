import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    LatencyCompensator,
    NoteScheduler,
    BpmTimingCalculator,
    MidiClockGenerator,
    calculateRubberBandLatency,
    createLatencySharedMemory,
    writeLatencyToSharedMemory,
    readLatencyFromSharedMemory,
    DEFAULT_LATENCY_CONFIG,
    RUBBER_BAND_LATENCY,
    MIDI_TIMING
} from '../LatencyCompensator';
import type { LatencyCompensatorConfig, ScheduledNote } from '../LatencyCompensator';

// Mock AudioContext
const createMockAudioContext = (sampleRate = 44100): AudioContext => {
    return {
        currentTime: 100,
        sampleRate,
        baseLatency: 0.01,
        getOutputTimestamp: vi.fn().mockReturnValue({
            contextTime: 100,
            performanceTime: 100000
        }),
        state: 'running',
        resume: vi.fn(),
        suspend: vi.fn(),
        close: vi.fn(),
        destination: {} as AudioDestinationNode,
        listener: {} as AudioListener,
        createBuffer: vi.fn(),
        createBufferSource: vi.fn(),
        createMediaElementSource: vi.fn(),
        createMediaStreamSource: vi.fn(),
        createMediaStreamDestination: vi.fn(),
        createGain: vi.fn(),
        createDelay: vi.fn(),
        createBiquadFilter: vi.fn(),
        createIIRFilter: vi.fn(),
        createWaveShaper: vi.fn(),
        createPanner: vi.fn(),
        createStereoPanner: vi.fn(),
        createConvolver: vi.fn(),
        createDynamicsCompressor: vi.fn(),
        createAnalyser: vi.fn(),
        createScriptProcessor: vi.fn(),
        createOscillator: vi.fn(),
        createPeriodicWave: vi.fn(),
        createChannelSplitter: vi.fn(),
        createChannelMerger: vi.fn(),
        createConstantSource: vi.fn(),
        decodeAudioData: vi.fn(),
        audioWorklet: {} as AudioWorklet,
        onstatechange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
        [Symbol.toStringTag]: 'AudioContext'
    } as unknown as AudioContext;
};

describe('LatencyCompensator', () => {
    let audioContext: AudioContext;
    let compensator: LatencyCompensator;

    beforeEach(() => {
        vi.useFakeTimers();
        audioContext = createMockAudioContext();
        compensator = new LatencyCompensator({
            audioContext,
            lookahead: 0.1,
            scheduleInterval: 25
        });
    });

    afterEach(() => {
        compensator.dispose();
        vi.useRealTimers();
    });

    describe('constructor', () => {
        it('should create with valid audio context', () => {
            expect(compensator).toBeInstanceOf(LatencyCompensator);
        });

        it('should throw without audio context', () => {
            expect(() => {
                new LatencyCompensator({} as LatencyCompensatorConfig);
            }).toThrow('audioContext is required');
        });

        it('should apply default config values', () => {
            const comp = new LatencyCompensator({ audioContext });
            expect(comp.getTotalLatency()).toBeGreaterThanOrEqual(0);
        });
    });

    describe('setProcessorLatency', () => {
        it('should set and get processor latency', () => {
            compensator.setProcessorLatency(0.05);
            expect(compensator.getProcessorLatency()).toBe(0.05);
        });

        it('should clamp negative latency to 0', () => {
            compensator.setProcessorLatency(-0.01);
            expect(compensator.getProcessorLatency()).toBe(0);
        });

        it('should trigger latency callback when set', () => {
            const callback = vi.fn();
            compensator.onLatencyUpdate(callback);
            compensator.setProcessorLatency(0.05);
            expect(callback).toHaveBeenCalled();
        });
    });

    describe('setLatencyFromOptions', () => {
        it('should calculate latency for finer engine', () => {
            // Finer engine option: 0x20
            compensator.setLatencyFromOptions(0x20);
            const expectedLatency = RUBBER_BAND_LATENCY.FINER_ENGINE / 44100;
            expect(compensator.getProcessorLatency()).toBeCloseTo(expectedLatency, 5);
        });

        it('should calculate latency for faster engine', () => {
            // Faster engine (no finer flag)
            compensator.setLatencyFromOptions(0);
            const expectedLatency = RUBBER_BAND_LATENCY.FASTER_ENGINE / 44100;
            expect(compensator.getProcessorLatency()).toBeCloseTo(expectedLatency, 5);
        });

        it('should add realtime buffer when realtime flag set', () => {
            // Realtime + Finer: 0x01 | 0x20
            compensator.setLatencyFromOptions(0x21);
            const expectedSamples = RUBBER_BAND_LATENCY.FINER_ENGINE + RUBBER_BAND_LATENCY.REALTIME_BUFFER;
            const expectedLatency = expectedSamples / 44100;
            expect(compensator.getProcessorLatency()).toBeCloseTo(expectedLatency, 5);
        });
    });

    describe('getTimingInfo', () => {
        it('should return complete timing info', () => {
            const info = compensator.getTimingInfo();
            expect(info).toHaveProperty('contextTime');
            expect(info).toHaveProperty('outputTime');
            expect(info).toHaveProperty('performanceTime');
            expect(info).toHaveProperty('processorLatency');
            expect(info).toHaveProperty('baseLatency');
            expect(info).toHaveProperty('totalLatency');
            expect(info).toHaveProperty('sampleRate');
        });

        it('should calculate total latency correctly', () => {
            compensator.setProcessorLatency(0.023);
            const info = compensator.getTimingInfo();
            expect(info.totalLatency).toBe(0.023 + 0.01); // processor + base
        });

        it('should use getOutputTimestamp when available', () => {
            const mockTimestamp = {
                contextTime: 200,
                performanceTime: 200000
            };
            audioContext.getOutputTimestamp = vi.fn().mockReturnValue(mockTimestamp);
            
            const info = compensator.getTimingInfo();
            expect(info.outputTime).toBe(200);
            expect(info.performanceTime).toBe(200000);
        });

        it('should fall back when getOutputTimestamp returns null', () => {
            audioContext.getOutputTimestamp = vi.fn().mockReturnValue(null);
            
            const info = compensator.getTimingInfo();
            expect(info.outputTime).toBe(audioContext.currentTime);
        });
    });

    describe('compensateLatency', () => {
        it('should compensate for processor latency', () => {
            compensator.setProcessorLatency(0.023);
            const targetTime = 10;
            const compensated = compensator.compensateLatency(targetTime);
            expect(compensated).toBe(targetTime - 0.023);
        });

        it('should include drift correction', () => {
            compensator.setProcessorLatency(0.023);
            // Manually set drift correction by triggering a drift record
            compensator['driftCorrection'] = 0.005;
            
            const targetTime = 10;
            const compensated = compensator.compensateLatency(targetTime);
            expect(compensated).toBe(targetTime - 0.023 - 0.005);
        });
    });

    describe('getDisplayTime', () => {
        it('should return time adjusted for total latency', () => {
            compensator.setProcessorLatency(0.023);
            const displayTime = compensator.getDisplayTime();
            const expectedTime = audioContext.currentTime - 0.033; // 0.023 + 0.01 base
            expect(displayTime).toBeCloseTo(expectedTime, 5);
        });
    });

    describe('scheduleNote', () => {
        it('should schedule a note and return ID', () => {
            const note: Omit<ScheduledNote, 'id' | 'triggered'> = {
                midiNote: 60,
                startTime: 10,
                duration: 0.5,
                velocity: 100
            };
            
            const id = compensator.scheduleNote(note);
            expect(typeof id).toBe('number');
            expect(id).toBeGreaterThanOrEqual(0);
        });

        it('should compensate latency when scheduling', () => {
            compensator.setProcessorLatency(0.023);
            const note = {
                midiNote: 60,
                startTime: 10,
                duration: 0.5,
                velocity: 100
            };
            
            compensator.scheduleNote(note);
            const pendingCount = compensator.getPendingNoteCount();
            expect(pendingCount).toBe(1);
        });
    });

    describe('scheduleNotes', () => {
        it('should schedule multiple notes and return IDs', () => {
            const notes = [
                { midiNote: 60, startTime: 10, duration: 0.5, velocity: 100 },
                { midiNote: 64, startTime: 10.5, duration: 0.5, velocity: 100 },
                { midiNote: 67, startTime: 11, duration: 0.5, velocity: 100 }
            ];
            
            const ids = compensator.scheduleNotes(notes);
            expect(ids).toHaveLength(3);
            expect(compensator.getPendingNoteCount()).toBe(3);
        });
    });

    describe('cancelNote', () => {
        it('should cancel a scheduled note', () => {
            const note = {
                midiNote: 60,
                startTime: 10,
                duration: 0.5,
                velocity: 100
            };
            
            const id = compensator.scheduleNote(note);
            expect(compensator.getPendingNoteCount()).toBe(1);
            
            const cancelled = compensator.cancelNote(id);
            expect(cancelled).toBe(true);
            expect(compensator.getPendingNoteCount()).toBe(0);
        });

        it('should return false for non-existent note', () => {
            const cancelled = compensator.cancelNote(999);
            expect(cancelled).toBe(false);
        });
    });

    describe('scheduler integration', () => {
        it('should trigger notes via callback', () => {
            const callback = vi.fn();
            compensator.onNote(callback);
            
            const note = {
                midiNote: 60,
                startTime: audioContext.currentTime + 0.05,
                duration: 0.5,
                velocity: 100
            };
            
            compensator.scheduleNote(note);
            compensator.start();
            
            // Advance timers to trigger the scheduled note
            vi.advanceTimersByTime(100);
            
            expect(callback).toHaveBeenCalled();
            compensator.stop();
        });

        it('should report latency updates', () => {
            const latencyCallback = vi.fn();
            compensator.onLatencyUpdate(latencyCallback);
            
            compensator.start();
            vi.advanceTimersByTime(300);
            
            expect(latencyCallback).toHaveBeenCalled();
            compensator.stop();
        });

        it('should update from shared memory when enabled', () => {
            compensator.enableSharedMemory();
            const shared = compensator.getSharedMemory();
            expect(shared).not.toBeNull();
            
            // Write some data to shared memory
            writeLatencyToSharedMemory(shared!, 0.05, 0.01, 100);
            
            compensator.updateFromSharedMemory();
            expect(compensator.getProcessorLatency()).toBe(0.05);
        });
    });

    describe('start/stop', () => {
        it('should start and stop the scheduler', () => {
            expect(compensator.isActive()).toBe(false);
            
            compensator.start();
            expect(compensator.isActive()).toBe(true);
            
            compensator.stop();
            expect(compensator.isActive()).toBe(false);
        });

        it('should handle multiple start calls gracefully', () => {
            compensator.start();
            compensator.start(); // Should not throw
            expect(compensator.isActive()).toBe(true);
        });

        it('should handle stop when not running', () => {
            compensator.stop(); // Should not throw
            expect(compensator.isActive()).toBe(false);
        });
    });

    describe('getTotalLatency', () => {
        it('should return sum of processor and base latency', () => {
            compensator.setProcessorLatency(0.023);
            const total = compensator.getTotalLatency();
            expect(total).toBe(0.023 + 0.01); // processor + base
        });
    });

    describe('getLatencyReport', () => {
        it('should return null before any updates', () => {
            expect(compensator.getLatencyReport()).toBeNull();
        });

        it('should return report after latency update', () => {
            compensator.setProcessorLatency(0.023);
            const report = compensator.getLatencyReport();
            
            expect(report).not.toBeNull();
            expect(report).toHaveProperty('totalLatencyMs');
            expect(report).toHaveProperty('processorLatencyMs');
            expect(report).toHaveProperty('outputLatencyMs');
            expect(report).toHaveProperty('isSynchronized');
            expect(report).toHaveProperty('driftMs');
        });
    });

    describe('dispose', () => {
        it('should clean up resources', () => {
            compensator.start();
            compensator.scheduleNote({
                midiNote: 60,
                startTime: 10,
                duration: 0.5,
                velocity: 100
            });
            
            compensator.dispose();
            
            expect(compensator.isActive()).toBe(false);
            expect(compensator.getPendingNoteCount()).toBe(0);
        });
    });
});

describe('NoteScheduler', () => {
    let scheduler: NoteScheduler;

    beforeEach(() => {
        scheduler = new NoteScheduler();
    });

    describe('scheduleNote', () => {
        it('should schedule note and return incrementing IDs', () => {
            const id1 = scheduler.scheduleNote({
                midiNote: 60,
                startTime: 10,
                duration: 0.5,
                velocity: 100
            });
            
            const id2 = scheduler.scheduleNote({
                midiNote: 64,
                startTime: 11,
                duration: 0.5,
                velocity: 100
            });
            
            expect(id2).toBe(id1 + 1);
        });

        it('should keep notes sorted by start time', () => {
            scheduler.scheduleNote({
                midiNote: 60,
                startTime: 12,
                duration: 0.5,
                velocity: 100
            });
            
            scheduler.scheduleNote({
                midiNote: 64,
                startTime: 10,
                duration: 0.5,
                velocity: 100
            });
            
            const next = scheduler.getNextNote();
            expect(next?.midiNote).toBe(64); // Earlier time
        });
    });

    describe('scheduleNotes', () => {
        it('should batch schedule notes', () => {
            const notes = [
                { midiNote: 60, startTime: 10, duration: 0.5, velocity: 100 },
                { midiNote: 64, startTime: 11, duration: 0.5, velocity: 100 }
            ];
            
            const ids = scheduler.scheduleNotes(notes);
            expect(ids).toHaveLength(2);
            expect(scheduler.getPendingCount()).toBe(2);
        });
    });

    describe('getNotesToTrigger', () => {
        it('should return notes within lookahead window', () => {
            scheduler.scheduleNote({
                midiNote: 60,
                startTime: 10,
                duration: 0.5,
                velocity: 100
            });
            
            const notes = scheduler.getNotesToTrigger(9.5, 1);
            expect(notes).toHaveLength(1);
        });

        it('should not return triggered notes', () => {
            scheduler.scheduleNote({
                midiNote: 60,
                startTime: 10,
                duration: 0.5,
                velocity: 100
            });
            
            const notes = scheduler.getNotesToTrigger(9.5, 1);
            scheduler.markTriggered(notes[0]);
            
            const notes2 = scheduler.getNotesToTrigger(9.5, 1);
            expect(notes2).toHaveLength(0);
        });

        it('should not return notes outside lookahead window', () => {
            scheduler.scheduleNote({
                midiNote: 60,
                startTime: 20,
                duration: 0.5,
                velocity: 100
            });
            
            const notes = scheduler.getNotesToTrigger(10, 1);
            expect(notes).toHaveLength(0);
        });
    });

    describe('getNextNote', () => {
        it('should return next pending note', () => {
            scheduler.scheduleNote({
                midiNote: 60,
                startTime: 10,
                duration: 0.5,
                velocity: 100
            });
            
            const next = scheduler.getNextNote();
            expect(next?.midiNote).toBe(60);
        });

        it('should return undefined when no pending notes', () => {
            expect(scheduler.getNextNote()).toBeUndefined();
        });
    });

    describe('cancelNote', () => {
        it('should cancel by ID', () => {
            const id = scheduler.scheduleNote({
                midiNote: 60,
                startTime: 10,
                duration: 0.5,
                velocity: 100
            });
            
            expect(scheduler.cancelNote(id)).toBe(true);
            expect(scheduler.getPendingCount()).toBe(0);
        });

        it('should not cancel already triggered notes', () => {
            const id = scheduler.scheduleNote({
                midiNote: 60,
                startTime: 10,
                duration: 0.5,
                velocity: 100
            });
            
            const notes = scheduler.getNotesToTrigger(9.5, 1);
            scheduler.markTriggered(notes[0]);
            
            expect(scheduler.cancelNote(id)).toBe(false);
        });
    });

    describe('drift tracking', () => {
        it('should record and calculate average drift', () => {
            scheduler.recordDrift(10, 10.005); // 5ms late
            scheduler.recordDrift(11, 11.003); // 3ms late
            
            const avgDrift = scheduler.getAverageDrift();
            expect(avgDrift).toBeCloseTo(4, 1);
        });

        it('should return 0 for no drift history', () => {
            expect(scheduler.getAverageDrift()).toBe(0);
        });

        it('should limit drift history size', () => {
            // Add more than maxDriftHistory entries
            for (let i = 0; i < 15; i++) {
                scheduler.recordDrift(i, i + 0.001);
            }
            
            const avgDrift = scheduler.getAverageDrift();
            expect(avgDrift).toBeGreaterThan(0);
        });
    });

    describe('clearOldNotes', () => {
        it('should remove completed notes', () => {
            scheduler.scheduleNote({
                midiNote: 60,
                startTime: 5,
                duration: 0.5,
                velocity: 100
            });
            
            scheduler.clearOldNotes(10);
            expect(scheduler.getPendingCount()).toBe(0);
        });

        it('should keep ongoing notes', () => {
            scheduler.scheduleNote({
                midiNote: 60,
                startTime: 8,
                duration: 5,
                velocity: 100
            });
            
            scheduler.clearOldNotes(10);
            expect(scheduler.getPendingCount()).toBe(1);
        });
    });

    describe('clearAll', () => {
        it('should remove all notes', () => {
            scheduler.scheduleNote({
                midiNote: 60,
                startTime: 10,
                duration: 0.5,
                velocity: 100
            });
            
            scheduler.clearAll();
            expect(scheduler.getPendingCount()).toBe(0);
        });
    });

    describe('getPendingCount', () => {
        it('should return count of non-triggered notes', () => {
            scheduler.scheduleNote({
                midiNote: 60,
                startTime: 10,
                duration: 0.5,
                velocity: 100
            });
            
            scheduler.scheduleNote({
                midiNote: 64,
                startTime: 11,
                duration: 0.5,
                velocity: 100
            });
            
            expect(scheduler.getPendingCount()).toBe(2);
        });
    });

    describe('getEarliestStartTime', () => {
        it('should return earliest pending note time', () => {
            scheduler.scheduleNote({
                midiNote: 64,
                startTime: 11,
                duration: 0.5,
                velocity: 100
            });
            
            scheduler.scheduleNote({
                midiNote: 60,
                startTime: 10,
                duration: 0.5,
                velocity: 100
            });
            
            expect(scheduler.getEarliestStartTime()).toBe(10);
        });

        it('should return null when no pending notes', () => {
            expect(scheduler.getEarliestStartTime()).toBeNull();
        });
    });
});

describe('calculateRubberBandLatency', () => {
    it('should calculate latency for finer engine', () => {
        const latency = calculateRubberBandLatency(0x20, 44100);
        expect(latency).toBe(RUBBER_BAND_LATENCY.FINER_ENGINE / 44100);
    });

    it('should calculate latency for faster engine', () => {
        const latency = calculateRubberBandLatency(0, 44100);
        expect(latency).toBe(RUBBER_BAND_LATENCY.FASTER_ENGINE / 44100);
    });

    it('should add realtime buffer when realtime flag set', () => {
        const latency = calculateRubberBandLatency(0x01 | 0x20, 44100);
        const expected = (RUBBER_BAND_LATENCY.FINER_ENGINE + RUBBER_BAND_LATENCY.REALTIME_BUFFER) / 44100;
        expect(latency).toBe(expected);
    });

    it('should use default sample rate when not specified', () => {
        const latency = calculateRubberBandLatency();
        expect(latency).toBeGreaterThan(0);
    });

    it('should handle different sample rates', () => {
        const latency48k = calculateRubberBandLatency(0x20, 48000);
        const latency44k = calculateRubberBandLatency(0x20, 44100);
        
        // Same samples, different rate = different seconds
        expect(latency48k).not.toBe(latency44k);
        expect(latency48k).toBeLessThan(latency44k);
    });
});

describe('Shared Memory', () => {
    describe('createLatencySharedMemory', () => {
        it('should create shared memory structure', () => {
            const shared = createLatencySharedMemory();
            expect(shared).toHaveProperty('buffer');
            expect(shared).toHaveProperty('processorLatencyOffset');
            expect(shared).toHaveProperty('baseLatencyOffset');
            expect(shared).toHaveProperty('currentTimeOffset');
            expect(shared).toHaveProperty('syncFlagOffset');
        });

        it('should create SharedArrayBuffer', () => {
            const shared = createLatencySharedMemory();
            expect(shared.buffer).toBeInstanceOf(SharedArrayBuffer);
        });
    });

    describe('writeLatencyToSharedMemory', () => {
        it('should write latency data to shared memory', () => {
            const shared = createLatencySharedMemory();
            writeLatencyToSharedMemory(shared, 0.023, 0.01, 100);
            
            const data = readLatencyFromSharedMemory(shared);
            expect(data).not.toBeNull();
            expect(data?.processorLatency).toBe(0.023);
            expect(data?.baseLatency).toBe(0.01);
            expect(data?.contextTime).toBe(100);
        });
    });

    describe('readLatencyFromSharedMemory', () => {
        it('should return null when not synchronized', () => {
            const shared = createLatencySharedMemory();
            const data = readLatencyFromSharedMemory(shared);
            expect(data).toBeNull();
        });

        it('should read latency data when synchronized', () => {
            const shared = createLatencySharedMemory();
            writeLatencyToSharedMemory(shared, 0.023, 0.01, 100);
            
            const data = readLatencyFromSharedMemory(shared);
            expect(data?.processorLatency).toBe(0.023);
            expect(data?.baseLatency).toBe(0.01);
            expect(data?.contextTime).toBe(100);
        });
    });
});

describe('BpmTimingCalculator', () => {
    let calculator: BpmTimingCalculator;

    beforeEach(() => {
        calculator = new BpmTimingCalculator(120, 44100);
    });

    describe('constructor', () => {
        it('should create with default BPM', () => {
            const calc = new BpmTimingCalculator();
            expect(calc.getSecondsPerBeat()).toBe(0.5); // 60/120
        });
    });

    describe('setBpm', () => {
        it('should update BPM', () => {
            calculator.setBpm(60);
            expect(calculator.getSecondsPerBeat()).toBe(1);
        });

        it('should clamp BPM to minimum of 1', () => {
            calculator.setBpm(0);
            expect(calculator.getSecondsPerBeat()).toBe(60); // 60/1
        });
    });

    describe('getSecondsPerBeat', () => {
        it('should calculate correctly at 120 BPM', () => {
            expect(calculator.getSecondsPerBeat()).toBe(0.5);
        });

        it('should calculate correctly at 60 BPM', () => {
            calculator.setBpm(60);
            expect(calculator.getSecondsPerBeat()).toBe(1);
        });
    });

    describe('getSecondsForSteps', () => {
        it('should calculate for 4 steps at 4 steps per beat', () => {
            expect(calculator.getSecondsForSteps(4, 4)).toBe(0.5); // One beat
        });

        it('should calculate for 16 steps at 4 steps per beat', () => {
            expect(calculator.getSecondsForSteps(16, 4)).toBe(2); // Four beats
        });
    });

    describe('timeToSamples', () => {
        it('should convert time to samples', () => {
            expect(calculator.timeToSamples(1)).toBe(44100);
        });

        it('should floor to integer samples', () => {
            expect(calculator.timeToSamples(1.0001)).toBe(44104);
        });
    });

    describe('samplesToTime', () => {
        it('should convert samples to time', () => {
            expect(calculator.samplesToTime(44100)).toBe(1);
        });
    });

    describe('calculateNoteTime', () => {
        it('should calculate time for beat 0, step 0', () => {
            expect(calculator.calculateNoteTime(0, 0, 4)).toBe(0);
        });

        it('should calculate time for beat 1, step 0', () => {
            expect(calculator.calculateNoteTime(1, 0, 4)).toBe(0.5);
        });

        it('should calculate time for beat 0, step 2', () => {
            expect(calculator.calculateNoteTime(0, 2, 4)).toBe(0.25);
        });
    });
});

describe('MidiClockGenerator', () => {
    let clock: MidiClockGenerator;

    beforeEach(() => {
        clock = new MidiClockGenerator(120);
    });

    describe('start/stop', () => {
        it('should start and stop', () => {
            clock.start(100);
            expect(clock.getPosition(100)).toBe(0);
            
            clock.stop();
            expect(clock.getPosition(101)).toBe(0);
        });
    });

    describe('setBpm', () => {
        it('should update BPM', () => {
            clock.setBpm(60);
            clock.start(100);
            
            // At 60 BPM, 1 second = 1 beat
            expect(clock.getPosition(101)).toBe(1);
        });
    });

    describe('getPosition', () => {
        it('should return 0 when not running', () => {
            expect(clock.getPosition(100)).toBe(0);
        });

        it('should calculate position correctly', () => {
            clock.start(100);
            
            // At 120 BPM, 0.5 seconds = 1 beat
            expect(clock.getPosition(100.5)).toBe(1);
        });
    });

    describe('getTick', () => {
        it('should return tick within PPQN range', () => {
            clock.start(100);
            const tick = clock.getTick(100.1);
            expect(tick).toBeGreaterThanOrEqual(0);
            expect(tick).toBeLessThan(MIDI_TIMING.PPQN);
        });

        it('should cycle through ticks', () => {
            clock.start(100);
            
            // At 120 BPM, one beat = 0.5 seconds
            // 24 PPQN, so each tick = 0.5/24 seconds
            const tick1 = clock.getTick(100);
            // Advance by one tick duration
            const tickInterval = (60 / 120) / MIDI_TIMING.PPQN;
            const tick2 = clock.getTick(100 + tickInterval + 0.001); // Add small offset to ensure next tick
            
            expect(tick2).not.toBe(tick1);
        });
    });

    describe('shouldSendPulse', () => {
        it('should return false when not running', () => {
            expect(clock.shouldSendPulse(100)).toBe(false);
        });

        it('should return true when pulse is due', () => {
            clock.start(100);
            
            // First pulse immediately at start (time 0 of the clock)
            expect(clock.shouldSendPulse(100)).toBe(true);
            
            // No pulse immediately after
            expect(clock.shouldSendPulse(100)).toBe(false);
            
            // Pulse after tick interval (add small buffer to ensure next tick boundary)
            const tickInterval = (60 / 120) / MIDI_TIMING.PPQN; // seconds per tick
            expect(clock.shouldSendPulse(100 + tickInterval + 0.001)).toBe(true);
        });
    });

    describe('onPulse', () => {
        it('should call callback on pulse', () => {
            const callback = vi.fn();
            clock.onPulse(callback);
            
            clock.start(100);
            clock.process(100);
            
            expect(callback).toHaveBeenCalled();
        });
    });

    describe('process', () => {
        it('should trigger pulse callback', () => {
            const callback = vi.fn();
            clock.onPulse(callback);
            
            clock.start(100);
            const tickInterval = (60 / 120) / MIDI_TIMING.PPQN;
            
            // First process at start time should trigger pulse
            clock.process(100);
            expect(callback).toHaveBeenCalledTimes(1);
            
            // Process after tick interval with small buffer should trigger next pulse
            clock.process(100 + tickInterval + 0.001);
            expect(callback).toHaveBeenCalledTimes(2);
        });
    });
});

describe('Constants', () => {
    it('should have correct DEFAULT_LATENCY_CONFIG', () => {
        expect(DEFAULT_LATENCY_CONFIG.lookahead).toBe(0.1);
        expect(DEFAULT_LATENCY_CONFIG.scheduleInterval).toBe(25);
        expect(DEFAULT_LATENCY_CONFIG.rubberBandLookahead).toBe(1024);
        expect(DEFAULT_LATENCY_CONFIG.enableDriftCorrection).toBe(true);
        expect(DEFAULT_LATENCY_CONFIG.maxDriftMs).toBe(5);
    });

    it('should have correct RUBBER_BAND_LATENCY values', () => {
        expect(RUBBER_BAND_LATENCY.FINER_ENGINE).toBe(2048);
        expect(RUBBER_BAND_LATENCY.FASTER_ENGINE).toBe(512);
        expect(RUBBER_BAND_LATENCY.REALTIME_BUFFER).toBe(256);
        expect(RUBBER_BAND_LATENCY.DEFAULT).toBe(1024);
    });

    it('should have correct MIDI_TIMING values', () => {
        expect(MIDI_TIMING.PPQN).toBe(24);
        expect(MIDI_TIMING.DEFAULT_US_PER_QN).toBe(500000);
        expect(MIDI_TIMING.BLOCK_SIZE).toBe(128);
    });
});
