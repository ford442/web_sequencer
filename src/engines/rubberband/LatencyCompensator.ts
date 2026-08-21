/**
 * LatencyCompensator - MIDI sync and latency management for precise timing
 * 
 * Part of RUBBERBAND_ENHANCEMENT_PLAN Section 9: Latency & Synchronization
 * 
 * Ensures precise MIDI synchronization by:
 * - Compensating for Rubber Band's lookahead latency
 * - Scheduling notes ahead of time
 * - Using AudioContext timestamps for accurate timing
 * - Reporting latency for visual metronome alignment
 * 
 * Thread Safety:
 * - Main thread: Use LatencyCompensator for scheduling
 * - AudioWorklet: Use LatencyReport for latency reporting
 * - SharedArrayBuffer for lock-free communication between threads
 * 
 * @see RUBBERBAND_ENHANCEMENT_PLAN.md Section 9
 */

import type { SingingVoice } from '../SingingVoice';

/** Scheduled note information */
export interface ScheduledNote {
    /** Unique note ID */
    id: number;
    /** MIDI note number */
    midiNote: number;
    /** Start time in AudioContext time */
    startTime: number;
    /** Duration in seconds */
    duration: number;
    /** Velocity (0-127) */
    velocity: number;
    /** Associated lyrics/phonemes */
    text?: string;
    /** Whether the note has been triggered */
    triggered: boolean;
    /** Voice to use for playback */
    voice?: SingingVoice;
    /** Pitch offset in semitones (for harmonizer) */
    pitchOffset?: number;
}

/** Timing information for synchronization */
export interface TimingInfo {
    /** Current AudioContext time */
    contextTime: number;
    /** Output timestamp */
    outputTime: number;
    /** Performance.now() at measurement */
    performanceTime: number;
    /** Rubber Band processor latency in seconds */
    processorLatency: number;
    /** AudioContext base latency */
    baseLatency: number;
    /** Total system latency (processor + base) */
    totalLatency: number;
    /** Sample rate */
    sampleRate: number;
}

/** Latency report for visual metronome alignment */
export interface LatencyReport {
    /** Total latency in milliseconds */
    totalLatencyMs: number;
    /** Processor latency in milliseconds */
    processorLatencyMs: number;
    /** Audio output latency in milliseconds */
    outputLatencyMs: number;
    /** Whether timing is synchronized */
    isSynchronized: boolean;
    /** Drift from expected time in milliseconds */
    driftMs: number;
}

/** Configuration for latency compensator */
export interface LatencyCompensatorConfig {
    /** AudioContext reference */
    audioContext: AudioContext;
    /** Lookahead time for scheduling (in seconds) */
    lookahead: number;
    /** How often to check schedule (in ms) */
    scheduleInterval: number;
    /** Rubber Band lookahead latency in samples (default: 1024) */
    rubberBandLookahead: number;
    /** Enable drift correction (default: true) */
    enableDriftCorrection: boolean;
    /** Maximum allowed drift before correction (in ms, default: 5) */
    maxDriftMs: number;
}

/** Default latency compensator configuration */
export const DEFAULT_LATENCY_CONFIG: LatencyCompensatorConfig = {
    audioContext: null as unknown as AudioContext, // Must be provided
    lookahead: 0.1, // 100ms lookahead
    scheduleInterval: 25, // 25ms check interval
    rubberBandLookahead: 1024, // Default Rubber Band lookahead
    enableDriftCorrection: true,
    maxDriftMs: 5
};

/** Rubber Band latency constants based on engine mode */
export const RUBBER_BAND_LATENCY = {
    /** Finer engine lookahead in samples (higher quality, more latency) */
    FINER_ENGINE: 2048,
    /** Faster engine lookahead in samples (lower quality, less latency) */
    FASTER_ENGINE: 512,
    /** Real-time mode additional buffer */
    REALTIME_BUFFER: 256,
    /** Default base latency */
    DEFAULT: 1024
};

/** MIDI timing constants */
export const MIDI_TIMING = {
    /** Pulses per quarter note (standard MIDI) */
    PPQN: 24,
    /** Microseconds per quarter note default (120 BPM) */
    DEFAULT_US_PER_QN: 500000,
    /** Standard sample block size for Web Audio */
    BLOCK_SIZE: 128
};

