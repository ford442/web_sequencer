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

import { noteToMidi } from '../../utils/musicTheory';
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
function validateAISongData(data: unknown): { valid: true } | { valid: false; error: AIImportErrorDetails } {
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
export function isValidNote(note: string): boolean {
  return /^[A-G][#b]?[0-8]$/.test(note);
}

// ============================================================================
// CONVERTER CLASS
// ============================================================================

/**
 * AI Song Importer
 * 
 * Usage:
 * ```typescript
 * const importer = new AISongImporter();
 * const result = importer.convert(aiSongData);
 * if (result.success) {
 *   loadSong(result.song);
 * }
 * 
 * // Upload to cloud
 * const uploadResult = await importer.uploadToCloud(aiSongData, result.song);
 * if (uploadResult.success) {
 *   console.log('Uploaded:', uploadResult.publicUrl);
 * }
 * ```
 */
export class AISongImporter {
  private warnings: string[] = [];
  private mappedParams: Array<{ source: string; target: string; value: unknown }> = [];

  /**
   * Main entry point: convert AISongData to SavedSongData
   * 
   * @param aiSong - The AI-generated song data
   * @returns AIImportResultType with converted song or error details
   */
  convert(aiSong: AISongData): AIImportResultType {
    this.warnings = [];
    this.mappedParams = [];

    // Validate input
    const validation = validateAISongData(aiSong);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    try {
      // Convert pattern
      const pattern = this.convertPattern(aiSong);

      // Convert params
      const params = this.convertParams(aiSong);

      // Convert effects (if present)
      const effects = this.convertEffects(aiSong);

      // Convert harmonizer configs
      const harmonizers = this.convertAllHarmonizers(aiSong);

      // Convert phoneme painter configs
      const phonemePainters = this.convertAllPhonemePainters(aiSong);

      // Build SavedSongData
      const song: SavedSongData = {
        version: 1,
        pattern,
        params,
        trackStorage: this.generateTrackStorage(pattern),
        activeTrackSlots: { partA: 0, partB: 0, bass2: 0, kick: 0, snare: 0, closedHat: 0, openHat: 0, sampler: 0 },
        songStructure: [],
        tempo: aiSong.globals.tempo,
        ambianceUrl: '',
        backgroundImage: ''
      };

      // Store effects data for DSP retrieval
      (song as HyphonSong).effects = effects;
      (song as HyphonSong).harmonizers = harmonizers;
      (song as HyphonSong).phonemePainters = phonemePainters;

      // Count converted elements
      const notesConverted = this.countNotes(aiSong);

      return {
        success: true,
        song,
        report: {
          tracksConverted: Object.keys(aiSong.tracks).length,
          notesConverted,
          warnings: this.warnings,
          mappedParams: this.mappedParams
        }
      };

    } catch (error) {
      return {
        success: false,
        error: {
          type: 'CONVERSION_ERROR',
          track: 'unknown',
          details: error instanceof Error ? error.message : 'Unknown conversion error'
        }
      };
    }
  }

  /**
   * Convert AI tracks to Hyphon Pattern
   */
  private convertPattern(aiSong: AISongData): Pattern {
    const numSteps = 32; // Hyphon uses 32 steps

    // Convert synth tracks
    const partA = aiSong.tracks.synthA 
      ? this.convertAITrack(aiSong.tracks.synthA, numSteps, 'synthA')
      : { steps: Array(numSteps).fill(null) };

    const partB = aiSong.tracks.synthB
      ? this.convertAITrack(aiSong.tracks.synthB, numSteps, 'synthB')
      : { steps: Array(numSteps).fill(null) };

    const bass2 = aiSong.tracks.bass2
      ? this.convertAITrack(aiSong.tracks.bass2, numSteps, 'bass2')
      : { steps: Array(numSteps).fill(null) };

    // Convert drum tracks
    const kick = this.convertDrumPattern(aiSong.tracks.kick, numSteps, 'C2');
    const snare = this.convertDrumPattern(aiSong.tracks.snare, numSteps, 'D2');
    const closedHat = this.convertDrumPattern(aiSong.tracks.closedHat, numSteps, 'F#2');
    const openHat = this.convertDrumPattern(aiSong.tracks.openHat, numSteps, 'A#2');

    // Convert sampler to PartSequence[] for Pattern
    const sampler = this.convertSamplerToSequences(aiSong.tracks.sampler, numSteps);

    return { partA, partB, bass2, kick, snare, closedHat, openHat, sampler };
  }

  /**
   * Convert AI track data to PartSequence
   */
  private convertAITrack(trackData: AITrackData, numSteps: number, trackName: string): PartSequence {
    const steps: (Note | null)[] = Array(numSteps).fill(null);

    for (const event of trackData.notes) {
      if (event.step < 0 || event.step >= numSteps) {
        this.warnings.push(`Note step ${event.step} out of range in ${trackName}`);
        continue;
      }

      if (!isValidNote(event.note)) {
        this.warnings.push(`Invalid note "${event.note}" in ${trackName}`);
        continue;
      }

      steps[event.step] = {
        note: event.note,
        velocity: event.velocity ?? 0.8,
        length: event.length ?? 1,
        slide: event.slide,
        timbre: event.accent ? 1.0 : 0.5
      };
    }

    return { steps };
  }

  /**
   * Convert boolean drum pattern to PartSequence
   */
  private convertDrumPattern(pattern: boolean[] | undefined, numSteps: number, defaultNote: string): PartSequence {
    const steps: (Note | null)[] = Array(numSteps).fill(null);

    if (!pattern) {
      return { steps };
    }

    // Extend 16-step patterns to 32 by duplicating
    const extendedPattern = pattern.length === 16 && numSteps === 32
      ? [...pattern, ...pattern]
      : pattern;

    for (let i = 0; i < extendedPattern.length && i < numSteps; i++) {
      if (extendedPattern[i]) {
        steps[i] = {
          note: defaultNote,
          velocity: 1.0,
          length: 1,
          timbre: 0.5
        };
      }
    }

    return { steps };
  }

  /**
   * Convert sampler bank data to PartSequence[] for Pattern
   */
  private convertSamplerToSequences(banks: AISamplerBankData[] | undefined, numSteps: number): PartSequence[] {
    // Create 8 sampler sequences (one per bank)
    const sequences: PartSequence[] = Array(8).fill(null).map(() => ({
      steps: Array(numSteps).fill(null) as (Note | null)[]
    }));

    if (!banks) {
      return sequences;
    }

    for (const bank of banks) {
      if (bank.bankIndex < 0 || bank.bankIndex > 7) {
        this.warnings.push(`Sampler bank index ${bank.bankIndex} out of range`);
        continue;
      }

      // Convert steps
      const steps: (Note | null)[] = Array(numSteps).fill(null);
      for (const event of bank.steps) {
        if (event.step >= 0 && event.step < numSteps) {
          steps[event.step] = {
            note: event.note,
            velocity: event.velocity ?? 0.8,
            length: event.length ?? 1
          };
        }
      }

      sequences[bank.bankIndex] = { steps };
    }

    return sequences;
  }

  /**
   * Convert sampler bank data to SamplerParams for SavedSongData['params']
   */
  private convertSamplerTracks(banks: AISamplerBankData[] | undefined, numSteps: number): SamplerParams {
    const sampler: SamplerParams = Array(8).fill(null).map(() => ({ 
      sampleName: 'empty',
      playbackSpeed: 1.0,
      volume: 1.0,
      filterCutoff: 20000,
      filterResonance: 0,
      drive: 0,
      delaySend: 0,
      steps: Array(numSteps).fill(null)
    }));

    if (!banks) {
      return sampler;
    }

    for (const bank of banks) {
      if (bank.bankIndex < 0 || bank.bankIndex > 7) {
        this.warnings.push(`Sampler bank index ${bank.bankIndex} out of range`);
        continue;
      }

      // Convert steps
      const steps: (Note | null)[] = Array(numSteps).fill(null);
      for (const event of bank.steps) {
        if (event.step >= 0 && event.step < numSteps) {
          steps[event.step] = {
            note: event.note,
            velocity: event.velocity ?? 0.8,
            length: event.length ?? 1
          };
        }
      }

      sampler[bank.bankIndex] = {
        ...sampler[bank.bankIndex],
        ...bank.params,
        sampleName: bank.ttsText || bank.sampleUrl || `bank_${bank.bankIndex}`,
        steps
      };
    }

    return sampler;
  }

  /**
   * Convert AI params to Hyphon params
   */
  private convertParams(aiSong: AISongData): SavedSongData['params'] {
    const defaultSynth: SynthParams = {
      waveform: '303-saw',
      pitch: 0,
      filterCutoff: 3000,
      filterResonance: 8,
      filterMode: 1,
      attack: 0.01,
      decay: 0.3,
      sustain: 0.5,
      release: 0.3,
      length: 0.25,
      volume: 0.9,
      delayTime: 0.3,
      delayFeedback: 0.2,
      delayMix: 0.0
    };

    const mapSynthParams = (trackData?: AITrackData): SynthParams => {
      if (!trackData?.params) return defaultSynth;
      
      this.mappedParams.push({
        source: 'AI.params',
        target: 'SynthParams',
        value: trackData.params
      });

      return { ...defaultSynth, ...trackData.params };
    };

    const mapBass2Params = (trackData?: AITrackData): Bass2Params => {
      const synth = mapSynthParams(trackData);
      return {
        waveform: synth.waveform === '303-sqr' ? 1 : 0,
        pitch: synth.pitch,
        cutoff: synth.filterCutoff,
        resonance: synth.filterResonance,
        filterMode: synth.filterMode ?? 1,
        decay: synth.decay,
        accent: 0.7,
        envMod: 0.5,
        volume: synth.volume
      };
    };

    return {
      synthA: mapSynthParams(aiSong.tracks.synthA),
      synthB: mapSynthParams(aiSong.tracks.synthB),
      kick: { pitch: 60, decay: 0.4, tone: 0.6, volume: 1.0 },
      snare: { decay: 0.3, tone: 250, noise: 3000, volume: 0.9 },
      closedHat: { pitch: 10000, decay: 0.1, volume: 0.8 },
      openHat: { pitch: 8000, decay: 0.4, volume: 0.8 },
      sampler: this.convertSamplerTracks(aiSong.tracks.sampler, 32)
    };
  }

  /**
   * Generate track storage from pattern
   */
  private generateTrackStorage(pattern: Pattern): Record<string, unknown> {
    return {
      partA: Array(8).fill(null).map((_, i) => i === 0 ? pattern.partA : null),
      partB: Array(8).fill(null).map((_, i) => i === 0 ? pattern.partB : null),
      bass2: Array(8).fill(null).map((_, i) => i === 0 ? pattern.bass2 : null),
      kick: Array(8).fill(null).map((_, i) => i === 0 ? pattern.kick : null),
      snare: Array(8).fill(null).map((_, i) => i === 0 ? pattern.snare : null),
      closedHat: Array(8).fill(null).map((_, i) => i === 0 ? pattern.closedHat : null),
      openHat: Array(8).fill(null).map((_, i) => i === 0 ? pattern.openHat : null),
      sampler: Array(8).fill(null).map((_, i) => i === 0 ? pattern.sampler : null)
    };
  }

  /**
   * Count total notes in AI song
   */
  private countNotes(aiSong: AISongData): number {
    let count = 0;
    if (aiSong.tracks.synthA) count += aiSong.tracks.synthA.notes.length;
    if (aiSong.tracks.synthB) count += aiSong.tracks.synthB.notes.length;
    if (aiSong.tracks.bass2) count += aiSong.tracks.bass2.notes.length;
    if (aiSong.tracks.sampler) {
      for (const bank of aiSong.tracks.sampler) {
        count += bank.steps.length;
      }
    }
    return count;
  }

  /**
   * Convert AI automation lanes to Hyphon automation format.
   * 
   * Maps per-step automation values to the Hyphon automation system.
   * Each non-null step value creates an automation point.
   * 
   * @param aiSong - The AI song data containing automation lanes
   * @returns Array of KnobAutomation-compatible objects for Hyphon
   * 
   * @example
   * ```typescript
   * const automation = this.convertAutomation(aiSong);
   * // Returns: [{ paramId: 'filterCutoff', trackKey: 'partA', points: [...], isRecording: false }]
   * ```
   */
  convertAutomation(aiSong: AISongData): Array<{
    paramId: string;
    trackKey: string;
    points: AutomationPoint[];
    isRecording: boolean;
    interpolation: AIInterpolationMode;
  }> {
    if (!aiSong.automation || aiSong.automation.length === 0) {
      return [];
    }

    const results: ReturnType<typeof this.convertAutomation> = [];

    for (const lane of aiSong.automation) {
      // Map AI target to Hyphon track key
      const trackKey = this.mapAutomationTargetToTrackKey(lane.target);
      
      // Convert steps to automation points
      const points: AutomationPoint[] = [];
      
      for (let step = 0; step < lane.steps.length; step++) {
        const value = lane.steps[step];
        if (value !== null) {
          // Convert 0-127 to 0-1 range for Hyphon
          points.push({
            step,
            value: value / 127
          });
        }
      }

      // Only add if we have automation points
      if (points.length > 0) {
        results.push({
          paramId: lane.parameter,
          trackKey,
          points,
          isRecording: false,
          interpolation: lane.interpolation || 'step'
        });

        this.mappedParams.push({
          source: `automation.${lane.target}.${lane.parameter}`,
          target: `${trackKey}.${lane.parameter}`,
          value: `${points.length} points`
        });
      }
    }

    return results;
  }

  /**
   * Map AI automation target to Hyphon track key
   * @param target - AI automation target
   * @returns Hyphon track key
   */
  private mapAutomationTargetToTrackKey(target: AIAutomationTarget): string {
    const mapping: Record<AIAutomationTarget, string> = {
      synthA: 'partA',
      synthB: 'partB',
      bass2: 'bass2',
      kick: 'kick',
      snare: 'snare',
      closedHat: 'closedHat',
      openHat: 'openHat',
      sampler: 'sampler',
      master: 'master'
    };
    return mapping[target];
  }

  /**
   * Get automation summary for display purposes.
   * Returns a human-readable summary of automation lanes.
   * 
   * @param aiSong - The AI song data
   * @returns Summary object with lane count and details
   */
  getAutomationSummary(aiSong: AISongData): {
    laneCount: number;
    lanes: Array<{
      target: string;
      parameter: string;
      pointCount: number;
      interpolation: AIInterpolationMode;
    }>;
  } {
    if (!aiSong.automation) {
      return { laneCount: 0, lanes: [] };
    }

    return {
      laneCount: aiSong.automation.length,
      lanes: aiSong.automation.map(lane => ({
        target: lane.target,
        parameter: lane.parameter,
        pointCount: lane.steps.filter(s => s !== null).length,
        interpolation: lane.interpolation || 'step'
      }))
    };
  }

  // ============================================================================
  // EFFECTS CONVERSION METHODS
  // ============================================================================

  /**
   * Convert AI effects chain to Hyphon DSP parameters
   * Maps AI-generated effects to existing Hyphon effect parameters
   */
  convertEffects(aiSong: AISongData): HyphonEffectsData {
    const effects: HyphonEffectsData = {
      master: {},
      tracks: {}
    };

    if (!aiSong.effects) {
      return effects;
    }

    // Convert master effects
    if (aiSong.effects.master) {
      effects.master = this.convertMasterEffects(aiSong.effects.master);
    }

    // Convert track effects
    if (aiSong.effects.tracks) {
      for (const [trackKey, trackEffects] of Object.entries(aiSong.effects.tracks)) {
        if (trackEffects) {
          effects.tracks[trackKey as TrackKey] = this.convertTrackEffects(trackEffects);
        }
      }
    }

    this.mappedParams.push({
      source: 'AI.effects',
      target: 'HyphonEffectsData',
      value: effects
    });

    return effects;
  }

  /**
   * Convert master bus effects
   */
  private convertMasterEffects(master: AIMasterEffects): HyphonMasterEffects {
    const result: HyphonMasterEffects = {};

    if (master.compressor) {
      result.compressor = {
        threshold: this.clamp(master.compressor.threshold, -60, 0),
        ratio: this.clamp(master.compressor.ratio, 1, 20),
        attack: this.clamp(master.compressor.attack, 0.1, 100),
        release: this.clamp(master.compressor.release, 10, 1000),
        makeupGain: master.compressor.makeupGain ?? 0
      };
    }

    if (master.limiter) {
      result.limiter = { enabled: true };
    }

    if (master.reverb) {
      result.reverb = {
        size: this.clamp(master.reverb.size, 0, 100),
        decay: this.clamp(master.reverb.decay, 0.1, 10),
        mix: this.clamp(master.reverb.mix, 0, 100),
        preDelay: this.clamp(master.reverb.preDelay ?? 0, 0, 100)
      };
    }

    return result;
  }

  /**
   * Convert track-specific effects
   */
  private convertTrackEffects(trackEffects: AITrackEffects): HyphonTrackEffects {
    const result: HyphonTrackEffects = {};

    if (trackEffects.distortion) {
      result.distortion = {
        type: trackEffects.distortion.type,
        amount: this.clamp(trackEffects.distortion.amount, 0, 100),
        tone: this.clamp(trackEffects.distortion.tone ?? 0, -50, 50)
      };
    }

    if (trackEffects.delay) {
      result.delay = {
        time: trackEffects.delay.time,
        feedback: this.clamp(trackEffects.delay.feedback, 0, 100),
        mix: this.clamp(trackEffects.delay.mix, 0, 100),
        pingPong: trackEffects.delay.pingPong ?? false
      };
    }

    if (trackEffects.filter) {
      result.filter = {
        type: trackEffects.filter.type,
        cutoff: this.clamp(trackEffects.filter.cutoff, 20, 20000),
        resonance: this.clamp(trackEffects.filter.resonance, 0, 100),
        envelope: this.clamp(trackEffects.filter.envelope ?? 0, -100, 100)
      };
    }

    if (trackEffects.chorus) {
      result.chorus = {
        rate: this.clamp(trackEffects.chorus.rate, 0.1, 10),
        depth: this.clamp(trackEffects.chorus.depth, 0, 100),
        mix: this.clamp(trackEffects.chorus.mix, 0, 100)
      };
    }

    if (trackEffects.phaser) {
      result.phaser = {
        rate: this.clamp(trackEffects.phaser.rate, 0.1, 10),
        depth: this.clamp(trackEffects.phaser.depth, 0, 100),
        feedback: this.clamp(trackEffects.phaser.feedback, 0, 100),
        stages: this.validatePhaserStages(trackEffects.phaser.stages)
      };
    }

    return result;
  }

  /**
   * Convert harmonizer configuration
   */
  convertHarmonizer(trackData: AITrackData): AIHarmonizerConfig | null {
    if (!trackData.harmonizer?.enabled) {
      return null;
    }

    const config = trackData.harmonizer;

    // Validate and clamp values
    return {
      enabled: true,
      voices: this.validateHarmonizerVoices(config.voices),
      harmonyType: config.harmonyType,
      intervals: config.intervals,
      formantShift: this.clamp(config.formantShift, -12, 12),
      detune: this.clamp(config.detune, -50, 50),
      spread: this.clamp(config.spread, 0, 100)
    };
  }

  /**
   * Convert phoneme painter configuration
   */
  convertPhonemePainter(bankData: AISamplerBankData): AIPhonemePainterConfig | null {
    if (!bankData.phonemePainter?.enabled) {
      return null;
    }

    const config = bankData.phonemePainter;

    // Validate mappings
    const validMappings = config.mapping.filter(m => 
      typeof m.step === 'number' && 
      m.step >= 0 && 
      m.step < 32 &&
      typeof m.phoneme === 'string' &&
      m.phoneme.length > 0
    );

    if (validMappings.length === 0) {
      this.warnings.push(`Phoneme painter enabled but no valid mappings for bank ${bankData.bankIndex}`);
      return null;
    }

    return {
      enabled: true,
      text: config.text,
      phonemes: config.phonemes,
      mapping: validMappings
    };
  }

  // ============================================================================
  // HARMONIZER & PHONEME PAINTER CONVERSION HELPERS
  // ============================================================================

  /**
   * Convert harmonizer configs for all tracks
   */
  private convertAllHarmonizers(aiSong: AISongData): Partial<Record<TrackKey, AIHarmonizerConfig>> {
    const harmonizers: Partial<Record<TrackKey, AIHarmonizerConfig>> = {};

    if (aiSong.tracks.synthA?.harmonizer) {
      const config = this.convertHarmonizer(aiSong.tracks.synthA);
      if (config) harmonizers.synthA = config;
    }

    if (aiSong.tracks.synthB?.harmonizer) {
      const config = this.convertHarmonizer(aiSong.tracks.synthB);
      if (config) harmonizers.synthB = config;
    }

    if (aiSong.tracks.bass2?.harmonizer) {
      const config = this.convertHarmonizer(aiSong.tracks.bass2);
      if (config) harmonizers.bass2 = config;
    }

    return harmonizers;
  }

  /**
   * Convert phoneme painter configs for all sampler banks
   */
  private convertAllPhonemePainters(aiSong: AISongData): Record<number, AIPhonemePainterConfig> {
    const painters: Record<number, AIPhonemePainterConfig> = {};

    if (aiSong.tracks.sampler) {
      for (const bank of aiSong.tracks.sampler) {
        const config = this.convertPhonemePainter(bank);
        if (config) {
          painters[bank.bankIndex] = config;
        }
      }
    }

    return painters;
  }

  // ============================================================================
  // VALIDATION HELPERS
  // ============================================================================

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  private validateHarmonizerVoices(voices: number): 2 | 3 | 4 {
    if (voices === 2 || voices === 3 || voices === 4) {
      return voices;
    }
    return 3; // Default to 3 voices
  }

  private validatePhaserStages(stages?: number): 2 | 4 | 6 | 8 | 12 {
    const validStages: (2 | 4 | 6 | 8 | 12)[] = [2, 4, 6, 8, 12];
    if (stages && validStages.includes(stages as 2 | 4 | 6 | 8 | 12)) {
      return stages as 2 | 4 | 6 | 8 | 12;
    }
    return 4; // Default
  }

  /**
   * Upload AI song to Hugging Face storage using AISongStorage
   * 
   * @param aiSong - Original AI song data
   * @param hyphonSong - Converted Hyphon song data
   * @param options - Optional upload options (folder, tags)
   * @returns AIUploadResultType with upload metadata or error
   * 
   * @example
   * ```typescript
   * const result = await importer.uploadToCloud(aiData, hyphonSong, {
   *   folder: 'my-songs',
   *   tags: ['funky', 'bass']
   * });
   * 
   * if (result.success) {
   *   console.log('Uploaded:', result.publicUrl);
   * } else {
   *   console.error('Upload failed:', result.error);
   *   if (result.error.storageError?.retryable) {
   *     // Can retry
   *   }
   * }
   * ```
   */
  async uploadToCloud(
    aiSong: AISongData,
    hyphonSong: SavedSongData,
    options?: AISongUploadOptions
  ): Promise<AIUploadResultType> {
    console.log('[AISongImporter] Uploading to cloud storage...');
    
    const result = await AISongStorage.uploadAISong(aiSong, hyphonSong, options);
    
    if (!result.success || !result.data) {
      console.error('[AISongImporter] Upload failed:', result.error);
      return {
        success: false,
        error: {
          type: 'STORAGE_ERROR',
          message: result.error?.message || 'Upload failed',
          storageError: result.error
        }
      };
    }
    
    console.log('[AISongImporter] Upload successful:', result.data.id);
    
    // Fetch metadata for the uploaded song
    const metadataResult = await AISongStorage.getAISong(result.data.id);
    
    return {
      success: true,
      id: result.data.id,
      url: result.data.url,
      publicUrl: result.data.publicUrl,
      timestamp: result.data.timestamp,
      version: result.data.version,
      generator: result.data.generator,
      metadata: metadataResult.success && metadataResult.data 
        ? metadataResult.data.metadata 
        : {
            id: result.data.id,
            name: aiSong.meta.title,
            author: aiSong.meta.author,
            date: result.data.timestamp,
            type: 'ai-generated',
            generator: result.data.generator,
            prompt: aiSong.meta.prompt,
            version: result.data.version,
            aiTags: [result.data.generator, 'ai-generated', ...(aiSong.meta.tags || [])]
          }
    };
  }

  /**
   * Check for duplicate songs before uploading
   * 
   * @param aiSong - AI song data to check
   * @returns Whether a duplicate exists and its ID
   * 
   * @example
   * ```typescript
   * const duplicate = await importer.checkDuplicate(aiSong);
   * if (duplicate.exists) {
   *   // Prompt user to overwrite or create new version
   * }
   * ```
   */
  async checkDuplicate(aiSong: AISongData): Promise<{ exists: boolean; id?: string; song?: AISongMetadata }> {
    const result = await AISongStorage.checkDuplicate(aiSong.meta.title, aiSong.meta.author);
    
    if (result.success && result.data) {
      return {
        exists: result.data.exists,
        id: result.data.id,
        song: result.data.song
      };
    }
    
    return { exists: false };
  }

  /**
   * Get import warnings from the last conversion
   */
  getWarnings(): string[] {
    return [...this.warnings];
  }

  /**
   * Get mapped params from the last conversion
   */
  getMappedParams(): Array<{ source: string; target: string; value: unknown }> {
    return [...this.mappedParams];
  }
}

/**
 * Convenience function for direct conversion
 * 
 * @param aiSong - AI-generated song data
 * @returns Conversion result with Hyphon song or error
 * 
 * @example
 * ```typescript
 * const result = convertAISong(aiData);
 * if (result.success) {
 *   loadSong(result.song);
 * }
 * ```
 */
export function convertAISong(aiSong: AISongData): AIImportResultType {
  const importer = new AISongImporter();
  return importer.convert(aiSong);
}

/**
 * Parse and validate JSON string
 * 
 * @param jsonString - JSON string to parse
 * @returns Parse result with AISongData or error message
 * 
 * @example
 * ```typescript
 * const parsed = parseAISongJSON(jsonString);
 * if (parsed.success) {
 *   const result = convertAISong(parsed.data);
 * }
 * ```
 */
export function parseAISongJSON(jsonString: string): { 
  success: true; 
  data: AISongData 
} | { 
  success: false; 
  error: string 
} {
  try {
    const parsed = JSON.parse(jsonString);
    return { success: true, data: parsed };
  } catch (error) {
    return { 
      success: false, 
      error: `Invalid JSON: ${error instanceof Error ? error.message : 'Parse error'}` 
    };
  }
}

/**
 * Upload AI song directly without conversion
 * 
 * @param aiSong - Original AI song data
 * @param hyphonSong - Converted Hyphon song data
 * @param options - Upload options
 * @returns Upload result with metadata
 * 
 * @example
 * ```typescript
 * const result = await uploadAISong(aiData, hyphonData);
 * if (result.success) {
 *   console.log('Public URL:', result.publicUrl);
 * }
 * ```
 */
export async function uploadAISong(
  aiSong: AISongData,
  hyphonSong: SavedSongData,
  options?: AISongUploadOptions
): Promise<AIUploadResultType> {
  const importer = new AISongImporter();
  return importer.uploadToCloud(aiSong, hyphonSong, options);
}

export default AISongImporter;
