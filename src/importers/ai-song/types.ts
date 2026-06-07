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

/**
 * Standard format for AI-generated songs.
 * Designed to be simple for AIs to generate while being unambiguous to parse.
 */
export interface AISongData {
  /** Metadata about the song and generation */
  meta: {
    title: string;
    author: string;
    version: "1.0";
    createdAt: string; // ISO 8601
    generator: string; // "claude-3-opus" | "gemini-pro" | "jules" | "copilot" | etc.
    prompt: string;
    tags?: string[];
  };

  /** Global song settings */
  globals: {
    tempo: number; // BPM (30-300)
    timeSignature: [number, number]; // [4, 4], [3, 4], etc.
    swing?: number; // 0-100 (50 = no swing)
  };

  /** Track patterns */
  tracks: {
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
  };

  /** Optional automation lanes for parameter changes */
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
// EFFECTS TYPES
// ============================================================================

/** Complete effects chain configuration */
export interface AIEffectsChain {
  /** Master effects applied to the mix */
  master?: AIMasterEffects;
  /** Per-track effects */
  tracks?: Partial<Record<TrackKey, AITrackEffects>>;
}

/** Master bus effects */
export interface AIMasterEffects {
  compressor?: AICompressorSettings;
  limiter?: boolean;
  reverb?: AIReverbSettings;
}

/** Per-track effects */
export interface AITrackEffects {
  distortion?: AIDistortionSettings;
  delay?: AIDelaySettings;
  filter?: AIFilterSettings;
  chorus?: AIChorusSettings;
  phaser?: AIPhaserSettings;
}

/** Compressor settings */
export interface AICompressorSettings {
  threshold: number;  // -60 to 0 dB
  ratio: number;      // 1 to 20
  attack: number;     // 0.1 to 100 ms
  release: number;    // 10 to 1000 ms
  makeupGain?: number;
}

/** Distortion settings */
export interface AIDistortionSettings {
  type: 'soft' | 'hard' | 'tube' | 'bitcrush';
  amount: number;     // 0 to 100
  tone?: number;      // -50 to 50 (filter)
}

/** Delay settings */
export interface AIDelaySettings {
  time: number;       // 1/32 to 2 bars in ms or note values
  feedback: number;   // 0 to 100%
  mix: number;        // 0 to 100%
  pingPong?: boolean;
}

/** Reverb settings */
export interface AIReverbSettings {
  size: number;       // 0 to 100 (room size)
  decay: number;      // 0.1 to 10 seconds
  mix: number;        // 0 to 100%
  preDelay?: number;  // 0 to 100 ms
}

/** Filter settings */
export interface AIFilterSettings {
  type: 'lowpass' | 'highpass' | 'bandpass' | 'notch';
  cutoff: number;     // 20 to 20000 Hz
  resonance: number;  // 0 to 100
  envelope?: number;  // -100 to 100 (env amount)
}

/** Chorus settings */
export interface AIChorusSettings {
  rate: number;       // 0.1 to 10 Hz
  depth: number;      // 0 to 100%
  mix: number;        // 0 to 100%
}

/** Phaser settings */
export interface AIPhaserSettings {
  rate: number;       // 0.1 to 10 Hz
  depth: number;      // 0 to 100%
  feedback: number;   // 0 to 100%
  stages?: number;    // 2, 4, 6, 8, 12
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
// EXTENDED SONG TYPE (for effects storage)
// ============================================================================

/** Extended SavedSongData with effects for DSP chain integration */
export interface HyphonSong extends SavedSongData {
  /** Effects data for DSP chain */
  effects?: HyphonEffectsData;
  /** Harmonizer configurations per track */
  harmonizers?: Partial<Record<TrackKey, AIHarmonizerConfig>>;
  /** Phoneme painter configurations per sampler bank */
  phonemePainters?: Record<number, AIPhonemePainterConfig>;
}

// ============================================================================
// HYPHON EFFECTS DATA TYPES (Internal DSP representation)
// ============================================================================

/** Internal representation of converted effects for Hyphon DSP */
export interface HyphonEffectsData {
  master: HyphonMasterEffects;
  tracks: Partial<Record<TrackKey, HyphonTrackEffects>>;
}

/** Converted master effects */
export interface HyphonMasterEffects {
  compressor?: {
    threshold: number;
    ratio: number;
    attack: number;
    release: number;
    makeupGain: number;
  };
  limiter?: { enabled: boolean };
  reverb?: {
    size: number;
    decay: number;
    mix: number;
    preDelay: number;
  };
}

/** Converted track effects */
export interface HyphonTrackEffects {
  distortion?: {
    type: 'soft' | 'hard' | 'tube' | 'bitcrush';
    amount: number;
    tone: number;
  };
  delay?: {
    time: number;
    feedback: number;
    mix: number;
    pingPong: boolean;
  };
  filter?: {
    type: 'lowpass' | 'highpass' | 'bandpass' | 'notch';
    cutoff: number;
    resonance: number;
    envelope: number;
  };
  chorus?: {
    rate: number;
    depth: number;
    mix: number;
  };
  phaser?: {
    rate: number;
    depth: number;
    feedback: number;
    stages: 2 | 4 | 6 | 8 | 12;
  };
}

// ============================================================================
// VALIDATION (Runtime type checking without external deps)
// ============================================================================

/** Valid automation targets */
const VALID_AUTOMATION_TARGETS: AIAutomationTarget[] = [
  'synthA', 'synthB', 'bass2', 'kick', 'snare',
  'closedHat', 'openHat', 'sampler', 'master'
];

/** Valid parameters for each target */
const VALID_PARAMETERS_BY_TARGET: Record<AIAutomationTarget, AITargetedParameter[]> = {
  synthA: ['filterCutoff', 'filterResonance', 'filterMode', 'decay', 'accent', 'envMod', 'waveform', 'pitch', 'volume', 'drive', 'delayTime', 'delayFeedback', 'delayMix'],
  synthB: ['filterCutoff', 'filterResonance', 'filterMode', 'decay', 'accent', 'envMod', 'waveform', 'pitch', 'volume', 'drive', 'delayTime', 'delayFeedback', 'delayMix'],
  bass2: ['filterCutoff', 'filterResonance', 'filterMode', 'decay', 'accent', 'envMod', 'waveform', 'pitch', 'volume', 'drive'],
  kick: ['pitch', 'decay', 'tone', 'volume'],
  snare: ['decay', 'tone', 'noise', 'volume'],
  closedHat: ['pitch', 'decay', 'volume'],
  openHat: ['pitch', 'decay', 'volume'],
  sampler: ['filterCutoff', 'filterResonance', 'drive', 'volume', 'playbackSpeed'],
  master: ['tempo', 'swing', 'masterVolume']
};

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
  if (song.meta.version !== "1.0") {
    return { valid: false, error: { type: 'UNSUPPORTED_VERSION', version: song.meta.version || 'undefined' } };
  }

