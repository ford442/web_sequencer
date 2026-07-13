/**
 * RBS File Parser
 *
 * Parses .rbs files from ReBirth RB-338 (v1.5, 2.0, 2.0.1) and compatible sequencers.
 *
 * Architecture:
 * - Current implementation: Fixed-offset parser for single-pattern data (HEAD + TB303 A/B + DRUMS + PCF + basic automation).
 *   Already handles 16-step patterns, param extraction, accent/slide/tie flags, PCF, basic automation lanes, drum kit/tuning/decay.
 * - Next evolution (see GitHub #671): Full IFF "CAT RB40" chunk-based parser (per definitive RBS42.txt + rbs.h from nsauzede/jsynth reverse engineering).
 *   Required for real multi-pattern song files: 32 patterns per device in DEVL catalog, GLOB (play mode song vs pattern), TRKL/TRAK event lists (delta-tick + ctrlID + value) for song arrangement + continuous automation.
 * - Version handling: v2.0+ (RB40) is the documented full format; v1.5 is a simpler subset (often 1x303 + 808 only).
 *
 * Automation Precision Notes (critical for accurate ReBirth playback + future authentic RBS song creation):
 * - TRAK events use sub-step / tick resolution (~24 PPQ, 768 ticks/bar). Requires 1/96+ sub-step support in lanes + AudioParam scheduling (setValueAtTime + linearRampToValueAtTime) rather than pure per-step JS updates.
 * - Hybrid: Step-based (pattern step bitmasks for accent/slide/note) + continuous curves (knob automation events).
 * - Must reproduce ReBirth accent intensity, slide/portamento timing, PCF sweeps, 303 env/decay/wave changes with low jitter and tight clock sync (no drift over long songs).
 * - Recording must capture with temporal accuracy aligned to scheduler/audio clock.
 * - The system (lanes + scheduler + Open303 wiring) must be expressive enough to *author* new ReBirth-style songs inside Hyphon.
 * See updated issues #669, #670, #654, and new #671 for details and requirements.
 *
 * Primary external reference: https://github.com/nsauzede/jsynth (RBS42.txt, songfilev4.txt, rbs.h/c with exact packed structs, controller IDs, event encoding).
 *
 * Comprehensive error handling with detailed offset information.
 */

import type {
  RawRbsData,
  RbsProject,
  Tb303PatternA,
  Tb303PatternB,
  DrumPattern,
  PcfSettings,
  AutomationLane,
  RbsBinaryHeader,
  RbsRawStep,
  RbsRawAutomationLane,
  RbsGlobData,
  RbsTrakEvent,
  RbsTrakData,
  RbsSongData,
} from './types';
import { AUTOMATION_PARAMETER_MAP, TICKS_PER_BAR, TRAK_TRACK_INDEX } from './types';

/** Parser error types for granular error handling */
export type RbsParserError =
  | { type: 'INVALID_FORMAT'; message: string }
  | { type: 'UNSUPPORTED_VERSION'; version: string; supported: string[] }
  | { type: 'CORRUPTED_DATA'; section: string; details?: string; offset?: number }
  | { type: 'READ_ERROR'; message: string };

/**
 * Stable, testable error codes for the RBS parse pipeline.
 * Maps from {@link RbsParserError} discriminated variants.
 */
export type RbsErrorCode =
  | 'RBS_ERROR_UNKNOWN_FORMAT'
  | 'RBS_ERROR_TRUNCATED_CHUNK'
  | 'RBS_ERROR_UNSUPPORTED_VERSION'
  | 'RBS_ERROR_CORRUPTED_DATA'
  | 'RBS_ERROR_READ_ERROR'
  | 'RBS_ERROR_FILE_TOO_SMALL'
  | 'RBS_ERROR_FILE_TOO_LARGE'
  | 'RBS_ERROR_INVALID_EXTENSION';

/** All failure codes returned by {@link classifyParserError}. */
export const RBS_ERROR_CODES: readonly RbsErrorCode[] = [
  'RBS_ERROR_UNKNOWN_FORMAT',
  'RBS_ERROR_TRUNCATED_CHUNK',
  'RBS_ERROR_UNSUPPORTED_VERSION',
  'RBS_ERROR_CORRUPTED_DATA',
  'RBS_ERROR_READ_ERROR',
  'RBS_ERROR_FILE_TOO_SMALL',
  'RBS_ERROR_FILE_TOO_LARGE',
  'RBS_ERROR_INVALID_EXTENSION',
] as const;