/**
 * Calculate Rubber Band lookahead latency based on configuration.
 * 
 * Rubber Band uses lookahead for time-stretching algorithms to achieve
 * better quality. The latency depends on the engine mode:
 * - Finer engine: ~2048 samples (higher quality, more latency)
 * - Faster engine: ~512 samples (lower quality, less latency)
 * - Real-time mode: Additional ~256 samples buffer
 * 
 * @param options Rubber Band options bitmask (from rubberband-processor.ts)
 * @param sampleRate Sample rate in Hz
 * @returns Latency in seconds
 */
export function calculateRubberBandLatency(
    options: number = RUBBER_BAND_LATENCY.DEFAULT,
    sampleRate: number = 44100
): number {
    // Check for Engine option (bit 5: 0x20)
    const isFinerEngine = (options & 0x20) !== 0;
    // Check for RealTime option (bit 0: 0x01)
    const isRealtime = (options & 0x01) !== 0;

    let latencySamples = isFinerEngine 
        ? RUBBER_BAND_LATENCY.FINER_ENGINE 
        : RUBBER_BAND_LATENCY.FASTER_ENGINE;

    if (isRealtime) {
        latencySamples += RUBBER_BAND_LATENCY.REALTIME_BUFFER;
    }

    return latencySamples / sampleRate;
}

/**
 * Calculate latency from a specific voice configuration.
 * 
 * @param voice SingingVoice instance
 * @returns Latency in seconds
 */
export function getLatencyFromVoice(voice: SingingVoice): number {
    return voice.getLatencySeconds();
}

/**
 * Shared memory structure for lock-free latency reporting between threads.
 * Uses SharedArrayBuffer for AudioWorklet <-> Main thread communication.
 */
export interface LatencySharedMemory {
    /** Shared buffer for latency data */
    buffer: SharedArrayBuffer;
    /** Offset for processor latency (Float64, 8 bytes) */
    processorLatencyOffset: number;
    /** Offset for base latency (Float64, 8 bytes) */
    baseLatencyOffset: number;
    /** Offset for current time (Float64, 8 bytes) */
    currentTimeOffset: number;
    /** Offset for synchronization flag (Int32, 4 bytes) */
    syncFlagOffset: number;
}

/**
 * Create shared memory for latency reporting.
 * 
 * @returns LatencySharedMemory structure
 */
export function createLatencySharedMemory(): LatencySharedMemory {
    // Total size: 8 + 8 + 8 + 4 = 28 bytes, round up to 32
    const buffer = new SharedArrayBuffer(32);
    
    return {
        buffer,
        processorLatencyOffset: 0,
        baseLatencyOffset: 8,
        currentTimeOffset: 16,
        syncFlagOffset: 24
    };
}

/**
 * Write latency data to shared memory (AudioWorklet side).
 * 
 * @param shared Shared memory structure
 * @param processorLatency Processor latency in seconds
 * @param baseLatency Base latency in seconds
 * @param currentTime Current audio context time
 */
export function writeLatencyToSharedMemory(
    shared: LatencySharedMemory,
    processorLatency: number,
    baseLatency: number,
    currentTime: number
): void {
    const view = new Float64Array(shared.buffer);
    view[shared.processorLatencyOffset / 8] = processorLatency;
    view[shared.baseLatencyOffset / 8] = baseLatency;
    view[shared.currentTimeOffset / 8] = currentTime;
    
    // Set sync flag
    const intView = new Int32Array(shared.buffer);
    Atomics.store(intView, shared.syncFlagOffset / 4, 1);
}

/**
 * Read latency data from shared memory (Main thread side).
 * 
 * @param shared Shared memory structure
 * @returns Current timing info or null if not synchronized
 */
export function readLatencyFromSharedMemory(
    shared: LatencySharedMemory
): Pick<TimingInfo, 'processorLatency' | 'baseLatency' | 'contextTime'> | null {
    const intView = new Int32Array(shared.buffer);
    
    // Check sync flag
    if (Atomics.load(intView, shared.syncFlagOffset / 4) === 0) {
        return null;
    }
    
    const view = new Float64Array(shared.buffer);
    return {
        processorLatency: view[shared.processorLatencyOffset / 8],
        baseLatency: view[shared.baseLatencyOffset / 8],
        contextTime: view[shared.currentTimeOffset / 8]
    };
}

