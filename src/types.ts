import type { AlignmentResult } from './engines/rubberband/PhonemeAligner';
import type { SingingVoice } from './engines/SingingVoice';
import type { WebGpuOscillator } from './engines/WebGpuOscillator';
import type { WasmOscillator } from './engines/WasmOscillator';
import type { Open303Manager } from './engines/Open303Manager';
import type { Open303Oscillator } from './engines/Open303Oscillator';
import type { ScaleDefinition } from './utils/musicTheory';
import type { MultisampleBank } from './engines/MultisampleGenerator';
export type { MultisampleBank } from './engines/MultisampleGenerator';

export type Waveform =
  | 'sawtooth' | 'square' | 'triangle' | 'sine'
  | 'pyodide-saw' | 'pyodide-square' | 'pyodide-sine'
  | 'wgsl-saw' | 'wgsl-sqr' | 'wgsl-tri' | 'wgsl-sin'
  | 'wam-saw' | 'wam-sqr' | 'wam-tri' | 'wam-sin'
  | 'wav-saw' | 'wav-sqr'
  | 'rust-saw' | 'rust-sqr'
  | '303-saw' | '303-sqr'
  | 'prophecy-saw' | 'prophecy-sqr' | 'prophecy-tri' | 'prophecy-pulse';

export interface SynthParams {
  waveform: Waveform;
  pitch: number; // Semitones adjustment
  filterCutoff: number; // Hz
  filterResonance: number; // Q factor
  filterMode?: number; // 0-1 (filter mode toggle)
  attack: number;
  decay: number;
  sustain: number; // 0-1 (level)
  release: number; // seconds
  length: number; // seconds (gate time)
  volume: number; // 0-1
  pan?: number; // Stereo pan (-1 to 1)
  delayTime: number; // seconds
  delayFeedback: number; // 0-1
  delayMix: number; // 0-1 (wet/dry)
  /** Which DSP engine to use when waveform is '303-saw' or '303-sqr'. Defaults to 'open303'. */
  engine303?: Engine303;
  /** Prophecy: Vowel formant preset 0–4 (A=0, E=1, I=2, O=3, U=4) */
  vowel?: number;
  /** Prophecy: Portamento rate 0–1 (0=instantaneous, 1=max glide) */
  portamento?: number;
  /** Prophecy: Formant frequency shift 0–1 */
  formantShift?: number;
}

export type DrumSound = 'kick' | 'snare' | 'closedHat' | 'openHat';

/** Drum kit type selection for authentic 808/909 sound character */
export type DrumKitType = '808' | '909';

export interface KickParams {
  pitch: number;
  decay: number;
  tone: number;
  volume: number;
  pan?: number;
}

export interface SnareParams {
  decay: number;
  tone: number;
  noise: number;
  volume: number;
  pan?: number;
}

export interface HatParams {
  pitch: number;
  decay: number;
  volume: number;
  pan?: number;
}

export interface SamplerBankParams {
  sampleName: string;
  playbackSpeed: number;
  volume: number;
  filterCutoff: number;
  filterResonance: number;
  drive: number;
  delaySend: number;
  mode?: 'loop' | 'stretch' | 'wavetable';
  grainSize?: number;
  timeRatio?: number;
  pitchScale?: number;
  formantShift?: number;
  vibratoDepth?: number;
  tremoloDepth?: number;
  tremoloRate?: number;
  breathIntensity?: number;
  sliceMode?: 'off' | 'phoneme';
  choir?: number;
  glitchChance?: number;
  freeze?: number;
  portamentoType?: 'linear' | 'exponential';
  freezeLfoRate?: number;
  freezeLfoSync?: boolean;
  freezeLfoDepth?: number;
  freezeEnvDepth?: number;
  grainEnvDepth?: number;
  grainPitchQuantize?: number;
  formantLfoSync?: boolean;
  formantLfoRate?: number;
  formantLfoDepth?: number;
  reverbLfoRate?: number;
  reverbLfoDepth?: number;
  delayLfoRate?: number;
  delayLfoDepth?: number;
  formantLfoShape?: number[];
  formantEnvAttack?: number;
  formantEnvDecay?: number;
  formantEnvAmount?: number;
  customLfoShape?: number[];
  characterMorph?: number;
  morphTarget?: 'default' | 'male' | 'female' | 'child' | 'deep' | 'bright';
  attack?: number;
  decay?: number;
  sustain?: number;
  release?: number;
  pan?: number;
  isHarmonyVoice?: boolean;
  harmonyIndex?: number;

