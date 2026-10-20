/**
 * AI Song Importer
 *
 * Converts AI-generated song JSON (from Claude, Gemini, Jules, Copilot, etc.)
 * into Hyphon's internal SavedSongData format.
 *
 * Integration:
 * - Validates JSON against AISongData schema
 * - Converts to HyphonSong format
 * - Uploads to Hugging Face storage_manager API via AISongStorage
 * - Falls back to IndexedDB for local storage
 *
 * Architecture: Clean separation between AI format and internal format
 * allows multiple AI sources to generate compatible songs.
 */

import type {
  SavedSongData,
  Pattern,
  PartSequence,
  Note,
  SynthParams,
  Bass2Params,
  KickParams,
  SnareParams,
  HatParams,
  SamplerParams,
  SamplerBankParams,
  TrackKey,
  AutomationPoint
} from '../../types';

import {
  AISongStorage,
  type AISongUploadOptions,
  type AISongMetadata
} from '../../services/AISongStorage';
import type { StorageResult, UploadSuccess, StorageError } from '../../services/CloudStorage';
import { isSupportedAISongVersion } from './versioning';
import { VALID_PARAMETERS_BY_TARGET } from './automationParameters';
import {
  AI_SONG_TRACK_NAMES,
  DEFAULT_AI_PATTERN_ID,
  MAX_AI_PATTERNS_PER_TRACK,
  songStepCount,
} from './songBlock';

export { AI_SONG_TRACK_NAMES, DEFAULT_AI_PATTERN_ID, MAX_AI_PATTERNS_PER_TRACK, songStepCount };

// ============================================================================
// AI SONG DATA TYPES (External AI format)
// ============================================================================

/** Valid automation targets */
export type AIAutomationTarget =
  | 'synthA'
  | 'synthB'
  | 'bass2'
  | 'kick'
  | 'snare'
  | 'closedHat'
  | 'openHat'
  | 'sampler'
  | 'master';

/** Valid automation parameters for each target */
export type AITargetedParameter =
  // Synth parameters (per-voice)
  | 'filterCutoff' | 'filterResonance' | 'filterMode'
  | 'decay' | 'accent' | 'envMod' | 'waveform'
  | 'pitch' | 'volume' | 'drive'
  // Delay parameters
  | 'delayTime' | 'delayFeedback' | 'delayMix'
  // Macro engine knobs (synthA / synthB on a macro-* model; MACRO_AUTOMATION_TARGETS)
  | 'macroHarmonics' | 'macroTimbre' | 'macroMorph' | 'macroDecay' | 'macroLpgColour'
  | 'macroFmMod' | 'macroTimbreMod' | 'macroMorphMod' | 'macroGlide' | 'macroSpread'
  // Drum parameters
  | 'tone' | 'noise'
  // Sampler parameters
  | 'playbackSpeed'
  // Master
  | 'tempo' | 'swing' | 'masterVolume';

/** Interpolation mode for automation values */
export type AIInterpolationMode = 'step' | 'linear' | 'smooth';

/**
 * Single automation lane for parameter changes over time.
 * Each lane controls one parameter on one target.
 */
export interface AIAutomationLane {
  /** Target track or master to control */
  target: AIAutomationTarget;
  /** Parameter to automate */
  parameter: AITargetedParameter;
  /** One value per step (0-127 or null for no change). Length should match pattern length (16 or 32) */
  steps: (number | null)[];
  /** How to interpolate between values */
  interpolation?: AIInterpolationMode;
}

/** Track names an AI song uses (`synthA` / `synthB` are Hyphon's `partA` / `partB`). */
export type AISongTrackName =
  | 'synthA' | 'synthB' | 'bass2'
  | 'kick' | 'snare' | 'closedHat' | 'openHat'
  | 'sampler';

