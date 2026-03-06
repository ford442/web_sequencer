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
  TrackKey
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
}

/** Single track data from AI */
export interface AITrackData {
  notes: AINoteEvent[];
  params?: Partial<SynthParams>;
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

  return { valid: true };
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

    // Convert sampler
    const sampler = this.convertSamplerTracks(aiSong.tracks.sampler, numSteps);

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
   * Convert sampler bank data
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
