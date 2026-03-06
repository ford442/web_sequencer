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
 */

import type { 
  RawRbsData, 
  HyphonSong, 
  RbsImportOptions, 
  DEFAULT_RBS_IMPORT_OPTIONS,
  Tb303Step 
} from './types';

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

/** Import result with detailed reporting */
export interface RbsImportResult {
  success: true;
  song: HyphonSong;
  report: ImportReport;
}

export interface ImportReport {
  /** Number of patterns converted */
  patternsConverted: number;
  /** Number of steps converted */
  stepsConverted: number;
  /** Any warnings during import */
  warnings: string[];
  /** Parameters that were mapped */
  mappings: ParameterMapping[];
}

export interface ParameterMapping {
  source: string;
  target: string;
  value: string | number;
}

/** Import error types */
export type RbsImportError =
  | { type: 'INVALID_DATA'; message: string }
  | { type: 'CONVERSION_ERROR'; section: string; details: string }
  | { type: 'UNSUPPORTED_FEATURE'; feature: string };

/**
 * RBS Importer class
 * 
 * Usage:
 * ```typescript
 * const importer = new RbsImporter();
 * const result = importer.convertToHyphonSong(rawRbsData, options);
 * if (result.success) {
 *   loadSong(result.song);
 * }
 * ```
 */
export class RbsImporter {
  private options: RbsImportOptions;

  constructor(options: Partial<RbsImportOptions> = {}) {
    this.options = { ...DEFAULT_RBS_IMPORT_OPTIONS, ...options };
  }

  /**
   * Main entry point: convert RawRbsData to HyphonSong
   * 
   * CURRENTLY: Basic conversion with many fields stubbed
   * TODO: Full parameter mapping and automation conversion
   */
  convertToHyphonSong(raw: RawRbsData): RbsImportResult {
    const warnings: string[] = [];
    const mappings: ParameterMapping[] = [];

    // Convert pattern data
    const pattern = this.convertPattern(raw, warnings);

    // Convert synth parameters
    const params = this.convertSynthParams(raw, mappings);

    // Build Hyphon song
    const song: HyphonSong = {
      version: 1,
      metadata: {
        name: raw.project.name,
        author: raw.project.author,
        importedFrom: 'rbs',
        originalSource: raw.project.sourceSoftware,
        importedAt: new Date()
      },
      tempo: raw.project.tempo,
      timeSignature: [raw.project.timeSignatureNum, raw.project.timeSignatureDen],
      swing: raw.project.swing,
      pattern,
      params,
      rbsMetadata: {
        originalVersion: raw.version,
        pcfSettings: raw.pcf,
        automation: raw.automation,
        tb303AParams: this.extractTb303Params(raw.tb303PatternA),
        tb303BParams: this.extractTb303Params(raw.tb303PatternB)
      }
    };

    // Calculate conversion stats
    const stepsConverted = this.countSteps(raw);

    return {
      success: true,
      song,
      report: {
        patternsConverted: 4, // 2x 303 + drums (kick/snare/hats counted as one)
        stepsConverted,
        warnings,
        mappings
      }
    };
  }

  /**
   * Convert RBS patterns to Hyphon Pattern
   */
  private convertPattern(raw: RawRbsData, warnings: string[]): Pattern {
    const numSteps = this.options.expandTo32Steps ? 32 : raw.project.patternLength;

    // Convert TB-303 Pattern A
    const partA = this.convertTb303ToPartSequence(
      raw.tb303PatternA, 
      numSteps,
      this.options.tb303ATarget === 'bass2' // Use bass note range if going to bass track
    );

    // Convert TB-303 Pattern B
    const partB = this.convertTb303ToPartSequence(
      raw.tb303PatternB,
      numSteps,
      this.options.tb303BTarget === 'bass2'
    );

    // Convert drum patterns
    const kick = this.convertDrumPattern(raw.drums.kick, numSteps, 'kick');
    const snare = this.convertDrumPattern(raw.drums.snare, numSteps, 'snare');
    const closedHat = this.convertDrumPattern(raw.drums.closedHat, numSteps, 'closedHat');
    const openHat = this.convertDrumPattern(raw.drums.openHat, numSteps, 'openHat');

    // Build Pattern object
    const pattern: Pattern = {
      partA,
      partB,
      bass2: this.options.tb303ATarget === 'bass2' ? partA : 
             this.options.tb303BTarget === 'bass2' ? partB : 
             { steps: Array(numSteps).fill(null) },
      kick,
      snare,
      closedHat,
      openHat,
      sampler: Array(8).fill(null).map(() => ({ steps: Array(numSteps).fill(null) }))
    };

    return pattern;
  }

