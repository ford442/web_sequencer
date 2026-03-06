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
}

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
  parameter: 'tempo' | 'swing' | 'tb303Acutoff' | 'tb303Bcutoff' | 'pcfCutoff' | 'masterVolume';
  
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
  };
  
  /** Additional RBS-specific data preserved for round-trip */
  rbsMetadata?: {
    originalVersion: string;
    pcfSettings: PcfSettings;
    automation: AutomationLane[];
    tb303AParams: Omit<Tb303PatternA, 'steps'>;
    tb303BParams: Omit<Tb303PatternB, 'steps'>;
  };
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
}

/** Default import options */
export const DEFAULT_RBS_IMPORT_OPTIONS: RbsImportOptions = {
  tb303ATarget: 'partA',
  tb303BTarget: 'bass2',
  convertPcfToAutomation: true,
  importSwing: true,
  drumKitMapping: 'auto',
  expandTo32Steps: true,
};
