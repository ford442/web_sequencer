/** MIDI clock sync modes for Hyphon transport. */

export type TransportSyncMode = 'internal' | 'master' | 'slave';

export type TransportSyncState =
  | 'stopped'
  | 'synced'
  | 'holdover'
  | 'degraded'
  | 'armed';

export const MIDI_PPQN = 24;
/** Hyphon sequencer steps are 16th notes → 6 MIDI clock ticks per step. */
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

export type StepCallback = (step: number, audioTime: number) => void;

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

/** Holdover after clock loss: multiples of estimated beat period. */
export const HOLDOVER_BEAT_PERIODS = 2;
/** After holdover, stop if still no clock for this many beats. */
export const HOLDOVER_STOP_BEATS = 4;
