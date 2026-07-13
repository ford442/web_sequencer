/**
 * RBS (ReBirth/Roland Pattern) Importer Types
 * 
 * Defines the data structures for importing .rbs files from
 * ReBirth RB-338 and similar Roland-pattern-based sequencers.
 * 
 * Architecture: Clean separation between raw RBS data and
 * Hyphon-internal representation for future parser expansion.
 */

import type { Pattern, SynthParams, KickParams, SnareParams, HatParams, Bass2Params } from '../../types';

// ============================================================================
// BINARY PARSING TYPES
// ============================================================================

/**
 * Raw binary header structure as read from RBS file
 */
export interface RbsBinaryHeader {
  /** Magic bytes - should be "RB338" */
  magic: string;
  /** Version major */
  versionMajor: number;
  /** Version minor */
  versionMinor: number;
  /** Full version string */
  version: string;
  /** Pattern length in steps (usually 16) */
  patternLength: number;
  /** Tempo in BPM (40-250) */
  tempo: number;
  /** Time signature numerator */
  timeSignatureNum: number;
  /** Time signature denominator */
  timeSignatureDen: number;
  /** Swing amount (0-100) */
  swing: number;
  /** Song name (null-terminated ASCII) */
  songName: string;
}

/**
 * Raw TB-303 step as stored in binary
 */
export interface RbsRawStep {
  /** Note value: 0-11 (C-B), 255=rest, 254=tie */
  note: number;
  /** Octave: 1-5 */
  octave: number;
  /** Flags: bit0=accent, bit1=slide, bit2=tie */
  flags: number;
  /** Gate time 0-100% */
  gate: number;
}

/**
 * Automation point as stored in binary
 */
export interface RbsRawAutomationPoint {
  /** Step index */
  step: number;
  /** Value (2 bytes) */
  value: number;
}

/**
 * Raw automation lane as stored in binary
 */
export interface RbsRawAutomationLane {
  /** Parameter ID */
  parameterId: number;
  /** Automation points */
  points: RbsRawAutomationPoint[];
}

/** Parameter ID to name mapping for automation */
export const AUTOMATION_PARAMETER_MAP: Record<number, string> = {
  0x00: 'tempo',
  0x01: 'swing',
  0x02: 'tb303Acutoff',
  0x03: 'tb303Bcutoff',
  0x04: 'pcfCutoff',
  0x05: 'masterVolume',
  0x06: 'tb303Aresonance',
  0x07: 'tb303Bresonance',
  0x08: 'tb303Adecay',
  0x09: 'tb303Bdecay',
  0x0A: 'pcfResonance',
  0x0B: 'pcfEnvAmount',
};

// ============================================================================
// IFF CAT RB40 SONG DATA TYPES (per RBS42.txt + rbs.h from nsauzede/jsynth)
// ============================================================================

/**
 * GLOB chunk data (512 bytes in v2.0 files).
 * Contains global song settings: play mode, tempo, shuffle, loop points, vintage mode.
 * Ref: RBS42.txt GLOB section, rbs.h struct glob_t.
 */
export interface RbsGlobData {
  /** Play mode: 0 = pattern (single loop), 1 = song (arrangement) */
  playMode: 0 | 1;
  /** Tempo in BPM (40-250) */
  tempo: number;
  /** Shuffle/swing amount (0-127, 64 = no shuffle) */
  shuffle: number;
  /** Song loop start position (in pattern slots / bars) */
  loopStart: number;
  /** Song loop end position (in pattern slots / bars) */
  loopEnd: number;
  /** Vintage mode flag (0 = off, 1 = on) — affects sound character */
  vintage: number;
}

/**
 * Single TRAK event from TRKL catalog.
 * Each event is (delta position in ticks, controller ID, value).
 * Resolution: ~24 PPQ (768 ticks per bar for 4/4 at 32 steps).
 * Ref: RBS42.txt TRAK section, rbs.h struct trak_event_t.
 *
 * Controller IDs are **per-track** — see {@link TRAK_TRACK_CONTROLLER_MAP} in
 * `trakControllers.ts`. Do not use {@link AUTOMATION_PARAMETER_MAP} for TRAK bytes.
 */