  /**
   * Convert TB-303 pattern steps to Hyphon PartSequence
   */
  private convertTb303ToPartSequence(
    tb303: { steps: Tb303Step[] },
    numSteps: number,
    isBassTrack: boolean
  ): PartSequence {
    const steps: (Note | null)[] = Array(numSteps).fill(null);

    for (let i = 0; i < tb303.steps.length && i < numSteps; i++) {
      const step = tb303.steps[i];
      
      if (step.note === -1 || step.tie) {
        steps[i] = null;
        continue;
      }

      // Convert TB-303 note format to MIDI
      // TB-303: note=0-11 (C-B), octave=1-5
      // MIDI: 0-127, middle C (C4) = 60
      const midiNote = (step.octave + 1) * 12 + step.note;
      const noteName = midiToNote(midiNote);

      steps[i] = {
        note: noteName,
        velocity: step.accent ? 1.0 : 0.8,
        length: step.slide ? 2 : 1, // Slides extend to next step
        slide: step.slide,
        timbre: 0.5 // Default timbre
      };
    }

    // If expanding to 32 steps, duplicate the pattern
    if (numSteps === 32 && tb303.steps.length === 16) {
      for (let i = 16; i < 32; i++) {
        const sourceStep = steps[i - 16];
        if (sourceStep) {
          steps[i] = { ...sourceStep };
        }
      }
    }

    return { steps };
  }

  /**
   * Convert drum pattern boolean array to PartSequence
   */
  private convertDrumPattern(
    drumSteps: boolean[],
    numSteps: number,
    drumType: 'kick' | 'snare' | 'closedHat' | 'openHat'
  ): PartSequence {
    const steps: (Note | null)[] = Array(numSteps).fill(null);
    const defaultNote = this.getDefaultDrumNote(drumType);

    for (let i = 0; i < drumSteps.length && i < numSteps; i++) {
      if (drumSteps[i]) {
        steps[i] = {
          note: defaultNote,
          velocity: 1.0,
          length: 1,
          timbre: 0.5
        };
      }
    }

    // Expand to 32 steps if needed
    if (numSteps === 32 && drumSteps.length === 16) {
      for (let i = 16; i < 32; i++) {
        const sourceStep = steps[i - 16];
        if (sourceStep) {
          steps[i] = { ...sourceStep };
        }
      }
    }

    return { steps };
  }

  /**
   * Get default note for drum type
   */
  private getDefaultDrumNote(drumType: string): string {
    switch (drumType) {
      case 'kick': return 'C2';
      case 'snare': return 'D2';
      case 'closedHat': return 'F#2';
      case 'openHat': return 'A#2';
      default: return 'C3';
    }
  }