/** Callback type for note triggering */
export type NoteTriggerCallback = (note: ScheduledNote) => void;

/** Callback type for latency updates */
export type LatencyUpdateCallback = (report: LatencyReport) => void;

/**
 * NoteScheduler class for precise MIDI timing with latency compensation.
 * 
 * Manages a queue of scheduled notes and triggers them at the correct time
 * accounting for audio processing latency.
 */
export class NoteScheduler {
    private scheduledNotes: ScheduledNote[] = [];
    private nextNoteId: number = 0;
    private lastTriggerTime: number = 0;
    private driftHistory: number[] = [];
    private readonly maxDriftHistory = 10;

    /**
     * Add a note to the schedule.
     * 
     * @param note Note information
     * @returns Note ID for tracking
     */
    scheduleNote(note: Omit<ScheduledNote, 'id' | 'triggered'>): number {
        const id = this.nextNoteId++;
        this.scheduledNotes.push({
            ...note,
            id,
            triggered: false
        });
        
        // Keep array sorted by start time
        this.scheduledNotes.sort((a, b) => a.startTime - b.startTime);
        
        return id;
    }

    /**
     * Schedule multiple notes at once (batch operation).
     * More efficient than individual scheduleNote calls.
     * 
     * @param notes Array of note information
     * @returns Array of note IDs
     */
    scheduleNotes(notes: Omit<ScheduledNote, 'id' | 'triggered'>[]): number[] {
        const ids: number[] = [];
        
        for (const note of notes) {
            const id = this.nextNoteId++;
            this.scheduledNotes.push({
                ...note,
                id,
                triggered: false
            });
            ids.push(id);
        }
        
        // Keep array sorted by start time
        this.scheduledNotes.sort((a, b) => a.startTime - b.startTime);
        
        return ids;
    }

    /**
     * Get notes that should be triggered at the given time.
     * 
     * @param currentTime Current AudioContext time
     * @param lookahead How far ahead to look
     * @returns Notes to trigger
     */
    getNotesToTrigger(currentTime: number, lookahead: number): ScheduledNote[] {
        const windowEnd = currentTime + lookahead;
        const result: ScheduledNote[] = [];
        
        // ⚡ Bolt Optimization: Replace filter with traditional for loop to avoid closure allocation
        for (let i = 0; i < this.scheduledNotes.length; i++) {
            const note = this.scheduledNotes[i];
            if (!note.triggered && note.startTime >= currentTime && note.startTime < windowEnd) {
                result.push(note);
            }
        }

        return result;
    }

    /**
     * Get the next note that will be triggered.
     * 
     * @returns Next scheduled note or undefined
     */
    getNextNote(): ScheduledNote | undefined {
        return this.scheduledNotes.find(note => !note.triggered);
    }

    /**
     * Mark a note as triggered.
     * 
     * @param note Note to mark
     */
    markTriggered(note: ScheduledNote): void {
        note.triggered = true;
        this.lastTriggerTime = performance.now();
    }

    /**
     * Cancel a scheduled note by ID.
     * 
     * @param noteId Note ID to cancel
     * @returns True if note was found and cancelled
     */
    cancelNote(noteId: number): boolean {
        const initialLength = this.scheduledNotes.length;
        const result: ScheduledNote[] = [];

        // ⚡ Bolt Optimization: Replace filter with traditional for loop to avoid closure allocation
        for (let i = 0; i < this.scheduledNotes.length; i++) {
            const note = this.scheduledNotes[i];
            if (note.id !== noteId || note.triggered) {
                result.push(note);
            }
        }

        this.scheduledNotes = result;
        return this.scheduledNotes.length < initialLength;
    }

    /**
     * Record timing drift for correction analysis.
     * 
     * @param expectedTime Expected trigger time
     * @param actualTime Actual trigger time
     */
    recordDrift(expectedTime: number, actualTime: number): void {
        const drift = (actualTime - expectedTime) * 1000; // Convert to ms
        this.driftHistory.push(drift);
        
        // Keep only recent history
        if (this.driftHistory.length > this.maxDriftHistory) {
            this.driftHistory.shift();
        }
    }