/** One pattern's worth of tracks — the v1.0 `tracks` shape. */
export interface AISongTracks {
  /** TB-303 style lead/bass */
  synthA?: AITrackData;
  /** TB-303 style secondary */
  synthB?: AITrackData;
  /** Second 303 bass */
  bass2?: AITrackData;
  /** Drum patterns (true = hit) */
  kick?: boolean[];
  snare?: boolean[];
  closedHat?: boolean[];
  openHat?: boolean[];
  /** Sampler banks (8 max) */
  sampler?: AISamplerBankData[];
}

/** A named pattern in a v1.1 song. */
export interface AIPatternData {
  tracks: AISongTracks;
  /**
   * Pattern-local lanes, one value per step of the pattern. On import they
   * are tiled across the measures that play this pattern.
   */
  automation?: AIAutomationLane[];
}

/**
 * One measure of a v1.1 song: the pattern id each track plays. A track that
 * is missing or `null` is silent for the measure.
 */
export type AISongRow = Partial<Record<AISongTrackName, string | null>>;

/** `meta.version` values this build reads (see `versioning.ts`). */
export type AISongFormatVersion = '1.0' | '1.1';

/**
 * Standard format for AI-generated songs.
 * Designed to be simple for AIs to generate while being unambiguous to parse.
 *
 * v1.0 is one pattern (`tracks`). v1.1 adds an optional song block:
 * `patterns` (named) + `song` (one row per measure) + `globals.stepCount`.
 */
export interface AISongData {
  /** Metadata about the song and generation */
  meta: {
    title: string;
    author: string;
    version: AISongFormatVersion;
    createdAt: string; // ISO 8601
    generator: string; // "claude-3-opus" | "gemini-pro" | "jules" | "copilot" | etc.
    prompt: string;
    tags?: string[];
  };

  /** Global song settings */
  globals: {
    tempo: number; // BPM (30-300)
    /** [numerator, denominator] — optional, defaults to [4, 4] */
    timeSignature?: [number, number]; // [4, 4], [3, 4], etc.
    swing?: number; // 0-100 (50 = no swing)
    /** v1.1: steps per pattern / measure (1-64), defaults to 32 */
    stepCount?: number;
  };

  /**
   * Track patterns. Required in v1.0; in v1.1 either this (one pattern,
   * `"A"`) or `patterns`.
   */
  tracks?: AISongTracks;

  /** v1.1: named patterns, referenced by id from `song` rows */
  patterns?: Record<string, AIPatternData>;

  /** v1.1: the arrangement, one row per measure */
  song?: AISongRow[];

  /**
   * Optional automation lanes. With `patterns`, these are song-wide: they
   * repeat every measure.
   */
  automation?: AIAutomationLane[];
}

/** Single track data from AI */
export interface AITrackData {
  notes: AINoteEvent[];
  params?: Partial<SynthParams>;
  harmonizer?: AIHarmonizerConfig;
}

/** Note event in AI format */
export interface AINoteEvent {
  step: number; // 0-31
  note: string; // "C4", "F#3", etc.
  velocity?: number; // 0-1
  length?: number; // In steps
  accent?: boolean;
  slide?: boolean;
}

/** Sampler bank data from AI */
export interface AISamplerBankData {
  bankIndex: number; // 0-7
  steps: AINoteEvent[];
  params?: Partial<SamplerBankParams>;
  ttsText?: string;
  sampleUrl?: string;
  phonemePainter?: AIPhonemePainterConfig;
}

// ============================================================================
// HARMONIZER TYPES
// ============================================================================

/** Harmonizer configuration for vocal/synth tracks */
export interface AIHarmonizerConfig {
  enabled: boolean;
  voices: 2 | 3 | 4;
  harmonyType: 'octave' | 'fifth' | 'third' | 'seventh' | 'cluster' | 'custom';
  intervals?: number[];  // Semitones for custom
  formantShift: number;  // -12 to 12 semitones
  detune: number;        // -50 to 50 cents per voice
  spread: number;        // Stereo spread 0 to 100
}

// ============================================================================
// PHONEME PAINTER TYPES
// ============================================================================

