/** MIDI clock sync modes for Hyphon transport. */

// Clock constants live in src/shared/rt/clock.ts so the clock worklet can use
// them too; re-exported here for the main-thread callers.
export {
  AUDIO_SCHEDULE_LOOKAHEAD_MS,
  BPM_MAX,
  BPM_MIN,
  HOLDOVER_BEAT_PERIODS,
  HOLDOVER_STOP_BEATS,
  MIDI_PPQN,
  MIDI_TICKS_PER_STEP,
  STEP_LOOKAHEAD_MS,
} from '../../shared/rt/clock';

export type TransportSyncMode = 'internal' | 'master' | 'slave';

export type TransportSyncState =
  | 'stopped'
  | 'synced'
  | 'holdover'
  | 'degraded'
  | 'armed';

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