export interface RbsTrakEvent {
  /** Delta position in ticks from the last event (24 PPQ) */
  deltaTicks: number;
  /** Absolute tick position (computed during parsing) */
  absoluteTicks: number;
  /** TRAK track index (0=mixer, 1=303-A, … — see TRAK_TRACK_INDEX). */
  trackIndex: number;
  /** Per-track controller ID (rbs.h track-local enum). */
  controllerId: number;
  /** Value for this event (0-255 typically, interpretation depends on controller) */
  value: number;
  /** Resolved semantic category (pattern select vs knob move vs mixer routing). */
  eventKind: import('./trakControllers').TrakEventKind;
}

/**
 * Single TRAK chunk — one track in the song arrangement.
 * Tracks correspond to: Mixer, TB-303 #1, TB-303 #2, TR-808, TR-909, Effects.
 * Ref: RBS42.txt TRAK chunk layout.
 */
export interface RbsTrakData {
  /** Track index (0-based, order: mixer=0, 303-1=1, 303-2=2, 808=3, 909=4, fx=5+) */
  trackIndex: number;
  /** Human-readable track name */
  trackName: string;
  /** Number of events in this track */
  eventCount: number;
  /** List of events for this track */
  events: RbsTrakEvent[];
}

/**
 * Full song data extracted from IFF CAT RB40 structure.
 * Represents the complete multi-pattern song arrangement.
 */
export interface RbsSongData {
  /** GLOB settings (play mode, tempo, loop points) */
  glob: RbsGlobData;
  /** All pattern banks per device (up to 32 patterns each).
   *  Index: [deviceIndex][patternIndex] */
  patternBanks: {
    tb303A: Tb303PatternA[];
    tb303B: Tb303PatternB[];
    drums808: DrumPattern[];
    drums909: DrumPattern[];
  };
  /** TRKL track arrangement data (one per track) */
  tracks: RbsTrakData[];
  /** Total song length in ticks (computed from max event position) */
  totalLengthTicks: number;
  /** Total song length in bars (assuming 768 ticks per bar) */
  totalLengthBars: number;
  /** Number of patterns actually used in the song arrangement */
  usedPatternCount: number;
}

/**
 * TRAK controller ID constants — **legacy arrangement shorthand only**.
 * Real IFF TRAK bytes use per-track enums in `trakControllers.ts` (e.g. TB-303
 * pattern select = 0x01, cutoff = 0x03 on track 1).
 */
export const TRAK_CONTROLLER = {
  /** @deprecated Use TB303_TRAK_CONTROLLER.PATTERN_SELECT on instrument tracks */
  PATTERN_SELECT: 0,
  /** Mute toggle (value: 0=unmute, 1=mute) */
  MUTE: 1,
  /** Volume (0-127) */
  VOLUME: 2,
  /** Pan (0-127, 64=center) */
  PAN: 3,
} as const;

/**
 * TRAK track index constants (rbs.h trak_event_t ordering).
 * Ref: RBS42.txt track ordering in TRKL catalog.
 */
export const TRAK_TRACK_INDEX = {
  MIXER: 0,
  TB303_1: 1,
  TB303_2: 2,
  TR808: 3,
  TR909: 4,
  DELAY: 5,
  DIST: 6,
  PCF: 7,
  COMPRESSOR: 8,
  /** @deprecated Alias for DELAY (track index 5). */
  EFFECTS: 5,
} as const;

// Re-export per-track TRAK controller tables (rbs.h).
export type { TrakEventKind, TrakParamMapping } from './trakControllers';
export {
  TRAK_TRACK_CONTROLLER_MAP,
  TB303_TRAK_CONTROLLER,
  MIXER_TRAK_CONTROLLER,
  DRUM_TRAK_CONTROLLER,
  PCF_TRAK_CONTROLLER,
  DELAY_TRAK_CONTROLLER,
  resolveTrakEventKind,
  isTrakPatternSelectEvent,
  isTrakParamAutomationEvent,
  resolveTrakParamMapping,
  normaliseTrakParamValue,
} from './trakControllers';

/** Ticks per bar in ReBirth format (768 ticks/bar in 4/4 time) */
export const TICKS_PER_BAR = 768;

/** Ticks per step (768 / 16 steps = 48 ticks per step) */
export const TICKS_PER_STEP = 48;

