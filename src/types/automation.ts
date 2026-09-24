export interface AutomationPoint {
  step: number;
  value: number;
  customWindowShape?: number[];
  volumeFilterMod?: number;
}

export interface KnobAutomation {
  paramId: string;
  trackKey: string;
  points: AutomationPoint[];
  isRecording: boolean;
}

// ============================================================================
// AUTOMATION LANE SYSTEM (Issue #652)
// ============================================================================

/** Automation target — which track/instrument the lane controls */
export type AutomationTarget =
  | 'synthA' | 'synthB' | 'bass2'
  | 'kick' | 'snare' | 'closedHat' | 'openHat'
  | 'sampler' | 'master'
  | 'sampler0' | 'sampler1' | 'sampler2' | 'sampler3'
  | 'sampler4' | 'sampler5' | 'sampler6' | 'sampler7'
  | 'wam';

/** Where the automation data originated */
export type AutomationSource = 'rbs' | 'recorded' | 'ai' | 'manual';

/** Interpolation mode between automation points */
export type AutomationInterpolation = 'step' | 'linear' | 'smooth';

/** Scope of the automation lane */
export type AutomationScope = 'pattern' | 'song';

/**
 * A single point in an automation lane.
 * Uses normalized 0–1 values for portability across parameter ranges.
 *
 * INVARIANT: `value` is ALWAYS normalized to [0, 1], for every lane source
 * (`rbs`, `recorded`, `ai`, `manual`) and every target.  Producers normalize
 * before creating the point; consumers scale into engine units themselves
 * (e.g. AutomationScheduler maps 0–1 → Hz for the PCF cutoff).
 * See {@link UnifiedAutomationLane.originalRange}.
 */
export interface AutomationLanePoint {
  /**
   * Step position (0-based, relative to pattern or song position).
   * Supports sub-step (fractional) values for 24-PPQ TRAK event resolution.
   * E.g. step 2.5 = halfway between step 2 and step 3.
   */
  step: number;
  /** Normalized value 0–1 */
  value: number;
  /** Optional: interpolation override for this segment */
  interpolation?: AutomationInterpolation;
  /**
   * Per-step accent flag (TB-303 style).
   * When true, the step should be played with accent emphasis.
   */
  accent?: boolean;
  /**
   * Per-step slide flag (TB-303 style).
   * When true, the note slides (portamento) from the previous step.
   */
  slide?: boolean;
}

/**
 * Unified automation lane — the core data model for all automation sources.
 * Handles imported .rbs lanes, live-recorded knob movements, and AI-generated automation.
 */
export interface UnifiedAutomationLane {
  /** Unique lane identifier */
  id: string;
  /** Target track */
  target: AutomationTarget;
  /** Parameter path (e.g. 'cutoff', 'resonance', 'envMod', 'decay', 'accent') */
  parameter: string;
  /** Human-readable display name */
  name: string;
  /** Automation data points (sorted by step) */
  points: AutomationLanePoint[];
  /** Default interpolation mode for the lane */
  interpolation: AutomationInterpolation;
  /** Where this lane came from */
  source: AutomationSource;
  /** Whether this lane applies per-pattern or song-wide */
  scope: AutomationScope;
  /** Pattern index this lane belongs to (when scope='pattern') */
  patternIndex?: number;
  /** Whether the lane is enabled for playback */
  enabled: boolean;
  /**
   * The parameter's real-world range in its source units (e.g. `[0, 127]` for
   * an RBS knob, `[80, 12000]` for a WAM cutoff in Hz), defaults to `[0, 1]`.
   *
   * DISPLAY METADATA ONLY.  It exists so UI can label a normalized point with
   * the value a user would recognise.  It MUST NEVER be used in scheduling
   * arithmetic: {@link AutomationLanePoint.value} is already normalized, so
   * denormalizing with this range at schedule time pins the applied parameter
   * at its maximum.  See `AutomationScheduler.scheduleFromLanes`.
   */
  originalRange?: [number, number];
  /**
   * Sampler bank index (0–7) for per-bank targeting.
   * Only applicable when target is 'sampler' (legacy) or 'sampler0'–'sampler7'.
   * When target is 'samplerN', this is redundant but kept for clarity.
   */
  samplerBank?: number;
}