/** Phoneme painter configuration for sampler TTS */
export interface AIPhonemePainterConfig {
  enabled: boolean;
  text: string;           // Lyric text
  phonemes?: string[];    // Explicit phoneme list
  mapping: AIPhonemeMapping[];
}

/** Phoneme to step mapping */
export interface AIPhonemeMapping {
  step: number;
  phoneme: string;
  pitch?: string;         // Note like "C4"
  duration?: number;      // Steps
}

// ============================================================================
// IMPORT RESULT TYPES
// ============================================================================

/** Import result with full report */
export interface AIImportResult {
  success: true;
  song: SavedSongData;
  report: AIImportReport;
}

/** Import error */
export interface AIImportError {
  success: false;
  error: AIImportErrorDetails;
}

export type AIImportErrorDetails =
  | { type: 'VALIDATION_ERROR'; field: string; message: string }
  | { type: 'UNSUPPORTED_VERSION'; version: string }
  | { type: 'CONVERSION_ERROR'; track: string; details: string }
  | { type: 'INVALID_NOTE'; note: string; track: string }
  | { type: 'STORAGE_ERROR'; message: string; storageError?: StorageError };

export type AIImportResultType = AIImportResult | AIImportError;

/** Detailed import report */
export interface AIImportReport {
  tracksConverted: number;
  notesConverted: number;
  warnings: string[];
  mappedParams: Array<{ source: string; target: string; value: unknown }>;
}

/** Upload result with storage metadata */
export interface AIUploadResult {
  success: true;
  id: string;
  url: string;
  publicUrl: string;
  timestamp: string;
  version: number;
  generator: string;
  metadata: AISongMetadata;
}

/** Upload error */
export interface AIUploadError {
  success: false;
  error: AIImportErrorDetails;
}

export type AIUploadResultType = AIUploadResult | AIUploadError;

// ============================================================================
// VALIDATION (Runtime type checking without external deps)
// ============================================================================

/** Valid automation targets */
const VALID_AUTOMATION_TARGETS: AIAutomationTarget[] = [
  'synthA', 'synthB', 'bass2', 'kick', 'snare',
  'closedHat', 'openHat', 'sampler', 'master'
];


/** Valid interpolation modes */
const VALID_INTERPOLATION_MODES: AIInterpolationMode[] = ['step', 'linear', 'smooth'];