  // Pitch / Voice Controls
  rootNote?: number;
  coarseTune?: number;
  fineTune?: number;
  quality?: 'preview' | 'good' | 'better' | 'best';
  stretchMode?: 'Time' | 'Pitch' | 'Formant';
  lockToSequencer?: boolean;
  pitchAttack?: number;
  gateRate?: number;
  gateDepth?: number;
  spectralPanRate?: number;
  spectralPanDepth?: number;
  pitchDecay?: number;
  expressiveness?: {
    vibratoRate: number;
    vibratoDepth: number;
    tremoloDepth: number;
    breathAmount: number;
  };
}

export type SamplerParams = SamplerBankParams[];

/** TB-303 DSP engine selection.
 *  - 'open303': custom synthesizer (open303_wrapper.cpp, open303_* API)
 *  - 'jc303':   authentic rosic::Open303 (jc303_wrapper.cpp, jc303_* API)
 */
export type Engine303 = 'open303' | 'jc303';

export interface Bass2Params {
  waveform: '303-saw' | '303-sqr';
  cutoff: number;
  resonance: number;
  filterMode: number;
  decay: number;
  accent: number;
  envMod: number;
  volume: number;
  pitch: number;
  pan?: number;
  /** Which DSP engine to use for this voice. Defaults to 'open303'. */
  engine303?: Engine303;
}

export interface AllDrumParams {
  kick: KickParams;
  snare: SnareParams;
  closedHat: HatParams;
  openHat: HatParams;
}

export type TrackKey = 'partA' | 'partB' | 'bass2' | 'kick' | 'snare' | 'closedHat' | 'openHat' | 'sampler';

export interface AmbianceTrack {
  name: string;
  url: string;
}

export type ReverbType = 'room' | 'plate' | 'hall';

export interface PhonemeData {
  id: string;
  symbol: string;
  start: number;
  end: number;
  pitchBend: number;
  volume?: number;
}

export interface Note {
  note: string;
  pan?: number;
  velocity: number;
  length?: number;
  slide?: boolean;
  slideFormant?: boolean;
  chord?: string[];
  timbre?: number;
  probability?: number;
  microtiming?: number;
  retrigger?: number;
  reverse?: boolean;
  sliceIndex?: number;
  freeze?: number;
  formantShift?: number;
  vibratoDepth?: number;
  reverbSend?: number;
  reverbType?: ReverbType;
  reverbLfoRate?: number;
  reverbLfoDepth?: number;
  delayLfoRate?: number;
  delayLfoDepth?: number;
  delaySend?: number;
  choir?: number;
  drive?: number;
  tranceGate?: number;
  gateRate?: number;
  gateDepth?: number;
  spectralPanRate?: number;
  spectralPanDepth?: number;
  phonemes?: PhonemeData[];
  /** Prophecy: Vowel formant preset 0–4 (A=0, E=1, I=2, O=3, U=4) */
  vowel?: number;
  /** Prophecy: Portamento rate 0–1 */
  portamento?: number;
  // ... other fields as needed
}

export interface PartSequence {
  steps: (Note | null)[];
  automation?: { [param: string]: (number | null)[] };
}

export interface Pattern {
  partA: PartSequence;
  partB: PartSequence;
  bass2: PartSequence;
  kick: PartSequence;
  snare: PartSequence;
  closedHat: PartSequence;
  openHat: PartSequence;
  sampler: PartSequence[]; // Array of banks
}

export interface AudioEngine {
  context: AudioContext;
  webGpuEngine?: WebGpuOscillator | null;
  wasmEngine?: WasmOscillator | null;
  open303Engine?: Open303Oscillator | Open303Manager | null;
  singingVoice?: SingingVoice;

  // === Playback Methods (with microtonal support) ===
  playSynth: (
    params: SynthParams,
    note: string | string[],
    time: number,
    durationSteps?: number,
    stepTime?: number,
    slideFromFreq?: number,
    track?: 'partA' | 'partB' | 'bass2',
    tuning?: ScaleDefinition | null,
    noteParams?: any
  ) => void;

  playDrum: (
    sound: DrumSound,
    params: KickParams | SnareParams | HatParams,
    time: number,
    tuning?: ScaleDefinition | null,
    stepTime?: number,
    note?: string | { note: string, pan?: number }
  ) => void;

  playSampler: (
    params: SamplerBankParams,
    note: string | string[],
    time: number,
    durationSteps?: number,
    stepTime?: number,
    noteParams?: any,
    tuning?: ScaleDefinition | null
  ) => void;