// ============================================================================
// RAW RBS DATA (as read from file - closely mirrors RBS format)
// ============================================================================

/**
 * Raw data structure representing an .rbs file contents.
 * This is the output of RbsParser before any conversion.
 */
export interface RawRbsData {
  /** RBS file format version (e.g., "1.0", "2.0") */
  version: string;
  
  /** Project metadata */
  project: RbsProject;
  
  /** TB-303 Pattern A (lead/bass line) */
  tb303PatternA: Tb303PatternA;
  
  /** TB-303 Pattern B (secondary/accent line) */
  tb303PatternB: Tb303PatternB;
  
  /** Drum machine patterns (TR-808/909 style) */
  drums: DrumPattern;
  
  /** PCF (Pattern Controlled Filter) settings */
  pcf: PcfSettings;
  
  /** Automation lanes (tempo, swing, etc.) */
  automation: AutomationLane[];
  
  /** Raw binary chunks for future expansion */
  rawChunks?: Uint8Array[];
  
  /** Original binary header for debugging */
  rawHeader?: RbsBinaryHeader;

  /** Full IFF CAT RB40 song data (populated when file is a full song with GLOB + TRKL).
   *  Contains multi-pattern banks, song arrangement tracks, and global settings.
   *  When present, indicates the file is a full song (not just a single pattern). */
  songData?: RbsSongData;

  /** Devices present in the file (from DEVL banks or legacy layout inference). */
  devicesPresent?: RbsDeviceId[];

  /** Which parser path produced this data. */
  parsePath?: 'legacy' | 'iff';
}

/** ReBirth device identifiers for import reporting. */
export type RbsDeviceId = '303-1' | '303-2' | '808' | '909';

/**
 * RBS Project metadata
 */
export interface RbsProject {
  /** Song/pattern name */
  name: string;
  
  /** Author/creator */
  author?: string;
  
  /** Original tempo in BPM */
  tempo: number;
  
  /** Time signature numerator (usually 4) */
  timeSignatureNum: number;
  
  /** Time signature denominator (usually 4) */
  timeSignatureDen: number;
  
  /** Swing amount (0-100%, where 50% = no swing) */
  swing: number;
  
  /** Total pattern length in steps (typically 16 or 32) */
  patternLength: number;
  
  /** Creation timestamp (if available) */
  createdAt?: Date;
  
  /** RBS software that created this (e.g., "ReBirth RB-338") */
  sourceSoftware?: string;
}

/**
 * TB-303 Pattern A parameters
 * Pattern A typically carries the main melody/bass line
 */
export interface Tb303PatternA {
  /** 16 or 32 steps of note data */
  steps: Tb303Step[];
  
  /** Cutoff frequency (0-127, maps to Hz) */
  cutoff: number;
  
  /** Resonance amount (0-127) */
  resonance: number;
  
  /** Envelope modulation amount (0-127) */
  envMod: number;
  
  /** Decay time (0-127) */
  decay: number;
  
  /** Accent intensity (0-127) */
  accent: number;
  
  /** Waveform: 0=sawtooth, 1=square */
  waveform: 0 | 1;
  
  /** Distortion amount (0-127, if supported) */
  distortion?: number;
  
  /** Delay send (0-127, if supported) */
  delaySend?: number;

  /**
   * Slide/portamento time (0-127).
   * Fixed at ~0x2A (42) on authentic TB-303 hardware (≈ 60 ms at nominal tempo).
   * Only populated when the RBS file explicitly encodes a custom slide time.
   */
  slideTime?: number;
}

/**
 * TB-303 Pattern B parameters
 * Pattern B typically carries counter-melodies or fills
 */
export interface Tb303PatternB {
  /** 16 or 32 steps of note data */
  steps: Tb303Step[];
  
  /** Cutoff frequency (0-127, maps to Hz) */
  cutoff: number;
  
  /** Resonance amount (0-127) */
  resonance: number;
  
  /** Envelope modulation amount (0-127) */
  envMod: number;
  
  /** Decay time (0-127) */
  decay: number;
  
  /** Accent intensity (0-127) */
  accent: number;
  
  /** Waveform: 0=sawtooth, 1=square */
  waveform: 0 | 1;
  