/** Validate AISongData structure */
export function validateAISongData(data: unknown): { valid: true } | { valid: false; error: AIImportErrorDetails } {
  if (!data || typeof data !== 'object') {
    return { valid: false, error: { type: 'VALIDATION_ERROR', field: 'root', message: 'Data must be an object' } };
  }

  const song = data as Partial<AISongData>;

  // Check meta
  if (!song.meta || typeof song.meta !== 'object') {
    return { valid: false, error: { type: 'VALIDATION_ERROR', field: 'meta', message: 'meta object required' } };
  }
  if (!song.meta.title || typeof song.meta.title !== 'string') {
    return { valid: false, error: { type: 'VALIDATION_ERROR', field: 'meta.title', message: 'title string required' } };
  }
  if (song.meta.title.length > 100) {
    return { valid: false, error: { type: 'VALIDATION_ERROR', field: 'meta.title', message: 'title max 100 chars' } };
  }
  if (!isSupportedAISongVersion(song.meta.version)) {
    return { valid: false, error: { type: 'UNSUPPORTED_VERSION', version: song.meta.version || 'undefined' } };
  }
  // author / generator / prompt are required by the upload path, so they are
  // validated here too — the failure belongs in the import modal, not after
  // the user has already tried to save.
  for (const field of ['author', 'generator', 'prompt'] as const) {
    const value = song.meta[field];
    if (typeof value !== 'string' || value.trim().length === 0) {
      return {
        valid: false,
        error: { type: 'VALIDATION_ERROR', field: `meta.${field}`, message: `${field} string required` }
      };
    }
  }

  // Check globals
  if (!song.globals || typeof song.globals !== 'object') {
    return { valid: false, error: { type: 'VALIDATION_ERROR', field: 'globals', message: 'globals object required' } };
  }
  if (typeof song.globals.tempo !== 'number' || song.globals.tempo < 30 || song.globals.tempo > 300) {
    return { valid: false, error: { type: 'VALIDATION_ERROR', field: 'globals.tempo', message: 'tempo must be 30-300' } };
  }
  // timeSignature is optional at runtime (defaults to 4/4) so songs written
  // before it was applied still import, but a malformed one is an error rather
  // than something silently dropped.
  if (song.globals.timeSignature !== undefined) {
    const ts = song.globals.timeSignature;
    if (
      !Array.isArray(ts) || ts.length !== 2 ||
      !ts.every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 32)
    ) {
      return {
        valid: false,
        error: {
          type: 'VALIDATION_ERROR',
          field: 'globals.timeSignature',
          message: 'timeSignature must be [numerator, denominator], each an integer 1-32'
        }
      };
    }
  }
  if (song.globals.swing !== undefined) {
    if (typeof song.globals.swing !== 'number' || song.globals.swing < 0 || song.globals.swing > 100) {
      return { valid: false, error: { type: 'VALIDATION_ERROR', field: 'globals.swing', message: 'swing must be 0-100 (50 = straight)' } };
    }
  }

  if (song.meta.version === '1.0') {
    // v1.1 fields in a v1.0 file are a version mistake, not something to
    // half-apply: the file would import as one loop.
    for (const field of ['patterns', 'song'] as const) {
      if (song[field] !== undefined) {
        return versionFieldError(field);
      }
    }
    if (song.globals.stepCount !== undefined) {
      return versionFieldError('globals.stepCount');
    }

    // Check tracks exist
    if (!song.tracks || typeof song.tracks !== 'object') {
      return { valid: false, error: { type: 'VALIDATION_ERROR', field: 'tracks', message: 'tracks object required' } };
    }

    // Validate automation if present
    if (song.automation !== undefined) {
      const autoValidation = validateAutomation(
        song.automation,
        determinePatternLength(song.tracks),
        'automation',
        'pattern length',
      );
      if (!autoValidation.valid) {
        return autoValidation;
      }
    }

    return { valid: true };
  }

  return validateSongBlock(song as AISongData);
}

function versionFieldError(field: string): { valid: false; error: AIImportErrorDetails } {
  return {
    valid: false,
    error: { type: 'VALIDATION_ERROR', field, message: `${field} requires meta.version "1.1"` },
  };
}

function fieldError(field: string, message: string): { valid: false; error: AIImportErrorDetails } {
  return { valid: false, error: { type: 'VALIDATION_ERROR', field, message } };
}

/** Hyphon's song meter range (`utils/songMeter.ts` MIN_STEPS / MAX_STEPS). */
const MIN_STEP_COUNT = 1;
const MAX_STEP_COUNT = 64;

/**
 * v1.1 rules: `globals.stepCount`, `tracks` xor `patterns`, `song` rows that
 * name known patterns, at most 32 patterns per track, lanes `stepCount` long.
 */