    /**
     * Get average drift over recent history.
     * 
     * @returns Average drift in milliseconds
     */
    getAverageDrift(): number {
        if (this.driftHistory.length === 0) return 0;

        let sum = 0;

        // ⚡ Bolt Optimization: Replace reduce with traditional for loop to avoid closure allocation
        for (let i = 0; i < this.driftHistory.length; i++) {
            sum += this.driftHistory[i];
        }

        return sum / this.driftHistory.length;
    }

    /**
     * Clear old notes from the schedule.
     * 
     * @param beforeTime Remove notes before this time
     */
    clearOldNotes(beforeTime: number): void {
        const result: ScheduledNote[] = [];

        // ⚡ Bolt Optimization: Replace filter with traditional for loop to avoid closure allocation
        for (let i = 0; i < this.scheduledNotes.length; i++) {
            const note = this.scheduledNotes[i];
            if (note.startTime + note.duration >= beforeTime) {
                result.push(note);
            }
        }

        this.scheduledNotes = result;
    }

    /**
     * Clear all scheduled notes.
     */
    clearAll(): void {
        this.scheduledNotes = [];
    }

    /**
     * Get count of pending (non-triggered) notes.
     */
    getPendingCount(): number {
        let count = 0;

        // ⚡ Bolt Optimization: Replace filter with traditional for loop to avoid closure allocation
        for (let i = 0; i < this.scheduledNotes.length; i++) {
            if (!this.scheduledNotes[i].triggered) {
                count++;
            }
        }

        return count;
    }

    /**
     * Get the earliest scheduled start time.
     */
    getEarliestStartTime(): number | null {
        let earliest = Infinity;

        // ⚡ Bolt Optimization: Replace filter and map with a single loop to avoid closure and array allocations
        for (let i = 0; i < this.scheduledNotes.length; i++) {
            const note = this.scheduledNotes[i];
            if (!note.triggered && note.startTime < earliest) {
                earliest = note.startTime;
            }
        }

        return earliest === Infinity ? null : earliest;
    }
}

/**
 * LatencyCompensator class for managing audio timing.
 * 
 * Provides comprehensive latency management including:
 * - Rubber Band lookahead compensation
 * - MIDI sync with drift correction
 * - Visual metronome alignment reporting
 * - Scheduler integration for precise note timing
 */
export class LatencyCompensator {
    private config: LatencyCompensatorConfig;
    private scheduler: NoteScheduler;
    private processorLatency: number = 0;
    private schedulerInterval: number | null = null;
    private noteCallback: NoteTriggerCallback | null = null;
    private latencyCallback: LatencyUpdateCallback | null = null;
    private isRunning: boolean = false;
    private sharedMemory: LatencySharedMemory | null = null;
    private lastLatencyReport: LatencyReport | null = null;
    private driftCorrection: number = 0;
    private scheduleCheckCount: number = 0;

    constructor(config: Partial<LatencyCompensatorConfig> = {}) {
        if (!config.audioContext) {
            throw new Error('LatencyCompensator: audioContext is required');
        }
        
        this.config = { ...DEFAULT_LATENCY_CONFIG, ...config } as LatencyCompensatorConfig;
        this.scheduler = new NoteScheduler();
        
        // Initialize processor latency from config
        this.processorLatency = this.config.rubberBandLookahead / this.config.audioContext.sampleRate;
    }

    /**
     * Set the Rubber Band processor latency.
     * Call this after processor initialization or when options change.
     * 
     * @param latencySeconds Latency in seconds
     */
    setProcessorLatency(latencySeconds: number): void {
        this.processorLatency = Math.max(0, latencySeconds);
        this.notifyLatencyUpdate();
    }

    /**
     * Set latency based on Rubber Band options.
     * 
     * @param options Rubber Band options bitmask
     */
    setLatencyFromOptions(options: number): void {
        const latency = calculateRubberBandLatency(
            options,
            this.config.audioContext.sampleRate
        );
        this.setProcessorLatency(latency);
    }