  noteOnSampler?: (
    params: SamplerBankParams,
    note: string,
    time?: number,
    tuning?: ScaleDefinition | null
  ) => number | null;

  noteOffSampler?: (id: number) => void;

  noteOnSynth?: (
    params: SynthParams,
    note: string,
    time?: number,
    track?: 'partA' | 'partB' | 'bass2',
    tuning?: ScaleDefinition | null
  ) => Promise<number | null> | number | null;

  noteOffSynth?: (id: number) => void;

  stopAllNotes?: () => void;

  // Other existing methods
  loadSampleToEngine: (name: string, buffer: AudioBuffer, onProgress?: (progress: number) => void) => Promise<void> | void;
  renderSynthPartToBuffer: (params: SynthParams, sequence: PartSequence, tempo: number) => Promise<AudioBuffer>;
  playBufferedPart: (buffer: AudioBuffer, time: number) => void;
  playAmbiance: (url: string) => Promise<void>;
  stopAmbiance: () => void;
  setAmbianceVolume: (volume: number) => void;
  setMasterVolume: (volume: number) => void;
  setMasterSaturation: (amount: number) => void;
  setGlobalPan: (pan: number) => void;
  setReverbType: (type: ReverbType) => void;
  detectSamplePitch?: (buffer: AudioBuffer) => Promise<unknown>;
  processSinging?: (sampleName: string, note: string, steps: number, tempo: number) => Promise<AudioBuffer | null>;
  prepareVocal?: (bankIndex: number, text: string) => Promise<void>;
  getAlignment?: (bankIndex: number) => AlignmentResult | null;
  setAlignment?: (bankIndex: number, alignment: AlignmentResult | null) => void;
  setSustainMode?: (mode: 'loop' | 'stretch' | 'wavetable') => void;
  setSustainGrainSize?: (size: number) => void;
  playSinging?: (buffer: AudioBuffer, targetNote: string, duration: number, sourceNote?: string) => void;

  // Multisample support
  getMultisampleBank?: (bankIndex: number) => MultisampleBank | null;
  isMultisampleReady?: (bankIndex: number) => boolean;

  // Real-time voice parameter updates
  updateSamplerVoiceParams?: (bankIndex: number, param: string, value: number | string | boolean) => void;

  processSpoon?: (sampleName: string, note: string) => Promise<AudioBuffer | null>;

  // Harmonizer & effects
  setHarmonizerConfig?: (config: any, isActive: boolean) => void;
  triggerTapeStop?: (duration?: number) => void;
  resetTapeStop?: () => void;
  getFrequencyForNote?: (note: string, tuning?: ScaleDefinition | null) => number;
}

// ... rest of your types (SongStructure, SavedSongData, etc.)
export interface AutomationPoint {
  step: number;
  value: number;
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
  | 'sampler4' | 'sampler5' | 'sampler6' | 'sampler7';

/** Where the automation data originated */
export type AutomationSource = 'rbs' | 'recorded' | 'ai' | 'manual';

/** Interpolation mode between automation points */
export type AutomationInterpolation = 'step' | 'linear' | 'smooth';

/** Scope of the automation lane */
export type AutomationScope = 'pattern' | 'song';

/**
 * A single point in an automation lane.
 * Uses normalized 0–1 values for portability across parameter ranges.
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
  /** Original value range (for display/conversion), defaults to [0, 1] */
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
}

export interface SongStep {
  patternIndex: number;
}

export interface SongStructure {
  length: number;
  steps: SongStep[];
  currentSongStep: number;
}

export interface SavedSongData {
  version?: number;
  pattern: Pattern;
  params: {
    synthA: SynthParams;
    synthB: SynthParams;
    kick: KickParams;
    snare: SnareParams;
    closedHat: HatParams;
    openHat: HatParams;
    sampler: SamplerParams;
  };
  trackStorage: Record<string, unknown>;
  activeTrackSlots: Record<string, number>;
  songStructure: unknown[];
  tempo: number;
  ambianceUrl?: string;
  backgroundImage?: string;
  embeddedSamples?: { [bankIndex: number]: string };
  ttsPhrases?: string[];
  /** Persisted automation lanes (from .rbs import, recordings, or AI) */
  automationLanes?: UnifiedAutomationLane[];
}
export interface AmbianceTrack {
  id: string;
  name: string;
  url: string;
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
  /** Parameter / control ID. */
  ctrlId: number;
  /** Raw parameter value. */
  value: number;
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