function validateSongBlock(song: AISongData): { valid: true } | { valid: false; error: AIImportErrorDetails } {
  const { stepCount } = song.globals;
  if (
    stepCount !== undefined &&
    (typeof stepCount !== 'number' || !Number.isInteger(stepCount) ||
      stepCount < MIN_STEP_COUNT || stepCount > MAX_STEP_COUNT)
  ) {
    return fieldError(
      'globals.stepCount',
      `stepCount must be an integer ${MIN_STEP_COUNT}-${MAX_STEP_COUNT}`,
    );
  }
  const steps = songStepCount(song);
  const lengthLabel = 'globals.stepCount';

  if (song.tracks !== undefined && song.patterns !== undefined) {
    return fieldError('patterns', 'use either tracks (one pattern) or patterns, not both');
  }

  let patternIds: string[];
  if (song.patterns !== undefined) {
    if (!song.patterns || typeof song.patterns !== 'object' || Array.isArray(song.patterns)) {
      return fieldError('patterns', 'patterns must be an object keyed by pattern id');
    }
    patternIds = Object.keys(song.patterns);
    if (patternIds.length === 0) {
      return fieldError('patterns', 'patterns must define at least one pattern');
    }
    for (const id of patternIds) {
      const pattern = song.patterns[id] as Partial<AIPatternData> | null;
      const prefix = `patterns.${id}`;
      if (id.trim().length === 0) {
        return fieldError('patterns', 'pattern ids must be non-empty strings');
      }
      if (!pattern || typeof pattern !== 'object') {
        return fieldError(prefix, 'pattern must be an object');
      }
      if (!pattern.tracks || typeof pattern.tracks !== 'object') {
        return fieldError(`${prefix}.tracks`, 'tracks object required');
      }
      if (pattern.automation !== undefined) {
        const lanes = validateAutomation(pattern.automation, steps, `${prefix}.automation`, lengthLabel);
        if (!lanes.valid) return lanes;
      }
    }
    if (song.song === undefined) {
      return fieldError('song', 'song array required with patterns (one row per measure)');
    }
  } else {
    if (!song.tracks || typeof song.tracks !== 'object') {
      return fieldError('tracks', 'tracks or patterns object required');
    }
    patternIds = [DEFAULT_AI_PATTERN_ID];
  }

  if (song.automation !== undefined) {
    const lanes = validateAutomation(song.automation, steps, 'automation', lengthLabel);
    if (!lanes.valid) return lanes;
  }

  if (song.song !== undefined) {
    const rows = validateSongRows(song.song, new Set(patternIds));
    if (!rows.valid) return rows;
  }

  // A song-wide lane would always win over a pattern-local one on the same
  // parameter (the first lane with a value plays), so the pattern lane could
  // never be heard.
  if (song.patterns && song.automation?.length) {
    const songWide = new Map(song.automation.map((lane, i) => [`${lane.target}.${lane.parameter}`, i]));
    for (const id of patternIds) {
      const lanes = song.patterns[id].automation ?? [];
      for (let i = 0; i < lanes.length; i++) {
        const key = `${lanes[i].target}.${lanes[i].parameter}`;
        const shadow = songWide.get(key);
        if (shadow !== undefined) {
          return fieldError(
            `patterns.${id}.automation[${i}]`,
            `${key} is already automated song-wide by automation[${shadow}]`,
          );
        }
      }
    }
  }

  return { valid: true };
}

function validateSongRows(
  rows: unknown,
  patternIds: ReadonlySet<string>,
): { valid: true } | { valid: false; error: AIImportErrorDetails } {
  if (!Array.isArray(rows) || rows.length === 0) {
    return fieldError('song', 'song must be a non-empty array of rows');
  }
  const trackNames = new Set<string>(AI_SONG_TRACK_NAMES);
  const seen = new Map<string, Set<string>>();
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] as Record<string, unknown> | null;
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      return fieldError(`song[${r}]`, 'row must be an object of track → pattern id');
    }
    for (const [track, id] of Object.entries(row)) {
      const field = `song[${r}].${track}`;
      if (!trackNames.has(track)) {
        return fieldError(field, `Unknown track "${track}". Must be one of: ${AI_SONG_TRACK_NAMES.join(', ')}`);
      }
      if (id === null) continue;
      if (typeof id !== 'string' || !patternIds.has(id)) {
        return fieldError(
          field,
          `Unknown pattern id ${JSON.stringify(id)}. Defined: ${[...patternIds].join(', ')}`,
        );
      }
      const ids = seen.get(track) ?? new Set<string>();
      ids.add(id);
      seen.set(track, ids);
      if (ids.size > MAX_AI_PATTERNS_PER_TRACK) {
        return fieldError(
          field,
          `${track} uses more than ${MAX_AI_PATTERNS_PER_TRACK} distinct patterns (Hyphon has ${MAX_AI_PATTERNS_PER_TRACK} slots per track)`,
        );
      }
    }
  }
  return { valid: true };
}