/**
 * Record-arm state for a single parameter.
 * When armed, knob movements are captured into a recording buffer.
 */
export interface AutomationRecordArm {
  /** Target track */
  target: AutomationTarget;
  /** Parameter being armed */
  parameter: string;
  /** Whether currently armed for recording */
  armed: boolean;
}

/**
 * Active recording buffer — captures knob movements in real time.
 */
export interface AutomationRecordingBuffer {
  /** Target track */
  target: AutomationTarget;
  /** Parameter being recorded */
  parameter: string;
  /** Captured points during recording (may have sub-step resolution) */
  points: AutomationLanePoint[];
  /** Recording start time (performance.now()) */
  startTime: number;
  /** Whether recording is in progress */
  isRecording: boolean;
}

/**
 * Full automation state for the application.
 */
export interface AutomationState {
  /** All automation lanes (imported + recorded) */
  lanes: UnifiedAutomationLane[];
  /** Record-arm flags per parameter */
  recordArms: AutomationRecordArm[];
  /** Active recording buffers (one per armed parameter during record) */
  recordingBuffers: AutomationRecordingBuffer[];
  /** Current playback step position (for scheduler) */
  playbackStep: number;
  /** Whether global automation playback is enabled */
  playbackEnabled: boolean;
  /**
   * Live normalized (0–1) values currently being driven by automation lanes.
   * Key format: "target:parameter" (e.g. "synthA:filterCutoff").
   * Updated once per step tick; used by UI controls to show animated values.
   */
  liveAutomatedValues: Record<string, number>;
  /** Highlight automated knobs on hardware panels; dim non-automated params. */
  showHardwareAutomation: boolean;
}

// ============================================================================
// TRAK AUTOMATION EVENT TYPES (ReBirth TRKL/TRAK catalog, ~24 PPQ)
// ============================================================================

/**
 * A single event from a TRAK event list as defined in the RBS42.txt spec.
 * Stored in delta-tick form (ticks since the previous event).
 * At 24 PPQ, one bar = 96 ticks; one 16th-note step = 6 ticks.
 */
export interface TrakEvent {
  /** Ticks since the previous event (delta-time, ~24 PPQ). */
  deltaTick: number;
  /** Parameter / control ID (matches AUTOMATION_PARAMETER_MAP keys). */
  ctrlId: number;
  /** Raw parameter value as stored in the TRAK chunk. */
  value: number;
}

/**
 * A TRAK event with an absolute tick position already resolved from delta-times.
 * Used internally by AutomationScheduler after pre-processing a raw event list.
 */
export interface ResolvedTrakEvent {
  /** Absolute tick position from the beginning of the arrangement. */
  tick: number;
  /** TRAK track index (0=mixer, 1=TB-303 #1, …). */
  trackIndex: number;
  /** Per-track parameter / control ID. */
  ctrlId: number;
  /** Raw parameter value. */
  value: number;
  /** Pre-resolved event kind (optional — scheduler re-resolves if absent). */
  eventKind?: import('../importers/rbs/trakControllers').TrakEventKind;
}

/**
 * Configuration for the AutomationScheduler lookahead window.
 */
export interface AutomationSchedulerConfig {
  /**
   * How many seconds ahead to schedule automation events.
   * Larger values reduce jitter at the cost of responsiveness to live edits.
   * @default 0.1
   */
  lookaheadSeconds?: number;
  /**
   * Ramp duration for continuous parameter changes (seconds).
   * Set to 0 for instant (stepped) changes.
   * @default 0.05
   */
  rampDuration?: number;
  /**
   * Pulses per quarter-note used for TRAK tick → seconds conversion.
   * ReBirth uses 24 PPQ (96 ticks per bar at 4/4).
   * @default 24
   */
  ppq?: number;
}