  /** Distortion amount (0-127, if supported) */
  distortion?: number;
  
  /** Delay send (0-127, if supported) */
  delaySend?: number;
  
  /** Transpose offset in semitones (-12 to +12) */
  transpose?: number;

  /**
   * Slide/portamento time (0-127).
   * Fixed at ~0x2A (42) on authentic TB-303 hardware (≈ 60 ms at nominal tempo).
   * Only populated when the RBS file explicitly encodes a custom slide time.
   */
  slideTime?: number;
}

/**
 * Single step in a TB-303 pattern
 */
export interface Tb303Step {
  /** Step index (0-15 or 0-31) */
  index: number;
  
  /** Note: 0=C, 1=C#, ... 11=B, or -1 for rest */
  note: number;
  
  /** Octave: 1-5 (where 3 is middle C) */
  octave: number;
  
  /** Whether this step has accent */
  accent: boolean;
  
  /** Whether this step slides from previous */
  slide: boolean;
  
  /** Whether this step is tied/sustained */
  tie: boolean;
  
  /** Gate time as percentage (default 100%) */
  gate?: number;
}

/**
 * TR-808/909 style drum pattern
 */
export interface DrumPattern {
  /** Kick drum pattern: 16 or 32 boolean steps */
  kick: boolean[];
  
  /** Snare drum pattern: 16 or 32 boolean steps */
  snare: boolean[];
  
  /** Closed hi-hat pattern: 16 or 32 boolean steps */
  closedHat: boolean[];
  
  /** Open hi-hat pattern: 16 or 32 boolean steps */
  openHat: boolean[];
  
  /** Additional percussion (if present in RBS) */
  percussion?: {
    /** Low tom/conga */
    lowTom?: boolean[];
    /** Mid tom/conga */
    midTom?: boolean[];
    /** High tom/conga */
    highTom?: boolean[];
    /** Clap */
    clap?: boolean[];
    /** Rim shot */
    rim?: boolean[];
    /** Crash cymbal */
    crash?: boolean[];
    /** Ride cymbal */
    ride?: boolean[];
  };
  
  /** Accent pattern for drums (16 or 32 steps of 0-127) */
  accent?: number[];
  
  /** Drum kit type: "808" | "909" */
  kitType: '808' | '909';
  
  /** Individual drum tunings (if supported) */
  tuning?: {
    kick?: number;      // -50 to +50 cents
    snare?: number;
    closedHat?: number;
    openHat?: number;
  };
  
  /** Individual drum decay settings (if supported) */
  decay?: {
    kick?: number;      // 0-127
    snare?: number;
    closedHat?: number;
    openHat?: number;
  };
}

/**
 * PCF (Pattern Controlled Filter) settings
 * Used for filter sweeps and pattern-based modulation
 */
export interface PcfSettings {
  /** Whether PCF is enabled */
  enabled: boolean;
  
  /** Filter type: "lp" (lowpass), "bp" (bandpass), "hp" (highpass) */
  filterType: 'lp' | 'bp' | 'hp';
  
  /** Cutoff frequency (0-127) */
  cutoff: number;
  
  /** Resonance (0-127) */
  resonance: number;
  
  /** Envelope amount (0-127) */
  envAmount: number;
  
  /** Decay time (0-127) */
  decay: number;
  
  /** 16 or 32 step pattern for filter modulation (0-127 per step) */
  pattern: number[];

  /** PCF wave preset index from IFF DEVL (0–55); legacy path derives pattern from bytes directly. */
  waveIndex?: number;

  /** Target: which parts go through PCF */
  target: {
    tb303A: boolean;
    tb303B: boolean;
    drums: boolean;
  };
}

/**
 * Automation lane for continuous parameter changes
 */
export interface AutomationLane {
  /** Parameter being automated */
  parameter: 'tempo' | 'swing'
    | 'tb303Acutoff' | 'tb303Bcutoff'
    | 'tb303Aresonance' | 'tb303Bresonance'
    | 'tb303Adecay' | 'tb303Bdecay'
    | 'pcfCutoff' | 'pcfResonance' | 'pcfEnvAmount'
    | 'masterVolume';
  
  /** Human-readable name */
  name: string;
  