/**
 * Validate automation lanes
 * @param automation - Array of automation lanes
 * @param expectedSteps - Steps every lane must have
 * @param path - Field path of the array, for error messages
 * @param lengthLabel - What `expectedSteps` came from, for error messages
 * @returns Validation result
 */
function validateAutomation(
  automation: unknown,
  expectedSteps: number,
  path: string,
  lengthLabel: string,
): { valid: true } | { valid: false; error: AIImportErrorDetails } {
  if (!Array.isArray(automation)) {
    return {
      valid: false,
      error: { type: 'VALIDATION_ERROR', field: path, message: `${path} must be an array` }
    };
  }

  for (let i = 0; i < automation.length; i++) {
    const lane = automation[i] as Partial<AIAutomationLane>;
    const lanePrefix = `${path}[${i}]`;

    // Check required fields
    if (!lane.target || !VALID_AUTOMATION_TARGETS.includes(lane.target as AIAutomationTarget)) {
      return {
        valid: false,
        error: {
          type: 'VALIDATION_ERROR',
          field: `${lanePrefix}.target`,
          message: `Invalid target "${lane.target}". Must be one of: ${VALID_AUTOMATION_TARGETS.join(', ')}`
        }
      };
    }

    const target = lane.target as AIAutomationTarget;

    if (!lane.parameter || !VALID_PARAMETERS_BY_TARGET[target].includes(lane.parameter as AITargetedParameter)) {
      return {
        valid: false,
        error: {
          type: 'VALIDATION_ERROR',
          field: `${lanePrefix}.parameter`,
          message: `Invalid parameter "${lane.parameter}" for target "${target}". Valid: ${VALID_PARAMETERS_BY_TARGET[target].join(', ')}`
        }
      };
    }

    // Validate steps array
    if (!Array.isArray(lane.steps)) {
      return {
        valid: false,
        error: { type: 'VALIDATION_ERROR', field: `${lanePrefix}.steps`, message: 'steps must be an array' }
      };
    }

    if (lane.steps.length !== expectedSteps) {
      return {
        valid: false,
        error: {
          type: 'VALIDATION_ERROR',
          field: `${lanePrefix}.steps`,
          message: `steps length (${lane.steps.length}) must match ${lengthLabel} (${expectedSteps})`
        }
      };
    }

    // Validate step values (0-127 or null)
    for (let s = 0; s < lane.steps.length; s++) {
      const value = lane.steps[s];
      if (value !== null && (typeof value !== 'number' || value < 0 || value > 127)) {
        return {
          valid: false,
          error: {
            type: 'VALIDATION_ERROR',
            field: `${lanePrefix}.steps[${s}]`,
            message: `Step values must be 0-127 or null, got ${value}`
          }
        };
      }
    }

    // Validate interpolation if provided
    if (lane.interpolation !== undefined && !VALID_INTERPOLATION_MODES.includes(lane.interpolation)) {
      return {
        valid: false,
        error: {
          type: 'VALIDATION_ERROR',
          field: `${lanePrefix}.interpolation`,
          message: `Invalid interpolation "${lane.interpolation}". Must be: step, linear, or smooth`
        }
      };
    }
  }

  return { valid: true };
}

/**
 * Determine pattern length from track data
 * @param tracks - Tracks object
 * @returns Pattern length (16 or 32)
 */
function determinePatternLength(tracks: AISongTracks): number {
  // Check drum tracks for length
  const drumTracks: (boolean[] | undefined)[] = [tracks.kick, tracks.snare, tracks.closedHat, tracks.openHat];
  for (const track of drumTracks) {
    if (track && track.length > 0) {
      return track.length <= 16 ? 16 : 32;
    }
  }
  // Default to 32 steps for Hyphon compatibility
  return 32;
}

/** Validate note format */
