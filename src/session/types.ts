import type { TrackKey } from '@/constants/appDefaults';
import { TRACK_KEYS } from '@/constants';

/** Nested session document version (independent of SavedSongData.version). */
export const SESSION_DOCUMENT_VERSION = 1;

/** SavedSongData version that first includes a session document. */
export const SAVED_SONG_DATA_VERSION_WITH_SESSION = 3;

export const SESSION_TRACKS: readonly TrackKey[] = TRACK_KEYS;

/** Default live-set rows (legacy 8-slot songs map 1:1). */
export const SESSION_DEFAULT_ROWS = 8;

/** 16th-note step clock: 4 steps/beat, 16 steps/bar, 32-step pattern = 2 bars. */
export const SESSION_STEPS_PER_BEAT = 4;
export const SESSION_STEPS_PER_BAR = 16;

export type ClipId = string;
export type SceneId = string;

export type ClipLaunchMode = 'trigger' | 'gate' | 'toggle' | 'one-shot';

export type FollowActionKind = 'none' | 'next' | 'previous' | 'random' | 'stop' | 'repeat';

export type LaunchQuantization = 'immediate' | 'step' | 'beat' | 'bar' | '2bars' | '4bars';

export const LAUNCH_QUANTIZATIONS: readonly LaunchQuantization[] = [
  'immediate',
  'step',
  'beat',
  'bar',
  '2bars',
  '4bars',
] as const;

export type LaunchSource =
  | 'manual'
  | 'scene'
  | 'follow'
  | 'song-mode'
  | 'midi'
  | 'gamepad'
  | 'capture-replay';

export type LaunchKind = 'clip' | 'scene' | 'stop-track' | 'stop-all';

export interface SessionClip {
  id: ClipId;
  name: string;
  /** Pattern slot in trackStorage this clip references (content lives there). */
  slotIndex: number;
  launchMode: ClipLaunchMode;
  followAction: FollowActionKind;
  /** Loops before follow-action `repeat` stops (ignored for other follow kinds). */
  followRepeatN: number;
  empty: boolean;
}

export interface SessionTrackColumn {
  track: TrackKey;
  clips: SessionClip[];
}

export interface SessionScene {
  id: SceneId;
  name: string;
  /** Clip id per track; omitted/null = leave that track unchanged on scene launch. */
  clipIds: Partial<Record<TrackKey, ClipId | null>>;
}

export interface SessionDocument {
  schemaVersion: typeof SESSION_DOCUMENT_VERSION;
  quantization: LaunchQuantization;
  columns: Record<TrackKey, SessionTrackColumn>;
  scenes: SessionScene[];
}

export interface TransportClockSnapshot {
  /** Last (or current) fired sequencer step, 0 … patternSteps-1. */
  step: number;
  /** AudioTime of that step (sample-accurate worklet timestamp). */
  audioTime: number;
  tempo: number;
  patternSteps: number;
  stepsPerBeat: number;
  stepsPerBar: number;
  isPlaying: boolean;
  songModeActive: boolean;
}

export interface LaunchIntent {
  kind: LaunchKind;
  source: LaunchSource;
  /** Monotonic id — later intents win on the same quantized boundary. */
  requestSeq: number;
  requestAudioTime: number;
  requestStep: number;
  track?: TrackKey;
  clipId?: ClipId;
  sceneId?: SceneId;
  /** Gate mode: false on note/button release. */
  gateDown?: boolean;
}

export type CompiledLaunchAction = 'start' | 'stop' | 'replace';

export interface CompiledLaunchEvent {
  audioTime: number;
  step: number;
  /** Absolute step index from an origin (for capture / property tests). */
  timelineStep: number;
  track: TrackKey;
  action: CompiledLaunchAction;
  clipId: ClipId | null;
  slotIndex: number | null;
  sceneId?: SceneId;
  source: LaunchSource;
  requestSeq: number;
}

export interface PlayingClipState {
  clipId: ClipId;
  slotIndex: number;
  launchMode: ClipLaunchMode;
  loopsCompleted: number;
  followRepeatRemaining: number;
  startedTimelineStep: number;
}

export interface QueuedLaunch {
  event: CompiledLaunchEvent;
}

export interface SessionRuntimeSnapshot {
  playing: Record<TrackKey, PlayingClipState | null>;
  queued: CompiledLaunchEvent[];
  capturing: boolean;
  captureEvents: SessionCaptureEvent[];
}

export interface SessionCaptureEvent {
  audioTime: number;
  step: number;
  timelineStep: number;
  track: TrackKey;
  action: CompiledLaunchAction;
  clipId: ClipId | null;
  slotIndex: number | null;
  sceneId?: SceneId;
}

export interface SessionTickResult {
  applied: CompiledLaunchEvent[];
  flushTracks: TrackKey[];
  playing: Record<TrackKey, PlayingClipState | null>;
  queued: CompiledLaunchEvent[];
  /** Live session launch should deactivate Song Mode at this boundary. */
  preemptSongMode: boolean;
  /** Song Mode start should stop session clips. */
  preemptSession: boolean;
}

export interface SessionFocus {
  track: TrackKey;
  row: number;
  sceneIndex: number;
}

export const SESSION_TRACK_LABELS: Record<TrackKey, string> = {
  partA: 'SYNTH A',
  partB: 'SYNTH B',
  bass2: 'BASS 2',
  kick: 'KICK',
  snare: 'SNARE',
  closedHat: 'CH',
  openHat: 'OH',
  sampler: 'SMP',
};