    /**
     * Get current timing information.
     */
    getTimingInfo(): TimingInfo {
        const audioContext = this.config.audioContext;
        const currentTime = audioContext.currentTime;
        
        // getOutputTimestamp provides precise output timing when available
        // Fall back to currentTime and performance.now() when not supported
        let outputTime = currentTime;
        let perfTime = performance.now();
        
        if (typeof audioContext.getOutputTimestamp === 'function') {
            const timestamp = audioContext.getOutputTimestamp();
            if (timestamp) {
                outputTime = timestamp.contextTime ?? currentTime;
                perfTime = timestamp.performanceTime ?? performance.now();
            }
        }
        
        return {
            contextTime: currentTime,
            outputTime,
            performanceTime: perfTime,
            processorLatency: this.processorLatency,
            baseLatency: audioContext.baseLatency ?? 0,
            totalLatency: this.getTotalLatency(),
            sampleRate: audioContext.sampleRate
        };
    }

    /**
     * Calculate the actual playback time for scheduling.
     * Accounts for Rubber Band latency and drift correction.
     * 
     * @param targetTime Desired playback time
     * @returns Adjusted time for scheduling
     */
    compensateLatency(targetTime: number): number {
        // Schedule earlier to account for processing latency and drift
        return targetTime - this.processorLatency - this.driftCorrection;
    }

    /**
     * Calculate the display time for visual metronome alignment.
     * This is the time the user should see as "now" on the UI.
     * 
     * @returns Time to display for visual alignment
     */
    getDisplayTime(): number {
        const info = this.getTimingInfo();
        // Display time is current time minus total latency
        // so that visuals align with what is being heard
        return info.contextTime - info.totalLatency;
    }

    /**
     * Schedule a note with latency compensation.
     * 
     * @param note Note to schedule
     * @returns Note ID
     */
    scheduleNote(note: Omit<ScheduledNote, 'id' | 'triggered'>): number {
        // Adjust start time for latency
        const adjustedNote = {
            ...note,
            startTime: this.compensateLatency(note.startTime)
        };
        
        return this.scheduler.scheduleNote(adjustedNote);
    }

    /**
     * Schedule multiple notes with latency compensation.
     * 
     * @param notes Notes to schedule
     * @returns Array of note IDs
     */
    scheduleNotes(notes: Omit<ScheduledNote, 'id' | 'triggered'>[]): number[] {
        const adjustedNotes = new Array(notes.length);
        for (let i = 0; i < notes.length; i++) {
            const note = notes[i];
            adjustedNotes[i] = {
                ...note,
                startTime: this.compensateLatency(note.startTime)
            };
        }
        
        return this.scheduler.scheduleNotes(adjustedNotes);
    }

    /**
     * Cancel a scheduled note.
     * 
     * @param noteId Note ID to cancel
     * @returns True if cancelled successfully
     */
    cancelNote(noteId: number): boolean {
        return this.scheduler.cancelNote(noteId);
    }

    /**
     * Set the callback for note triggering.
     * 
     * @param callback Function to call when a note should be triggered
     */
    onNote(callback: NoteTriggerCallback): void {
        this.noteCallback = callback;
    }

    /**
     * Set the callback for latency updates.
     * 
     * @param callback Function to call when latency info updates
     */
    onLatencyUpdate(callback: LatencyUpdateCallback): void {
        this.latencyCallback = callback;
    }

    /**
     * Enable shared memory for AudioWorklet communication.
     * 
     * @param sharedMemory Pre-created shared memory or null to create new
     */
    enableSharedMemory(sharedMemory?: LatencySharedMemory): void {
        this.sharedMemory = sharedMemory ?? createLatencySharedMemory();
    }

    /**
     * Get shared memory for AudioWorklet communication.
     */
    getSharedMemory(): LatencySharedMemory | null {
        return this.sharedMemory;
    }

