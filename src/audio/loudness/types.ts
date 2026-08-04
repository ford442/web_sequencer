/**
 * Shared types for the master-bus loudness suite (BS.1770-5 metering + true-peak limiter).
 *
 * Everything here is plain data: the same structures cross the AudioWorklet MessagePort,
 * are persisted to localStorage, and are returned by the offline export analysis.
 */

/**
 * Registered name of the master loudness AudioWorklet processor.
 *
 * Lives here rather than in the processor module so main-thread code can
 * construct the node without importing the worklet source — importing it would
 * pull `registerProcessor` into the main bundle and throw outside an
 * AudioWorkletGlobalScope.
 */
export const MASTER_LOUDNESS_PROCESSOR_NAME = 'master-loudness-processor';

/** Scalar meter snapshot emitted by the master worklet (≤ 30 Hz). */
export interface LoudnessStats {
    /** Momentary loudness (400 ms window), LUFS. `-Infinity` when silent. */
    momentary: number;
    /** Short-term loudness (3 s window), LUFS. */
    shortTerm: number;
    /** Gated integrated loudness since the last reset, LUFS. */
    integrated: number;
    /** Held true peak (inter-sample, oversampled), dBTP. */
    truePeak: number;
    /** Sample peak (no oversampling), dBFS. */
    samplePeak: number;
    /** Current limiter gain reduction, dB (≤ 0). */
    gainReduction: number;
    /** True when the limiter clamped at least one sample since the previous message. */
    clipped: boolean;
}

/** Limiter configuration — primitives only, safe to persist. */
export interface LimiterSettings {
    /** Limiter active (false = pure metering pass-through). */
    enabled: boolean;
    /** Output ceiling in dBTP. Default -1.0. */
    ceilingDbtp: number;
    /** Attack time in milliseconds (gain reduction onset smoothing). */
    attackMs: number;
    /** Release time in milliseconds. */
    releaseMs: number;
    /** Lookahead in milliseconds — also the added monitor latency. */
    lookaheadMs: number;
    /**
     * Monitor-only mode: zero lookahead, hard-clip at the ceiling.
     * Trades transparency for latency during live performance.
     */
    monitorOnly: boolean;
}

export const DEFAULT_LIMITER_SETTINGS: LimiterSettings = {
    enabled: true,
    ceilingDbtp: -1.0,
    attackMs: 1.0,
    releaseMs: 60,
    lookaheadMs: 1.5,
    monitorOnly: false,
};

/** Loudness targets offered by the export path. */
export const LOUDNESS_TARGETS = {
    streaming: -14,
    club: -9,
    broadcast: -23,
} as const;

export type LoudnessTargetKey = keyof typeof LOUDNESS_TARGETS;

/** Messages sent from the main thread to the master loudness worklet. */
export type MasterLoudnessCommand =
    | { type: 'set-limiter'; data: Partial<LimiterSettings> }
    | { type: 'reset-loudness' }
    | { type: 'set-report-hz'; data: number };

/** Message sent from the worklet to the main thread. */
export interface MasterLoudnessReport {
    type: 'loudness-stats';
    data: LoudnessStats;
    /** Current lookahead latency in seconds, for monitor-latency accounting. */
    latencySeconds: number;
}

/** Silence sentinel — BS.1770 loudness of a zero-power signal. */
export const SILENCE_LUFS = -Infinity;