  /** Automation points: [stepIndex, value] pairs */
  points: [number, number][];
  
  /** Interpolation type */
  interpolation: 'step' | 'linear' | 'smooth';
  
  /** Value range [min, max] */
  range: [number, number];
}

// ============================================================================
// HYPHON CONVERTED DATA (internal representation after import)
// ============================================================================

/**
 * Hyphon song structure after RBS conversion.
 * This matches Hyphon's internal SavedSongData format.
 */
export interface HyphonSong {
  /** Song version */
  version: number;
  
  /** Song metadata (converted from RbsProject) */
  metadata: {
    name: string;
    author?: string;
    importedFrom: 'rbs';
    originalSource?: string;
    importedAt: Date;
  };
  
  /** Global settings */
  tempo: number;
  timeSignature: [number, number];
  swing: number;
  
  /** Pattern data (converted from RBS patterns) */
  pattern: Pattern;
  
  /** Synth parameters (converted from TB-303 settings) */
  params: {
    /** TB-303 Pattern A → partA (or partB depending on arrangement) */
    synthA: SynthParams;
    
    /** TB-303 Pattern B → partB or bass2 */
    synthB: SynthParams;
    
    /** Secondary bass if both 303s used */
    bass2?: Bass2Params;
    
    /** Kick drum params (from drum kit) */
    kick: KickParams;
    
    /** Snare params (from drum kit) */
    snare: SnareParams;
    
    /** Closed hat params */
    closedHat: HatParams;
    
    /** Open hat params */
    openHat: HatParams;
    
    /** Selected drum kit type (808/909) from .rbs file */
    drumKit?: '808' | '909';
  };
  
  /** Converted automation lanes */
  automation?: HyphonAutomationLane[];

  /** PCF real-time filter configuration (when importPcfAsFilter is enabled) */
  pcfFilter?: {
    enabled: boolean;
    filterType: 'lp' | 'bp' | 'hp';
    cutoff: number;
    resonance: number;
    envAmount: number;
    decay: number;
    pattern: number[];
    target: {
      tb303A: boolean;
      tb303B: boolean;
      drums: boolean;
    };
  };
  
  /** Additional RBS-specific data preserved for round-trip */
  rbsMetadata?: {
    originalVersion: string;
    pcfSettings: PcfSettings;
    automation: AutomationLane[];
    tb303AParams: Omit<Tb303PatternA, 'steps'>;
    tb303BParams: Omit<Tb303PatternB, 'steps'>;
  };

  /** Song arrangement data (populated when file contains full IFF song with GLOB + TRKL).
   *  Contains multi-pattern banks + arrangement events for SongMode playback. */
  songArrangement?: {
    /** Play mode: 'pattern' (single loop) or 'song' (multi-pattern arrangement) */
    mode: 'pattern' | 'song';
    /** Pattern banks per track (up to 32 patterns each, mapped to Hyphon trackStorage slots) */
    trackStorage: {
      partA: (Pattern['partA'] | null)[];
      partB: (Pattern['partB'] | null)[];
      bass2: (Pattern['bass2'] | null)[];
      kick: (Pattern['kick'] | null)[];
      snare: (Pattern['snare'] | null)[];
      closedHat: (Pattern['closedHat'] | null)[];
      openHat: (Pattern['openHat'] | null)[];
    };
    /** Song structure (ordered pattern slot indices per track per measure) */
    songStructure: Array<Record<string, number | null>>;
    /** Active pattern slot per track (from measure 0 / first reference) */
    activeTrackSlots?: Record<string, number>;
    /** Loop start bar (0-based) */
    loopStart?: number;
    /** Loop end bar (0-based) */
    loopEnd?: number;
    /** Raw TRAK events preserved for arrangement / debugging */
    trakEvents?: RbsTrakEvent[];
    /** Sub-step knob automation events (paramChange only — excludes pattern select). */
    trakParamEvents?: RbsTrakEvent[];
    /** Per-slot TB-303 knob params from DEVL pattern banks (song-mode pattern recall). */
    trackParamStorage?: {
      synthA: (Partial<SynthParams> | null)[];
      synthB: (Partial<SynthParams> | null)[];
      bass2: (Partial<Bass2Params> | null)[];
    };
  };
}

