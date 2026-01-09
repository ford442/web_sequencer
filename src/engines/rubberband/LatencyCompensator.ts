/**
 * LatencyCompensator - MIDI sync and latency management for precise timing
 * 
 * Part of RUBBERBAND_ENHANCEMENT_PLAN Section 9: Latency & Synchronization
 * 
 * Ensures precise MIDI synchronization by:
 * - Compensating for Rubber Band's lookahead latency
 * - Scheduling notes ahead of time
 * - Using AudioContext timestamps for accurate timing
 * 
 * STUB FILE - Implementation pending.
 * 
 * @see RUBBERBAND_ENHANCEMENT_PLAN.md Section 9
 */

/** Scheduled note information */
export interface ScheduledNote {
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
}

/** Configuration for latency compensator */
export interface LatencyCompensatorConfig {
    /** AudioContext reference */
    audioContext: AudioContext;
    /** Lookahead time for scheduling (in seconds) */
    lookahead: number;
    /** How often to check schedule (in ms) */
    scheduleInterval: number;
}

/** Default latency compensator configuration */
export const DEFAULT_LATENCY_CONFIG: LatencyCompensatorConfig = {
    audioContext: null as unknown as AudioContext, // Must be provided
    lookahead: 0.1, // 100ms lookahead
    scheduleInterval: 25 // 25ms check interval
};

/**
 * NoteScheduler class for precise MIDI timing with latency compensation.
 * 
 * STUB - Partial implementation for reference.
 */
export class NoteScheduler {
    private scheduledNotes: ScheduledNote[] = [];
    private nextNoteId: number = 0;
    
    /**
     * Add a note to the schedule.
     * 
     * @param note Note information
     * @returns Note ID for tracking
     */
    scheduleNote(note: Omit<ScheduledNote, 'triggered'>): number {
        const id = this.nextNoteId++;
        this.scheduledNotes.push({
            ...note,
            triggered: false
        });
        return id;
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
        
        return this.scheduledNotes.filter(note => 
            !note.triggered && 
            note.startTime >= currentTime && 
            note.startTime < windowEnd
        );
    }
    
    /**
     * Mark a note as triggered.
     * 
     * @param note Note to mark
     */
    markTriggered(note: ScheduledNote): void {
        note.triggered = true;
    }
    
    /**
     * Clear old notes from the schedule.
     * 
     * @param beforeTime Remove notes before this time
     */
    clearOldNotes(beforeTime: number): void {
        this.scheduledNotes = this.scheduledNotes.filter(
            note => note.startTime + note.duration >= beforeTime
        );
    }
    
    /**
     * Clear all scheduled notes.
     */
    clearAll(): void {
        this.scheduledNotes = [];
    }
}

/**
 * LatencyCompensator class for managing audio timing.
 * 
 * STUB - Full implementation requires:
 * 1. Integration with Rubber Band's getLatency()
 * 2. AudioWorklet timestamp coordination
 * 3. MIDI input handling
 */
export class LatencyCompensator {
    private config: LatencyCompensatorConfig;
    private scheduler: NoteScheduler;
    private processorLatency: number = 0;
    private schedulerInterval: number | null = null;
    private noteCallback: ((note: ScheduledNote) => void) | null = null;
    
    constructor(config: LatencyCompensatorConfig) {
        this.config = config;
        this.scheduler = new NoteScheduler();
    }
    
    /**
     * Set the Rubber Band processor latency.
     * Call this after processor initialization.
     * 
     * @param latencySeconds Latency in seconds
     */
    setProcessorLatency(latencySeconds: number): void {
        this.processorLatency = latencySeconds;
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
            processorLatency: this.processorLatency
        };
    }
    
    /**
     * Calculate the actual playback time for scheduling.
     * Accounts for Rubber Band latency.
     * 
     * @param targetTime Desired playback time
     * @returns Adjusted time for scheduling
     */
    compensateLatency(targetTime: number): number {
        // Schedule earlier to account for processing latency
        return targetTime - this.processorLatency;
    }
    
    /**
     * Schedule a note with latency compensation.
     * 
     * @param note Note to schedule
     */
    scheduleNote(note: Omit<ScheduledNote, 'triggered'>): void {
        // Adjust start time for latency
        const adjustedNote = {
            ...note,
            startTime: this.compensateLatency(note.startTime)
        };
        
        this.scheduler.scheduleNote(adjustedNote);
    }
    
    /**
     * Set the callback for note triggering.
     * 
     * @param callback Function to call when a note should be triggered
     */
    onNote(callback: (note: ScheduledNote) => void): void {
        this.noteCallback = callback;
    }
    
    /**
     * Start the scheduler loop.
     */
    start(): void {
        if (this.schedulerInterval !== null) {
            return;
        }
        
        const checkSchedule = () => {
            const currentTime = this.config.audioContext.currentTime;
            const notes = this.scheduler.getNotesToTrigger(
                currentTime,
                this.config.lookahead
            );
            
            for (const note of notes) {
                this.scheduler.markTriggered(note);
                this.noteCallback?.(note);
            }
            
            // Clean up old notes
            this.scheduler.clearOldNotes(currentTime - 1);
        };
        
        this.schedulerInterval = window.setInterval(
            checkSchedule,
            this.config.scheduleInterval
        );
    }
    
    /**
     * Stop the scheduler loop.
     */
    stop(): void {
        if (this.schedulerInterval !== null) {
            clearInterval(this.schedulerInterval);
            this.schedulerInterval = null;
        }
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
}

/**
 * TODO: Future implementation notes
 * 
 * 1. Add Web MIDI API integration for MIDI input
 * 2. Implement tempo-synced scheduling with BPM tracking
 * 3. Add quantization options for rhythm correction
 * 4. Create visual latency calibration tool
 * 5. Implement dynamic latency adjustment based on buffer size
 * 6. Add support for AudioWorklet-side scheduling for lowest latency
 */