    /**
     * Update latency from shared memory (call in animation frame).
     */
    updateFromSharedMemory(): void {
        if (!this.sharedMemory) return;
        
        const data = readLatencyFromSharedMemory(this.sharedMemory);
        if (data) {
            this.processorLatency = data.processorLatency;
            
            // Check for drift if we have timing info
            if (this.config.enableDriftCorrection) {
                const expectedTime = data.contextTime;
                const actualTime = this.config.audioContext.currentTime;
                const drift = (actualTime - expectedTime) * 1000;
                
                if (Math.abs(drift) > this.config.maxDriftMs) {
                    // Apply gradual correction
                    this.driftCorrection += drift * 0.001 * 0.1; // 10% per update
                }
            }
            
            this.notifyLatencyUpdate();
        }
    }

    /**
     * Generate and send latency report.
     */
    private notifyLatencyUpdate(): void {
        const info = this.getTimingInfo();
        const drift = this.scheduler.getAverageDrift();
        
        this.lastLatencyReport = {
            totalLatencyMs: info.totalLatency * 1000,
            processorLatencyMs: info.processorLatency * 1000,
            outputLatencyMs: info.baseLatency * 1000,
            isSynchronized: Math.abs(drift) < this.config.maxDriftMs,
            driftMs: drift
        };
        
        this.latencyCallback?.(this.lastLatencyReport);
    }

    /**
     * Get the last latency report.
     */
    getLatencyReport(): LatencyReport | null {
        return this.lastLatencyReport;
    }

    /**
     * Start the scheduler loop.
     */
    start(): void {
        if (this.isRunning || this.schedulerInterval !== null) {
            return;
        }
        
        this.isRunning = true;
        this.scheduleCheckCount = 0;
        
        const checkSchedule = () => {
            if (!this.isRunning) return;
            
            const currentTime = this.config.audioContext.currentTime;
            const notes = this.scheduler.getNotesToTrigger(
                currentTime,
                this.config.lookahead
            );
            
            for (const note of notes) {
                this.scheduler.markTriggered(note);
                this.noteCallback?.(note);
                
                // Record timing accuracy
                this.scheduler.recordDrift(note.startTime, currentTime);
            }
            
            // Clean up old notes
            this.scheduler.clearOldNotes(currentTime - 1);
            
            // Periodic latency update (every 10 checks)
            this.scheduleCheckCount++;
            if (this.scheduleCheckCount % 10 === 0) {
                this.notifyLatencyUpdate();
            }
            
            // Update from shared memory if enabled
            if (this.sharedMemory) {
                this.updateFromSharedMemory();
            }
        };
        
        this.schedulerInterval = window.setInterval(
            checkSchedule,
            this.config.scheduleInterval
        ) as unknown as number;
    }

    /**
     * Stop the scheduler loop.
     */
    stop(): void {
        this.isRunning = false;
        
        if (this.schedulerInterval !== null) {
            clearInterval(this.schedulerInterval as unknown as number);
            this.schedulerInterval = null;
        }
    }

    /**
     * Check if the scheduler is running.
     */
    isActive(): boolean {
        return this.isRunning;
    }

    /**
     * Clear all scheduled notes.
     */
    clear(): void {
        this.scheduler.clearAll();
    }

    /**
     * Get the total system latency (processor + audio output).
     */
    getTotalLatency(): number {
        return this.processorLatency + (this.config.audioContext.baseLatency ?? 0);
    }

    /**
     * Get the current processor latency.
     */
    getProcessorLatency(): number {
        return this.processorLatency;
    }

    /**
     * Get pending note count.
     */
    getPendingNoteCount(): number {
        return this.scheduler.getPendingCount();
    }

    /**
     * Get the next scheduled note time.
     */
    getNextNoteTime(): number | null {
        return this.scheduler.getEarliestStartTime();
    }

    /**
     * Dispose of resources.
     */
    dispose(): void {
        this.stop();
        this.clear();
        this.noteCallback = null;
        this.latencyCallback = null;
        this.sharedMemory = null;
    }
}

/**
 * BPM-based timing calculator for MIDI synchronization.
 */
export class BpmTimingCalculator {
    private bpm: number = 120;
    private sampleRate: number = 44100;

    constructor(bpm: number = 120, sampleRate: number = 44100) {
        this.bpm = bpm;
        this.sampleRate = sampleRate;
    }

    /**
     * Set current BPM.
     */
    setBpm(bpm: number): void {
        this.bpm = Math.max(1, bpm);
    }