/**
 * Hyphon automation lane format
 * Converted from RBS automation lanes
 */
export interface HyphonAutomationLane {
  /** Target track/parameter */
  target: 'synthA' | 'synthB' | 'bass2' | 'kick' | 'snare' | 'closedHat' | 'openHat' | 'master';
  
  /** Parameter name within the target */
  parameter: string;
  
  /** Lane name for display */
  name: string;
  
  /** Automation points: [stepIndex (0-31), normalizedValue (0-1)] */
  points: [number, number][];
  
  /** Interpolation type for value transitions */
  interpolation: 'step' | 'linear' | 'smooth';
  
  /** Original value range from RBS */
  originalRange: [number, number];
}

// ============================================================================
// IMPORT OPTIONS
// ============================================================================

/**
 * Options for RBS import conversion
 */
export interface RbsImportOptions {
  /** Which Hyphon track receives TB-303 Pattern A */
  tb303ATarget: 'partA' | 'partB' | 'bass2';
  
  /** Which Hyphon track receives TB-303 Pattern B */
  tb303BTarget: 'partA' | 'partB' | 'bass2';
  
  /** Whether to convert PCF to filter automation */
  convertPcfToAutomation: boolean;
  
  /** Whether to import swing settings */
  importSwing: boolean;
  
  /** Drum kit mapping preference */
  drumKitMapping: 'auto' | '808' | '909';
  
  /** Whether to preserve original 303 step count (16) or expand to Hyphon (32) */
  expandTo32Steps: boolean;
  
  /** Whether to interpolate automation curves (smooth transitions) */
  interpolateAutomation: boolean;
  
  /** Whether to quantize timing to 16th notes */
  quantizeTo16th: boolean;
  
  /** Whether to import PCF as per-track filters instead of automation */
  importPcfAsFilter: boolean;
}

/** Default import options */
export const DEFAULT_RBS_IMPORT_OPTIONS: RbsImportOptions = {
  /** v1.5 files expose a single TB-303 — maps to partA (SYNTH A) by default. */
  tb303ATarget: 'partA',
  tb303BTarget: 'bass2',
  convertPcfToAutomation: true,
  importSwing: true,
  drumKitMapping: 'auto',
  expandTo32Steps: true,
  interpolateAutomation: true,
  quantizeTo16th: true,
  importPcfAsFilter: false,
};

// ============================================================================
// CONVERSION UTILITY TYPES
// ============================================================================

/**
 * Statistics for step conversion
 */
export interface StepConversionStats {
  /** Number of slides preserved */
  slideCount: number;
  /** Number of accents preserved */
  accentCount: number;
  /** Number of ties handled */
  tieCount: number;
  /** Total steps after expansion */
  totalSteps: number;
}

/**
 * Enhanced parameter mapping with conversion details
 */
export interface DetailedParameterMapping {
  source: string;
  target: string;
  originalValue: number | string;
  convertedValue: number | string;
  formula?: string;
}

// ============================================================================
// PARAMETER LOCKS
// ============================================================================

/**
 * Per-step parameter lock — a one-off parameter override applied for exactly
 * one sequencer step.
 *
 * Analogous to Elektron's "parameter lock" concept; in ReBirth this corresponds
 * to per-step accent/slide flags and (when present) per-step PCF overrides.
 *
 * During import, `RbsImporter.generateParameterLocks()` converts these from
 * per-step TB-303 and PCF data and stores them alongside the song.  At
 * playback, the AutomationScheduler converts active locks into time-stamped
 * parameter changes so each step receives the correct value independently.
 *
 * @see RbsImporter.generateAccentSlideAutomation
 * @see AutomationScheduler._apply303Param
 */
export interface RbsParameterLock {
  /** Target instrument/track. */
  target: 'synthA' | 'synthB' | 'bass2' | 'kick' | 'snare' | 'closedHat' | 'openHat' | 'master';
  /**
   * Parameter name — matches the names used by AutomationScheduler
   * (e.g. `'accent'`, `'slide'`, `'filterCutoff'`).
   */
  parameter: string;
  /** 0-based step index within the pattern (0–31). */
  step: number;
  /** Locked value, normalised to the 0–1 range. */
  value: number;
}