/**
 * Classify a parser error into a stable `RBS_ERROR_*` code for UI and tests.
 */
export function classifyParserError(error: RbsParserError): RbsErrorCode {
  switch (error.type) {
    case 'INVALID_FORMAT':
      if (error.message.includes('.rbs extension') || error.message.includes('does not have .rbs')) {
        return 'RBS_ERROR_INVALID_EXTENSION';
      }
      if (error.message.toLowerCase().includes('too large')) {
        return 'RBS_ERROR_FILE_TOO_LARGE';
      }
      return 'RBS_ERROR_UNKNOWN_FORMAT';
    case 'UNSUPPORTED_VERSION':
      return 'RBS_ERROR_UNSUPPORTED_VERSION';
    case 'CORRUPTED_DATA': {
      const details = error.details?.toLowerCase() ?? '';
      if (details.includes('truncated') || details.includes('past eof') || details.includes('chunk')) {
        return 'RBS_ERROR_TRUNCATED_CHUNK';
      }
      if (details.includes('too small') || error.section === 'header' && details.includes('min')) {
        return 'RBS_ERROR_FILE_TOO_SMALL';
      }
      return 'RBS_ERROR_CORRUPTED_DATA';
    }
    case 'READ_ERROR':
      return 'RBS_ERROR_READ_ERROR';
    default:
      return 'RBS_ERROR_CORRUPTED_DATA';
  }
}

/** Parser result with discriminated union for type safety */
export type RbsParserResult =
  | { success: true; data: RawRbsData }
  | { success: false; error: RbsParserError };

/** Supported RBS format versions (current parser accepts common ones; full IFF path will detect RB40 / v4.x) */
export const SUPPORTED_VERSIONS = ['1.0', '1.5', '2.0', '2.0.1', '4.0', '4.2'];

/** Versions that use the v1.5 device subset (often single 303 + TR-808, no 909). */
export const V15_SUBSET_VERSIONS = ['1.0', '1.5'] as const;

/** Versions that use the full IFF CAT RB40 multi-device layout. */
export const IFF_FULL_FORMAT_VERSIONS = ['2.0', '2.0.1', '4.0', '4.2'] as const;

export function isV15SubsetVersion(version: string): boolean {
  return (V15_SUBSET_VERSIONS as readonly string[]).includes(version);
}

export function isIffFullFormatVersion(version: string): boolean {
  return (IFF_FULL_FORMAT_VERSIONS as readonly string[]).includes(version);
}

/** Minimum valid RBS file size (header + minimal patterns) */
export const MIN_FILE_SIZE = 0x300; // 768 bytes minimum

/** File offset constants (legacy fixed-offset path for single-pattern / current parser) */
export const OFFSETS = {
  HEADER: 0x00,
  HEADER_SIZE: 0x40,           // 64 bytes (legacy view)
  TB303_A: 0x40,
  TB303_A_SIZE: 0x100,         // 256 bytes
  TB303_B: 0x140,
  TB303_B_SIZE: 0x100,         // 256 bytes
  DRUMS: 0x240,
  DRUMS_SIZE: 0x80,            // 128 bytes
  PCF: 0x2C0,
  PCF_SIZE: 0x40,              // 64 bytes
  AUTOMATION: 0x300,
} as const;

/**
 * IFF chunk header (parsed from CAT RB40 files).
 * ReBirth uses big-endian for chunk sizes in the IFF container.
 */
export interface IffChunk {
  id: string;      // 4-char ID (e.g. "HEAD", "GLOB", "DEVL", "TRAK")
  size: number;    // payload size (big-endian uint32 after ID)
  offset: number;  // absolute file offset of payload start
}

/** Step structure size in bytes */
export const STEP_SIZE = 15;

/** Number of steps per pattern */
export const STEP_COUNT = 16;

/** Special note value: rest (no note plays) */
export const NOTE_REST = 255;

/** Special note value: tie (sustain previous note) */
export const NOTE_TIE = 254;