    /**
     * Get seconds per beat.
     */
    getSecondsPerBeat(): number {
        return 60 / this.bpm;
    }

    /**
     * Get seconds for a number of steps (assuming 4 steps per beat).
     */
    getSecondsForSteps(steps: number, stepsPerBeat: number = 4): number {
        return (steps / stepsPerBeat) * this.getSecondsPerBeat();
    }

    /**
     * Get sample position for a given time.
     */
    timeToSamples(timeSeconds: number): number {
        return Math.floor(timeSeconds * this.sampleRate);
    }

    /**
     * Get time for a given sample position.
     */
    samplesToTime(samples: number): number {
        return samples / this.sampleRate;
    }

    /**
     * Calculate MIDI clock timestamp for a note.
     * 
     * @param beatNumber Beat number (0-indexed)
     * @param stepNumber Step within beat (0 to stepsPerBeat-1)
     * @param stepsPerBeat Number of steps per beat (default: 4)
     * @returns Time in seconds
     */
    calculateNoteTime(
        beatNumber: number,
        stepNumber: number = 0,
        stepsPerBeat: number = 4
    ): number {
        const beatTime = beatNumber * this.getSecondsPerBeat();
        const stepTime = (stepNumber / stepsPerBeat) * this.getSecondsPerBeat();
        return beatTime + stepTime;
    }
}

/**
 * MIDI Clock generator for synchronization with external MIDI devices.
 */
export class MidiClockGenerator {
    private bpm: number = 120;
    private startTime: number = 0;
    private isRunning: boolean = false;
    private pulseCount: number = -1; // Start at -1 so first pulse at time 0 is sent
    private lastPulseTime: number = 0;
    private onPulseCallback: (() => void) | null = null;

    constructor(bpm: number = 120) {
        this.bpm = bpm;
    }

    /**
     * Start MIDI clock.
     * 
     * @param startTime AudioContext time to start at
     */
    start(startTime: number): void {
        this.startTime = startTime;
        this.isRunning = true;
        this.pulseCount = -1; // Reset so first pulse is sent immediately
        this.lastPulseTime = startTime;
    }

    /**
     * Stop MIDI clock.
     */
    stop(): void {
        this.isRunning = false;
    }

    /**
     * Set BPM.
     */
    setBpm(bpm: number): void {
        this.bpm = Math.max(1, bpm);
    }

    /**
     * Get current MIDI clock position in beats.
     */
    getPosition(currentTime: number): number {
        if (!this.isRunning) return 0;
        
        const elapsed = currentTime - this.startTime;
        const secondsPerBeat = 60 / this.bpm;
        return elapsed / secondsPerBeat;
    }

    /**
     * Get current MIDI clock tick (0-23 for 24 PPQN).
     */
    getTick(currentTime: number): number {
        const position = this.getPosition(currentTime);
        const totalPulses = Math.floor(position * MIDI_TIMING.PPQN);
        return Math.floor(totalPulses) % MIDI_TIMING.PPQN;
    }

    /**
     * Check if a MIDI clock pulse should be sent at the current time.
     * 
     * @param currentTime Current AudioContext time
     * @returns True if a pulse should be sent
     */
    shouldSendPulse(currentTime: number): boolean {
        if (!this.isRunning) return false;
        
        const position = this.getPosition(currentTime);
        const totalPulses = Math.floor(position * MIDI_TIMING.PPQN);
        
        // Send pulse if we've advanced to a new pulse count
        if (totalPulses > this.pulseCount) {
            this.pulseCount = totalPulses;
            this.lastPulseTime = currentTime;
            return true;
        }
        
        return false;
    }

    /**
     * Get the time of the last pulse.
     */
    getLastPulseTime(): number {
        return this.lastPulseTime;
    }

    /**
     * Set callback for MIDI clock pulses.
     */
    onPulse(callback: () => void): void {
        this.onPulseCallback = callback;
    }

    /**
     * Process timing and send pulses if needed.
     */
    process(currentTime: number): void {
        if (this.shouldSendPulse(currentTime)) {
            this.onPulseCallback?.();
        }
    }
}

// Export default for convenient importing
export default LatencyCompensator;
