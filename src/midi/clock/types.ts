/** MIDI clock sync modes for Hyphon transport. */

export type TransportSyncMode = 'internal' | 'master' | 'slave';

export type TransportSyncState =
  | 'stopped'
  | 'synced'
  | 'holdover'
  | 'degraded'
  | 'armed';

export const MIDI_PPQN = 24;
/**
 * Hyphon sequencer steps are always 16th notes → 6 MIDI clock ticks per step,
 * for every time signature (the meter changes steps-per-bar, not step size).
 * A pattern spans `stepCount * 6` ticks: 16 steps = 96, 32 steps = 192.
 */
export const MIDI_TICKS_PER_STEP = 6;

export interface TransportSyncTelemetry {
  mode: TransportSyncMode;
  state: TransportSyncState;
  deviceName: string | null;
  measuredBpm: number | null;
  phaseErrorMs: number;
  jitterMs: number;
  droppedClocks: number;
  isPlaying: boolean;
}

/**
 * `step` wraps at the pattern length; `absStep` counts every step since the
 * transport started (never wraps) — per-track loops and swing parity use it.
 */
export type StepCallback = (step: number, audioTime: number, absStep: number) => void;

export interface TransportClock {
  start(): void;
  stop(): void;
  setTempo(bpm: number): void;
  setSwing(swing: number): void;
  setSteps(steps: number): void;
  resync(): void;
  onStep(cb: StepCallback): () => void;
  getTelemetry(): TransportSyncTelemetry;
  dispose(): void;
}

export interface TransportClockOptions {
  context: AudioContext;
  tempo: number;
  swing: number;
  steps: number;
  mode: TransportSyncMode;
  inputDeviceId?: string | null;
  outputDeviceId?: string | null;
}

export const BPM_MIN = 30;
export const BPM_MAX = 300;

/** Small lookahead so Web Audio events stay in the future (ms). */
export const AUDIO_SCHEDULE_LOOKAHEAD_MS = 8;

/**
 * How early the internal clock posts a step (ms) — #1344 P5. The step keeps
 * its exact audioTime; posting it early lets the main thread schedule the
 * step's notes before their frame is rendered, so the voice worklets apply
 * them on that sample rather than at the next block after the message round
 * trip. It must cover main-thread latency (React work, GC); a step that still
 * arrives late plays at the start of the next block, as before. Everything
 * decided per step happens this much early: the playhead is deferred back to
 * the step's time (scheduleAtAudioTime), a step edited inside the window plays
 * from its next pass.
 */
export const STEP_LOOKAHEAD_MS = 40;

/** Holdover after clock loss: multiples of estimated beat period. */
export const HOLDOVER_BEAT_PERIODS = 2;
/** After holdover, stop if still no clock for this many beats. */
export const HOLDOVER_STOP_BEATS = 4;
