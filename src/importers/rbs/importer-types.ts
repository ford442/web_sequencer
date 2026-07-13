/**
 * RBS to Hyphon Importer
 *
 * Converts parsed RBS data into Hyphon's internal song format.
 * This is the bridge between the RBS parser and Hyphon's sequencer.
 *
 * Architecture:
 * - RbsParser → RawRbsData (format-specific)
 * - RbsImporter → HyphonSong (internal format)
 * - Hyphon App ← consumes HyphonSong
 *
 * Enhancements:
 * - 16→32 step expansion with slide/accent preservation
 * - PCF (Pattern Controlled Filter) to automation conversion
 * - Full automation lane extraction
 * - Enhanced parameter mapping with exponential curves
 * - Drum kit mapping (808 vs 909)
 * - Detailed import reporting
 */

import type {
  RawRbsData,
  HyphonSong,
  RbsImportOptions,
  Tb303Step,
  PcfSettings,
  AutomationLane,
  HyphonAutomationLane,
  StepConversionStats,
  DetailedParameterMapping,
  RbsSongData,
  Tb303PatternA,
  RbsDeviceId,
} from './types';

import { DEFAULT_RBS_IMPORT_OPTIONS, TICKS_PER_BAR, TRAK_TRACK_INDEX } from './types';

import type {
  Pattern,
  PartSequence,
  Note,
  SynthParams,
  KickParams,
  SnareParams,
  HatParams,
  Bass2Params,
  Waveform
} from '../../types';

import { noteToMidi, midiToNote } from '../../utils/musicTheory';

/**
 * Default slide-time raw value for authentic TB-303 hardware (0-127 range).
 * Corresponds to ~60 ms portamento at nominal tempo (42/127 ≈ 0.331 normalized).
 */
export const TB303_DEFAULT_SLIDE_TIME = 42;

/** Clamp a value to the [0, 1] normalized range. */
export function clampNormalized(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Import result with detailed reporting */
export interface RbsImportResult {
  success: true;
  song: HyphonSong;
  report: ImportReport;
}

/** Enhanced import report with comprehensive conversion details */
export interface ImportReport {
  /** Number of patterns converted */
  patternsConverted: number;
  /** Number of steps converted */
  stepsConverted: number;
  /** Any warnings during import */
  warnings: string[];
  /** Parameters that were mapped */
  mappings: DetailedParameterMapping[];
  /** Number of automation lanes converted */
  automationLanesConverted: number;
  /** Whether PCF was enabled in source */
  pcfEnabled: boolean;
  /** PCF extraction details (IFF DEVL or legacy path). */
  pcfStats?: {
    waveIndex: number;
    patternMin: number;
    patternMax: number;
    patternVariance: number;
    targets: string[];
    source: 'devl' | 'legacy' | 'none';
  };
  /** Number of slides preserved */
  slideCount: number;
  /** Number of accents preserved */
  accentCount: number;
  /** Step conversion statistics */
  stepStats?: StepConversionStats;
  /** Song mode info (populated when file is a full song with GLOB + TRKL) */
  songMode?: {
    /** Whether the file is in song mode (multi-pattern arrangement) */
    isSongMode: boolean;
    /** Total pattern banks available */
    patternBankCount: number;
    /** Total TRAK arrangement events */
    arrangementEventCount: number;
    /** Song length in bars */
    songLengthBars: number;
    /** Number of distinct patterns used in arrangement */
    usedPatternCount: number;
  };
  /** Parsed RBS format version string (e.g. "1.5", "2.0"). */
  formatVersion?: string;
  /** Devices detected in source file. */
  devicesPresent?: RbsDeviceId[];
  /** Parser path used for this file. */
  parsePath?: 'legacy' | 'iff';
}

/** Import error types */


export type RbsImportError =
  | 'INVALID_FORMAT'
  | 'UNSUPPORTED_VERSION'
  | 'MISSING_PATTERNS'
  | 'UNKNOWN_ERROR';

export interface TrackStats { trackId: string; stepCount: number; empty: boolean; }
export interface StepStats { totalSteps: number; slided: number; accented: number; }
export interface PCFStats { enabled: boolean; stepCount: number; }
export interface AutomationStats { laneCount: number; pointCount: number; }