  /**
   * Convert synth parameters from RBS to Hyphon
   */
  private convertSynthParams(
    raw: RawRbsData,
    mappings: ParameterMapping[]
  ): HyphonSong['params'] {
    // Map TB-303 0-127 range to Hyphon parameters
    const map303ToSynthParams = (tb303: { cutoff: number; resonance: number; envMod: number; decay: number; accent: number; waveform: 0 | 1 }): SynthParams => {
      const waveform: Waveform = tb303.waveform === 0 ? '303-saw' : '303-sqr';
      
      mappings.push({ source: 'TB-303.cutoff', target: 'SynthParams.filterCutoff', value: tb303.cutoff });
      mappings.push({ source: 'TB-303.resonance', target: 'SynthParams.filterResonance', value: tb303.resonance });
      mappings.push({ source: 'TB-303.waveform', target: 'SynthParams.waveform', value: waveform });

      return {
        waveform,
        pitch: 0,
        filterCutoff: this.mapRange(tb303.cutoff, 0, 127, 200, 8000),
        filterResonance: this.mapRange(tb303.resonance, 0, 127, 0, 20),
        filterMode: tb303.envMod > 64 ? 1 : 0,
        attack: 0.01, // 303 has fast attack
        decay: this.mapRange(tb303.decay, 0, 127, 0.1, 2.0),
        sustain: 0.5,
        release: this.mapRange(tb303.decay, 0, 127, 0.1, 1.0),
        length: 0.25,
        volume: this.mapRange(tb303.accent, 0, 127, 0.6, 1.0),
        delayTime: 0.3,
        delayFeedback: 0.2,
        delayMix: 0.0
      };
    };

    // Convert 303 patterns to appropriate Hyphon tracks
    const synthA = map303ToSynthParams(raw.tb303PatternA);
    const synthB = map303ToSynthParams(raw.tb303PatternB);

    // Create bass2 params if needed
    const bass2Params: Bass2Params | undefined = 
      this.options.tb303ATarget === 'bass2' ? this.convertToBass2Params(raw.tb303PatternA) :
      this.options.tb303BTarget === 'bass2' ? this.convertToBass2Params(raw.tb303PatternB) :
      undefined;

    // Convert drum parameters based on kit type
    const drumKit = raw.drums;
    const kick: KickParams = {
      pitch: this.mapRange(drumKit.tuning?.kick ?? 0, -50, 50, 40, 80),
      decay: this.mapRange(drumKit.decay?.kick ?? 64, 0, 127, 0.1, 1.0),
      tone: drumKit.kitType === '808' ? 0.6 : 0.8,
      volume: 1.0
    };

    const snare: SnareParams = {
      decay: this.mapRange(drumKit.decay?.snare ?? 48, 0, 127, 0.1, 0.8),
      tone: drumKit.kitType === '808' ? 200 : 300,
      noise: drumKit.kitType === '808' ? 2000 : 4000,
      volume: 0.9
    };

    const closedHat: HatParams = {
      pitch: this.mapRange(drumKit.tuning?.closedHat ?? 0, -50, 50, 8000, 12000),
      decay: this.mapRange(drumKit.decay?.closedHat ?? 32, 0, 127, 0.05, 0.3),
      volume: 0.8
    };

    const openHat: HatParams = {
      pitch: this.mapRange(drumKit.tuning?.openHat ?? 0, -50, 50, 6000, 10000),
      decay: this.mapRange(drumKit.decay?.openHat ?? 64, 0, 127, 0.2, 0.8),
      volume: 0.8
    };

    return {
      synthA,
      synthB,
      bass2: bass2Params,
      kick,
      snare,
      closedHat,
      openHat
    };
  }

  /**
   * Convert TB-303 params to Bass2Params (Open303 format)
   */
  private convertToBass2Params(tb303: { cutoff: number; resonance: number; decay: number; accent: number; waveform: 0 | 1 }): Bass2Params {
    return {
      waveform: tb303.waveform,
      pitch: 0,
      cutoff: this.mapRange(tb303.cutoff, 0, 127, 200, 8000),
      resonance: this.mapRange(tb303.resonance, 0, 127, 0, 20),
      filterMode: 1,
      decay: this.mapRange(tb303.decay, 0, 127, 0.1, 2.0),
      accent: this.mapRange(tb303.accent, 0, 127, 0.5, 1.0),
      envMod: 0.5,
      volume: 0.9
    };
  }

  /**
   * Extract params object from TB-303 pattern (for metadata preservation)
   */
  private extractTb303Params(tb303: { cutoff: number; resonance: number; envMod: number; decay: number; accent: number; waveform: 0 | 1; distortion?: number; delaySend?: number }) {
    const { steps, ...params } = tb303;
    return params;
  }

  /**
   * Count total steps across all patterns
   */
  private countSteps(raw: RawRbsData): number {
    return raw.tb303PatternA.steps.length + 
           raw.tb303PatternB.steps.length + 
           raw.drums.kick.length + 
           raw.drums.snare.length + 
           raw.drums.closedHat.length + 
           raw.drums.openHat.length;
  }

  /**
   * Map a value from one range to another
   */
  private mapRange(value: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
    return ((value - inMin) * (outMax - outMin)) / (inMax - inMin) + outMin;
  }

  /**
   * Update import options
   */
  setOptions(options: Partial<RbsImportOptions>): void {
    this.options = { ...this.options, ...options };
  }

  /**
   * Get current options
   */
  getOptions(): RbsImportOptions {
    return { ...this.options };
  }
}

/**
 * Convenience function for direct conversion
 */
export function convertToHyphonSong(
  raw: RawRbsData, 
  options?: Partial<RbsImportOptions>
): RbsImportResult {
  const importer = new RbsImporter(options);
  return importer.convertToHyphonSong(raw);
}

export default RbsImporter;
