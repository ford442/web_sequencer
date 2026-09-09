import type {
  SavedSongData, Pattern, PartSequence, Note, SynthParams, Bass2Params,
  SamplerParams, AutomationPoint, UnifiedAutomationLane, AutomationTarget
} from '../../types';
import { generateLaneId } from '../../stores/automationStore';
import { AISongStorage, type AISongUploadOptions, type AISongMetadata } from '../../services/AISongStorage';
import { validateAISongData } from './types';
import {
  type AISongData, type AIImportResultType, type AIAutomationTarget,
  type AIInterpolationMode, type AITrackData, type AISamplerBankData,
  type AIHarmonizerConfig, type AIPhonemePainterConfig, type AIUploadResultType
} from './types';

/** Time signature applied when a song does not declare one. */
const DEFAULT_TIME_SIGNATURE: [number, number] = [4, 4];

/** Swing applied when a song does not declare one (50 = straight). */
const DEFAULT_SWING = 50;

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

      // Convert automation lanes into the unified store format
      const automationLanes = this.buildAutomationLanes(aiSong);

      // Build SavedSongData
      const song: SavedSongData = {
        version: 1,
        pattern,
        params,
        trackStorage: this.generateTrackStorage(pattern),
        activeTrackSlots: { partA: 0, partB: 0, bass2: 0, kick: 0, snare: 0, closedHat: 0, openHat: 0, sampler: 0 },
        songStructure: [],
        tempo: aiSong.globals.tempo,
        timeSignature: aiSong.globals.timeSignature ?? DEFAULT_TIME_SIGNATURE,
        swing: aiSong.globals.swing ?? DEFAULT_SWING,
        ambianceUrl: '',
        backgroundImage: '',
        ...(automationLanes.length > 0 ? { automationLanes } : {})
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
  private convertSamplerTracks(banks: AISamplerBankData[] | undefined): SamplerParams {
    const sampler: SamplerParams = Array.from({ length: 8 }, () => ({
      sampleName: 'empty',
      playbackSpeed: 1.0,
      volume: 1.0,
      filterCutoff: 20000,
      filterResonance: 0,
      drive: 0,
      delaySend: 0
    }));

    if (!banks) {
      return sampler;
    }

    for (const bank of banks) {
      if (bank.bankIndex < 0 || bank.bankIndex > 7) {
        this.warnings.push(`Sampler bank index ${bank.bankIndex} out of range`);
        continue;
      }

      // Note steps live on the Pattern (see convertSamplerToSequences);
      // SamplerBankParams carries voice settings only.
      sampler[bank.bankIndex] = {
        ...sampler[bank.bankIndex],
        ...bank.params,
        sampleName: bank.ttsText || bank.sampleUrl || `bank_${bank.bankIndex}`
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
        waveform: synth.waveform === '303-sqr' ? '303-sqr' : '303-saw',
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
      bass2: mapBass2Params(aiSong.tracks.bass2),
      kick: { pitch: 60, decay: 0.4, tone: 0.6, volume: 1.0 },
      snare: { decay: 0.3, tone: 250, noise: 3000, volume: 0.9 },
      closedHat: { pitch: 10000, decay: 0.1, volume: 0.8 },
      openHat: { pitch: 8000, decay: 0.4, volume: 0.8 },
      sampler: this.convertSamplerTracks(aiSong.tracks.sampler)
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
    target: AIAutomationTarget;
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
          // Convert 0-127 to 0-1 range for Hyphon.
          // AutomationLanePoint.value is normalized to [0, 1] for every lane
          // source; clamp so a lane can never break that invariant.
          points.push({
            step,
            value: Math.max(0, Math.min(1, value / 127))
          });
        }
      }

      // Only add if we have automation points
      if (points.length > 0) {
        results.push({
          paramId: lane.parameter,
          target: lane.target,
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
   * Build store-ready automation lanes from the AI song.
   *
   * Wraps {@link convertAutomation} in the `UnifiedAutomationLane` shape that
   * `SavedSongData.automationLanes` carries, so lanes survive the save/load
   * round trip and reach `automationStore.importLanes` on import.
   *
   * The AI target vocabulary (`synthA`, `master`, …) is already the
   * `AutomationTarget` vocabulary, so targets pass through unmapped — the
   * `partA`/`partB` track keys from {@link mapAutomationTargetToTrackKey} are
   * for the legacy KnobAutomation shape, not for the store.
   *
   * @param aiSong - The AI song data containing automation lanes
   * @returns Lanes whose point values are normalized to [0, 1]
   */
  private buildAutomationLanes(aiSong: AISongData): UnifiedAutomationLane[] {
    return this.convertAutomation(aiSong).map((converted) => ({
      id: generateLaneId(),
      target: converted.target as AutomationTarget,
      parameter: converted.paramId,
      name: `${converted.target} ${converted.paramId}`,
      points: converted.points.map((point) => ({ step: point.step, value: point.value })),
      interpolation: converted.interpolation,
      source: 'ai' as const,
      scope: 'song' as const,
      enabled: true,
      // Display metadata only: the AI format expresses lane values as MIDI
      // 0-127, while `points[].value` above is already normalized.
      originalRange: [0, 127] as [number, number],
    }));
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