  // Check globals
  if (!song.globals || typeof song.globals !== 'object') {
    return { valid: false, error: { type: 'VALIDATION_ERROR', field: 'globals', message: 'globals object required' } };
  }
  if (typeof song.globals.tempo !== 'number' || song.globals.tempo < 30 || song.globals.tempo > 300) {
    return { valid: false, error: { type: 'VALIDATION_ERROR', field: 'globals.tempo', message: 'tempo must be 30-300' } };
  }

  // Check tracks exist
  if (!song.tracks || typeof song.tracks !== 'object') {
    return { valid: false, error: { type: 'VALIDATION_ERROR', field: 'tracks', message: 'tracks object required' } };
  }

  // Validate automation if present
  if (song.automation !== undefined) {
    const autoValidation = validateAutomation(song.automation, song.tracks);
    if (!autoValidation.valid) {
      return autoValidation;
    }
  }

  return { valid: true };
}

/**
 * Validate automation lanes
 * @param automation - Array of automation lanes
 * @param tracks - Tracks object to determine pattern length
 * @returns Validation result
 */
function validateAutomation(
  automation: unknown[],
  tracks: AISongData['tracks']
): { valid: true } | { valid: false; error: AIImportErrorDetails } {
  if (!Array.isArray(automation)) {
    return {
      valid: false,
      error: { type: 'VALIDATION_ERROR', field: 'automation', message: 'automation must be an array' }
    };
  }

  // Determine expected step count from tracks (default to 32)
  const expectedSteps = determinePatternLength(tracks);

  for (let i = 0; i < automation.length; i++) {
    const lane = automation[i] as Partial<AIAutomationLane>;
    const lanePrefix = `automation[${i}]`;

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
          message: `steps length (${lane.steps.length}) must match pattern length (${expectedSteps})`
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
function determinePatternLength(tracks: AISongData['tracks']): number {
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