/** Maximum number of TRAK events to parse (safety cap) */
export const MAX_TRAK_EVENTS = 100000;

/** Maximum song length in measures for arrangement import */
const MAX_SONG_BARS = 64;

/**
 * IFF DEVL device chunk layouts (RBS42 / rbs.h).
 * Ref: Propellerhead RBSFormat42.txt, nsauzede/jsynth `rbs.h`.
 *
 * DEVL catalog order (fixed): MIXR, DELY, PCF, DIST, COMP, `303 `, `303 `, `808 `, `909 `.
 * Implementation: `devlLayout.ts` (`parseTb303DeviceChunk`, `parseTr808DeviceChunk`, …).
 */
export const DEVL_LAYOUT = {
  /** `303 ` chunk payload size (bytes). */
  TB303_CHUNK_SIZE: 1097,
  /** Bytes per pattern slot inside `303 ` (shuffle + length + 16×2 step bytes). */
  TB303_PATTERN_SIZE: 34,
  TB303_PATTERN_COUNT: 32,
  /** First pattern slot offset within `303 ` payload (after 9-byte device header). */
  TB303_PATTERN_DATA_OFFSET: 9,
  /** `808 ` chunk payload size. */
  TR808_CHUNK_SIZE: 6238,
  /** Bytes per pattern slot inside `808 ` (shuffle + length + 16×12 trigger bytes). */
  TR808_PATTERN_SIZE: 194,
  TR808_PATTERN_DATA_OFFSET: 30,
  /** `909 ` chunk payload size (+1 vs 808 for extra global param). */
  TR909_CHUNK_SIZE: 6239,
  TR909_PATTERN_SIZE: 194,
  TR909_PATTERN_DATA_OFFSET: 30,
} as const;

/**
 * TB-303 `303 ` device header offsets (pattern-mode globals, RBS42).
 * Pattern banks begin at {@link DEVL_LAYOUT.TB303_PATTERN_DATA_OFFSET}.
 */
export const DEVL_TB303_DEVICE = {
  ENABLED: 0,
  SELECTED_PATTERN: 1,
  TUNE: 2,
  CUTOFF: 3,
  RESONANCE: 4,
  ENV_MOD: 5,
  DECAY: 6,
  ACCENT: 7,
  WAVEFORM: 8,
} as const;

/**
 * One TB-303 pattern block inside the 32×{@link DEVL_LAYOUT.TB303_PATTERN_SIZE} bank region.
 * Step *n* starts at `patternBase + STEP_DATA + n * STEP_BYTES`.
 */
export const DEVL_TB303_PATTERN = {
  SHUFFLE: 0,
  LENGTH: 1,
  STEP_DATA: 2,
  STEP_BYTES: 2,
  /** Step flag bit 0 — slide. */
  FLAG_SLIDE: 0x01,
  /** Step flag bit 1 — accent. */
  FLAG_ACCENT: 0x02,
  /** Step flag bit 4 — note on (clear = rest). */
  FLAG_NOTE: 0x10,
} as const;

/**
 * TR-808 / TR-909 pattern step layout: 12 trigger bytes per step (AC, BD, SD, …).
 * See RBS42 `808 ` / `909 ` chunk sections.
 */
export const DEVL_DRUM_STEP = {
  INSTRUMENT_COUNT: 12,
  OFFSET_IN_PATTERN: 2,
  TRIGGER_ON: 0x01,
  TRIGGER_ACCENT: 0x02,
} as const;

/**
 * DEVL `PCF ` chunk byte offsets (12-byte payload, RBS42).
 */
export const DEVL_PCF_CHUNK = {
  SIZE: 12,
  ENABLED: 0,
  FREQUENCY: 1,
  RESONANCE: 2,
  AMOUNT: 3,
  WAVE: 4,
  DECAY: 5,
  MODE: 6,
} as const;

/** DEVL `MIXR` — PCF device routing byte. */
export const DEVL_MIXR_PCF_DEVICE_ID_OFFSET = 2;

/**
 * RBS Parser class
 *
 * Usage:
 * ```typescript
 * const parser = new RbsParser();
 * const result = await parser.parseRbsFile(file);
 * if (result.success) {
 *   console.log(result.data.project.name);
 * } else {
 *   console.error(result.error.message);
 * }
 * ```
 */
