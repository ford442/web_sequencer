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
const TB303_DEFAULT_SLIDE_TIME = 42;

/** Clamp a value to the [0, 1] normalized range. */
function clampNormalized(value: number): number {
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
  private stepStats: StepConversionStats;

  constructor(options: Partial<RbsImportOptions> = {}) {
    this.options = { ...DEFAULT_RBS_IMPORT_OPTIONS, ...options };
    this.stepStats = {
      slideCount: 0,
      accentCount: 0,
      tieCount: 0,
      totalSteps: 0
    };
  }

  /**
   * Main entry point: convert RawRbsData to HyphonSong
   * 
   * Performs full conversion including:
   * - Pattern conversion with optional 16→32 step expansion
   * - Synth parameter mapping with exponential curves
   * - PCF to filter/automation conversion
   * - Automation lane extraction
   * - Drum kit-specific parameter mapping
   */
  convertToHyphonSong(raw: RawRbsData): RbsImportResult {
    const warnings: string[] = [];
    const mappings: DetailedParameterMapping[] = [];

    // Reset step statistics
    this.stepStats = {
      slideCount: 0,
      accentCount: 0,
      tieCount: 0,
      totalSteps: 0
    };

    // Convert pattern data
    const pattern = this.convertPattern(raw, warnings);

    // Convert synth parameters
    const params = this.convertSynthParams(raw, mappings);

    // Convert PCF to automation if enabled
    const automation: HyphonAutomationLane[] = [];
    if (this.options.convertPcfToAutomation && raw.pcf.enabled && !this.options.importPcfAsFilter) {
      const pcfAutomation = this.convertPcfToAutomation(raw.pcf);
      automation.push(...pcfAutomation);
    }

    // Convert automation lanes
    const convertedAutomation = this.convertAutomationLanes(raw.automation);
    automation.push(...convertedAutomation);

    // Generate per-step accent and slide automation lanes from TB-303 step data.
    // These capture the pattern-level on/off state for accent (velocity boost +
    // filter envelope push) and slide (portamento/legato), so the playback
    // scheduler can replicate exact TB-303 behaviour step-by-step.
    const tb303ATarget = this.resolveTb303Target(this.options.tb303ATarget);
    const tb303BTarget = this.resolveTb303Target(this.options.tb303BTarget);
    const accentSlideA = this.generateAccentSlideAutomation(
      raw.tb303PatternA.steps,
      tb303ATarget,
      raw.tb303PatternA.accent / 127
    );
    const accentSlideB = this.generateAccentSlideAutomation(
      raw.tb303PatternB.steps,
      tb303BTarget,
      raw.tb303PatternB.accent / 127
    );
    automation.push(...accentSlideA, ...accentSlideB);

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
      automation: automation.length > 0 ? automation : undefined,
      pcfFilter: this.options.importPcfAsFilter && raw.pcf.enabled ? {
        enabled: raw.pcf.enabled,
        filterType: raw.pcf.filterType,
        cutoff: raw.pcf.cutoff,
        resonance: raw.pcf.resonance,
        envAmount: raw.pcf.envAmount,
        decay: raw.pcf.decay,
        pattern: [...raw.pcf.pattern],
        target: { ...raw.pcf.target },
      } : undefined,
      rbsMetadata: {
        originalVersion: raw.version,
        pcfSettings: raw.pcf,
        automation: raw.automation,
        tb303AParams: this.extractTb303Params(raw.tb303PatternA),
        tb303BParams: this.extractTb303Params(raw.tb303PatternB)
      },
      songArrangement: raw.songData ? this.buildSongArrangement(raw, warnings) : undefined,
    };

    // Calculate conversion stats
    const stepsConverted = this.countSteps(raw);

    // Build song mode report data if songData is present
    const songModeReport = raw.songData ? {
      isSongMode: raw.songData.glob.playMode === 1,
      patternBankCount: Math.max(
        raw.songData.patternBanks.tb303A.length,
        raw.songData.patternBanks.tb303B.length,
        raw.songData.patternBanks.drums808.length,
        raw.songData.patternBanks.drums909.length,
      ),
      arrangementEventCount: raw.songData.tracks.reduce((sum, t) => sum + t.eventCount, 0),
      songLengthBars: raw.songData.totalLengthBars,
      usedPatternCount: raw.songData.usedPatternCount,
    } : undefined;

    // Build enhanced report
    return {
      success: true,
      song,
      report: {
        patternsConverted: songModeReport ? songModeReport.patternBankCount : 4,
        stepsConverted,
        warnings,
        mappings,
        automationLanesConverted: automation.length,
        pcfEnabled: raw.pcf.enabled,
        slideCount: this.stepStats.slideCount,
        accentCount: this.stepStats.accentCount,
        stepStats: this.stepStats,
        songMode: songModeReport,
      }
    };
  }

  /**
   * Convert RBS patterns to Hyphon Pattern
   * Handles 16→32 step expansion with proper slide/accent preservation
   */
  private convertPattern(raw: RawRbsData, warnings: string[]): Pattern {
    const numSteps = this.options.expandTo32Steps ? 32 : raw.project.patternLength;
    const isExpansion = numSteps === 32 && raw.project.patternLength === 16;

    // Convert TB-303 Pattern A
    let partA: PartSequence;
    if (isExpansion) {
      partA = this.expandPattern16To32(
        raw.tb303PatternA.steps,
        this.options.tb303ATarget === 'bass2'
      );
    } else {
      partA = this.convertTb303ToPartSequence(
        raw.tb303PatternA, 
        numSteps,
        this.options.tb303ATarget === 'bass2'
      );
    }

    // Convert TB-303 Pattern B
    let partB: PartSequence;
    if (isExpansion) {
      partB = this.expandPattern16To32(
        raw.tb303PatternB.steps,
        this.options.tb303BTarget === 'bass2'
      );
    } else {
      partB = this.convertTb303ToPartSequence(
        raw.tb303PatternB,
        numSteps,
        this.options.tb303BTarget === 'bass2'
      );
    }

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

      // Track statistics
      if (step.slide) this.stepStats.slideCount++;
      if (step.accent) this.stepStats.accentCount++;
      if (step.tie) this.stepStats.tieCount++;
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

    this.stepStats.totalSteps += steps.length;
    return { steps };
  }

  /**
   * Expand 16-step RBS pattern to 32-step Hyphon pattern
   * 
   * Rules:
   * - Step 0 → steps 0, 1 (step 0 has accent if original had accent)
   * - Step 1 → steps 2, 3
   * - Slides extend across both steps
   * - Ties sustain the note
   * - Accents preserved on first of each pair
   */
  private expandPattern16To32(steps16: Tb303Step[], isBassTrack: boolean): PartSequence {
    const steps32: (Note | null)[] = Array(32).fill(null);

    for (let i = 0; i < 16; i++) {
      const sourceStep = steps16[i];
      const targetIndex1 = i * 2;     // First of pair
      const targetIndex2 = i * 2 + 1; // Second of pair

      if (sourceStep.note === -1) {
        // Rest - both steps are null
        continue;
      }

      if (sourceStep.tie) {
        // Tie - sustain from previous (handle below)
        this.stepStats.tieCount++;
        continue;
      }

      // Convert note
      const midiNote = (sourceStep.octave + 1) * 12 + sourceStep.note;
      const noteName = midiToNote(midiNote);

      // Calculate velocities based on accent
      // Accent on first step only in expanded pattern
      const baseVelocity = 0.8;
      const accentBoost = sourceStep.accent ? this.convertAccentToBoost(127) : 0;
      const velocity1 = Math.min(1.0, baseVelocity + accentBoost);
      const velocity2 = baseVelocity; // Second step always base velocity

      // Track statistics
      if (sourceStep.slide) this.stepStats.slideCount++;
      if (sourceStep.accent) this.stepStats.accentCount++;

      if (sourceStep.slide) {
        // Slide: note extends across both steps with slide flag
        steps32[targetIndex1] = {
          note: noteName,
          velocity: velocity1,
          length: 2, // Spans both steps
          slide: true,
          timbre: 0.5
        };
        steps32[targetIndex2] = null; // Part of slide
      } else {
        // Normal note: place on first step, second step is rest
        steps32[targetIndex1] = {
          note: noteName,
          velocity: velocity1,
          length: 1,
          slide: false,
          timbre: 0.5
        };
        // Second step is null (rest) unless it's a sustained note
        // Check if next step is a tie
        const nextIndex = i + 1;
        if (nextIndex < 16 && steps16[nextIndex].tie) {
          // Next step is tied, sustain this note
          steps32[targetIndex2] = {
            note: noteName,
            velocity: velocity2,
            length: 1,
            slide: false,
            timbre: 0.5
          };
        }
      }
    }

    // Handle ties (sustained notes) in the 32-step pattern
    this.handleTiesInExpandedPattern(steps32, steps16);

    this.stepStats.totalSteps += 32;
    return { steps: steps32 };
  }

  /**
   * Handle tied notes in expanded pattern
   * A tie means the note sustains through the next step
   */
  private handleTiesInExpandedPattern(steps32: (Note | null)[], steps16: Tb303Step[]): void {
    for (let i = 0; i < 16; i++) {
      const sourceStep = steps16[i];
      if (sourceStep.tie && i > 0) {
        // Find the previous non-tie step
        let prevIndex = i - 1;
        while (prevIndex >= 0 && steps16[prevIndex].tie) {
          prevIndex--;
        }
        
        if (prevIndex >= 0) {
          const prevSourceStep = steps16[prevIndex];
          const prevMidiNote = (prevSourceStep.octave + 1) * 12 + prevSourceStep.note;
          const prevNoteName = midiToNote(prevMidiNote);
          
          // Extend the note into this step
          const targetIndex1 = i * 2;
          const targetIndex2 = i * 2 + 1;
          
          // Both sub-steps sustain the tied note
          steps32[targetIndex1] = {
            note: prevNoteName,
            velocity: 0.8,
            length: 1,
            slide: false,
            timbre: 0.5
          };
          steps32[targetIndex2] = {
            note: prevNoteName,
            velocity: 0.8,
            length: 1,
            slide: false,
            timbre: 0.5
          };
        }
      }
    }
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

    // Expand to 32 steps if needed (simple duplication for drums)
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
   * Uses enhanced exponential curves for accurate TB-303 emulation
   */
  private convertSynthParams(
    raw: RawRbsData,
    mappings: DetailedParameterMapping[]
  ): HyphonSong['params'] {
    // Map TB-303 0-127 range to Hyphon parameters using exponential curves
    const map303ToSynthParams = (tb303: { cutoff: number; resonance: number; envMod: number; decay: number; accent: number; waveform: 0 | 1; slideTime?: number }, sourceName: string): SynthParams => {
      // Use 303-specific waveforms so Open303Manager is selected for playback
      const waveform: Waveform = tb303.waveform === 0 ? '303-saw' : '303-sqr';
      
      // Cutoff: RBS 0-127 → Hyphon 100-8000 Hz (exponential curve)
      // Formula: 100 * 2^(rbsCutoff / 21.17) where 127 ≈ 8000Hz
      const cutoffHz = this.convertCutoffToHz(tb303.cutoff);
      
      // Resonance: RBS 0-127 → Hyphon 0-20 (linear)
      const resonance = this.convertResonance(tb303.resonance);
      
      // Decay: RBS 0-127 → Hyphon 0.05-2.0s (exponential)
      const decaySeconds = this.convertDecayToSeconds(tb303.decay);
      
      // EnvMod: RBS 0-127 → Hyphon filterMode (0-1 normalized).
      // SynthParams stores envMod as filterMode (0-1) so the Open303 engine
      // can apply the correct envelope-modulation depth.
      const filterMode = clampNormalized(tb303.envMod / 127);

      // Accent: RBS 0-127 → Hyphon velocity boost 0-0.4
      const accentBoost = this.convertAccentToBoost(tb303.accent);
      
      // Volume based on accent (0.6-1.0 range)
      const volume = 0.6 + accentBoost;

      // Slide time: use raw value when available; TB-303 hardware default is ~42/127 ≈ 0.33.
      const rawSlideTime = tb303.slideTime ?? TB303_DEFAULT_SLIDE_TIME;
      const portamento = clampNormalized(rawSlideTime / 127);

      // Record detailed mappings
      mappings.push({
        source: `${sourceName}.cutoff`,
        target: 'SynthParams.filterCutoff',
        originalValue: tb303.cutoff,
        convertedValue: Math.round(cutoffHz),
        formula: '100 * 2^(cutoff / 21.17) Hz'
      });
      mappings.push({
        source: `${sourceName}.resonance`,
        target: 'SynthParams.filterResonance',
        originalValue: tb303.resonance,
        convertedValue: parseFloat(resonance.toFixed(2)),
        formula: 'resonance / 6.35'
      });
      mappings.push({
        source: `${sourceName}.envMod`,
        target: 'SynthParams.filterMode',
        originalValue: tb303.envMod,
        convertedValue: parseFloat(filterMode.toFixed(3)),
        formula: 'envMod / 127 (0-1 normalized)'
      });
      mappings.push({
        source: `${sourceName}.decay`,
        target: 'SynthParams.decay',
        originalValue: tb303.decay,
        convertedValue: parseFloat(decaySeconds.toFixed(3)),
        formula: '0.05 * 40^(decay / 127) seconds'
      });
      mappings.push({
        source: `${sourceName}.accent`,
        target: 'SynthParams.volume',
        originalValue: tb303.accent,
        convertedValue: parseFloat(volume.toFixed(2)),
        formula: '0.6 + (accent / 317.5)'
      });
      mappings.push({
        source: `${sourceName}.waveform`,
        target: 'SynthParams.waveform',
        originalValue: tb303.waveform,
        convertedValue: waveform
      });
      mappings.push({
        source: `${sourceName}.slideTime`,
        target: 'SynthParams.portamento',
        originalValue: rawSlideTime,
        convertedValue: parseFloat(portamento.toFixed(3)),
        formula: 'slideTime / 127 (0-1 normalized, TB-303 default ≈ 0.33)'
      });

      return {
        waveform,
        pitch: 0,
        filterCutoff: cutoffHz,
        filterResonance: resonance,
        filterMode,
        attack: 0.01, // 303 has fast attack
        decay: decaySeconds,
        sustain: 0.5,
        release: decaySeconds * 0.5, // Release is shorter than decay
        length: 0.25,
        volume: volume,
        delayTime: 0.3,
        delayFeedback: 0.2,
        delayMix: 0.0,
        portamento,
      };
    };

    // Convert 303 patterns to appropriate Hyphon tracks
    const synthA = map303ToSynthParams(raw.tb303PatternA, 'TB-303A');
    const synthB = map303ToSynthParams(raw.tb303PatternB, 'TB-303B');

    // Create bass2 params if needed
    const bass2Params: Bass2Params | undefined = 
      this.options.tb303ATarget === 'bass2' ? this.convertToBass2Params(raw.tb303PatternA, 'TB-303A', mappings) :
      this.options.tb303BTarget === 'bass2' ? this.convertToBass2Params(raw.tb303PatternB, 'TB-303B', mappings) :
      undefined;

    // Convert drum parameters based on kit type
    const { kick, snare, closedHat, openHat } = this.convertDrumParams(raw.drums, mappings);

    // Determine final kit type for downstream consumers
    let drumKit: '808' | '909' = raw.drums.kitType;
    if (this.options.drumKitMapping !== 'auto') {
      drumKit = this.options.drumKitMapping;
    }

    return {
      synthA,
      synthB,
      bass2: bass2Params,
      kick,
      snare,
      closedHat,
      openHat,
      drumKit
    };
  }

  /**
   * Convert TB-303 params to Bass2Params (Open303 format)
   */
  private convertToBass2Params(
    tb303: { cutoff: number; resonance: number; decay: number; accent: number; waveform: 0 | 1; envMod?: number; slideTime?: number },
    sourceName: string,
    mappings?: DetailedParameterMapping[]
  ): Bass2Params {
    const cutoff = this.convertCutoffToHz(tb303.cutoff);
    const resonance = this.convertResonance(tb303.resonance);
    const decay = this.convertDecayToSeconds(tb303.decay);
    const accent = 0.5 + this.convertAccentToBoost(tb303.accent);

    // Slide time: use the raw 0-127 value if provided; otherwise fall back to the
    // TB-303 hardware default (~42/127 ≈ 0.33 = 60 ms at nominal tempo).
    const rawSlideTime = tb303.slideTime ?? TB303_DEFAULT_SLIDE_TIME;
    const slideTime = clampNormalized(rawSlideTime / 127);

    if (mappings) {
      mappings.push({
        source: `${sourceName}.cutoff`,
        target: 'Bass2Params.cutoff',
        originalValue: tb303.cutoff,
        convertedValue: Math.round(cutoff),
        formula: '100 * 2^(cutoff / 21.17) Hz'
      });
      mappings.push({
        source: `${sourceName}.slideTime`,
        target: 'Bass2Params.slideTime',
        originalValue: rawSlideTime,
        convertedValue: parseFloat(slideTime.toFixed(3)),
        formula: 'slideTime / 127 (0-1 normalized, TB-303 default ≈ 0.33)'
      });
    }

    return {
      waveform: tb303.waveform === 0 ? '303-saw' : '303-sqr',
      pitch: 0,
      cutoff,
      resonance,
      filterMode: 1,
      decay,
      accent,
      envMod: (tb303.envMod ?? 64) / 127,
      volume: 0.9,
      slideTime,
    };
  }

  /**
   * Convert drum parameters with kit-specific mapping (808 vs 909)
   */
  private convertDrumParams(
    drums: RawRbsData['drums'],
    mappings: DetailedParameterMapping[]
  ): { kick: KickParams; snare: SnareParams; closedHat: HatParams; openHat: HatParams } {
    // Determine kit type
    let kitType: '808' | '909' = drums.kitType;
    if (this.options.drumKitMapping !== 'auto') {
      kitType = this.options.drumKitMapping;
    }

    // Kit-specific tone settings
    const kickTone = kitType === '808' ? 0.6 : 0.8;
    const snareTone = kitType === '808' ? 200 : 300;
    const snareNoise = kitType === '808' ? 2000 : 4000;

    // Kick parameters
    const kick: KickParams = {
      pitch: this.mapRange(drums.tuning?.kick ?? 0, -50, 50, 40, 80),
      decay: this.mapRange(drums.decay?.kick ?? 64, 0, 127, 0.1, 1.0),
      tone: kickTone,
      volume: 1.0
    };

    mappings.push({
      source: `Drums.${kitType}.kick.tone`,
      target: 'KickParams.tone',
      originalValue: kitType,
      convertedValue: kickTone,
      formula: kitType === '808' ? '808: more body (0.6)' : '909: tighter (0.8)'
    });

    // Snare parameters
    const snare: SnareParams = {
      decay: this.mapRange(drums.decay?.snare ?? 48, 0, 127, 0.1, 0.8),
      tone: snareTone,
      noise: snareNoise,
      volume: 0.9
    };

    mappings.push({
      source: `Drums.${kitType}.snare.tone`,
      target: 'SnareParams.tone',
      originalValue: kitType,
      convertedValue: snareTone,
      formula: kitType === '808' ? '808: lower pitch (200)' : '909: higher pitch (300)'
    });
    mappings.push({
      source: `Drums.${kitType}.snare.noise`,
      target: 'SnareParams.noise',
      originalValue: kitType,
      convertedValue: snareNoise,
      formula: kitType === '808' ? '808: less snap (2000)' : '909: more snap (4000)'
    });

    // Hi-hat parameters
    const closedHat: HatParams = {
      pitch: this.mapRange(drums.tuning?.closedHat ?? 0, -50, 50, 8000, 12000),
      decay: this.mapRange(drums.decay?.closedHat ?? 32, 0, 127, 0.05, 0.3),
      volume: 0.8
    };

    const openHat: HatParams = {
      pitch: this.mapRange(drums.tuning?.openHat ?? 0, -50, 50, 6000, 10000),
      decay: this.mapRange(drums.decay?.openHat ?? 64, 0, 127, 0.2, 0.8),
      volume: 0.8
    };

    return { kick, snare, closedHat, openHat };
  }

  /**
   * Convert PCF settings to Hyphon automation lanes
   * 
   * Maps PCF to per-track filter automation based on targets
   */
  private convertPcfToAutomation(pcf: PcfSettings): HyphonAutomationLane[] {
    const automation: HyphonAutomationLane[] = [];

    if (!pcf.enabled) {
      return automation;
    }

    // Map PCF cutoff values (0-127) to Hz
    const baseCutoffHz = this.convertCutoffToHz(pcf.cutoff);
    const pcfResonance = this.convertResonance(pcf.resonance);
    const pcfDecay = this.convertDecayToSeconds(pcf.decay);

    // Create automation lane for each PCF target
    if (pcf.target.tb303A) {
      automation.push({
        target: 'synthA',
        parameter: 'filterCutoff',
        name: 'PCF → Synth A Filter',
        points: this.convertPcfPatternToPoints(pcf.pattern, baseCutoffHz),
        interpolation: this.options.interpolateAutomation ? 'smooth' : 'linear',
        originalRange: [0, 127]
      });
    }

    if (pcf.target.tb303B) {
      automation.push({
        target: 'synthB',
        parameter: 'filterCutoff',
        name: 'PCF → Synth B Filter',
        points: this.convertPcfPatternToPoints(pcf.pattern, baseCutoffHz),
        interpolation: this.options.interpolateAutomation ? 'smooth' : 'linear',
        originalRange: [0, 127]
      });
    }

    // If PCF targets drums, it typically affects overall drum tone
    // We'll add it to the master track as a "drum filter" reference
    if (pcf.target.drums) {
      automation.push({
        target: 'master',
        parameter: 'drumPcfModulation',
        name: 'PCF → Drum Filter',
        points: this.convertPcfPatternToPoints(pcf.pattern, pcf.envAmount / 127),
        interpolation: this.options.interpolateAutomation ? 'smooth' : 'linear',
        originalRange: [0, 127]
      });
    }

    return automation;
  }

  /**
   * Convert PCF modulation pattern to automation points
   */
  private convertPcfPatternToPoints(pattern: number[], baseValue: number): [number, number][] {
    const points: [number, number][] = [];
    const numSteps = this.options.expandTo32Steps ? 32 : pattern.length;

    for (let i = 0; i < numSteps; i++) {
      const sourceIndex = i % pattern.length;
      const value = pattern[sourceIndex];
      
      // Normalize value to 0-1 range, scaled by base value
      const normalizedValue = Math.min(1.0, (value / 127) * (baseValue / 8000));
      
      if (this.options.quantizeTo16th) {
        // Quantize to exact step
        points.push([i, normalizedValue]);
      } else {
        // Allow fractional steps
        points.push([i, normalizedValue]);
      }
    }

    return points;
  }

  /**
   * Resolve a tb303ATarget / tb303BTarget option string to the corresponding
   * HyphonAutomationLane target name.
   */
  private resolveTb303Target(
    option: 'partA' | 'partB' | 'bass2'
  ): HyphonAutomationLane['target'] {
    switch (option) {
      case 'bass2': return 'bass2';
      case 'partB': return 'synthB';
      case 'partA':
      default:      return 'synthA';
    }
  }

  /**
   * Generate per-step accent and slide automation lanes from TB-303 step data.
   *
   * **Accent lane** (`parameter: 'accent'`):
   *   - Value `1.0` on accented steps (velocity + filter-envelope boost, as on
   *     authentic TB-303 hardware).
   *   - Value equal to `baseAccentNorm` on non-accented steps, so the global
   *     accent level is preserved between locked steps.
   *
   * **Slide lane** (`parameter: 'slide'`):
   *   - Value `1.0` on slide-active steps (portamento/legato).
   *   - Value `0.0` on all other steps.
   *
   * Both lanes use `'step'` interpolation so values snap at step boundaries,
   * exactly matching the TB-303's digital switching behaviour.
   *
   * Lanes are only emitted when at least one step actually has the flag set,
   * avoiding unnecessary overhead for patterns with no accent or no slide.
   *
   * @param steps          TB-303 step array (16 or 32 steps).
   * @param target         Which automation target these lanes belong to.
   * @param baseAccentNorm Normalised (0–1) base accent level from the pattern
   *                       parameters; used as the "resting" accent value on
   *                       non-accented steps.
   * @returns              0, 1, or 2 `HyphonAutomationLane` objects.
   */
  private generateAccentSlideAutomation(
    steps: Tb303Step[],
    target: HyphonAutomationLane['target'],
    baseAccentNorm: number
  ): HyphonAutomationLane[] {
    const numSteps = this.options.expandTo32Steps ? 32 : steps.length;
    const accentPoints: [number, number][] = [];
    const slidePoints: [number, number][] = [];
    let hasAccent = false;
    let hasSlide = false;

    for (let i = 0; i < numSteps; i++) {
      const src = steps[i % steps.length];
      accentPoints.push([i, src.accent ? 1.0 : clampNormalized(baseAccentNorm)]);
      slidePoints.push([i, src.slide ? 1.0 : 0.0]);
      if (src.accent) hasAccent = true;
      if (src.slide) hasSlide = true;
    }

    const trackLabel =
      target === 'synthA' ? 'TB-303 A' :
      target === 'synthB' ? 'TB-303 B' :
      'Bass 2';

    const lanes: HyphonAutomationLane[] = [];

    if (hasAccent) {
      lanes.push({
        target,
        parameter: 'accent',
        name: `${trackLabel} Accent`,
        points: accentPoints,
        interpolation: 'step',
        originalRange: [0, 1],
      });
    }

    if (hasSlide) {
      lanes.push({
        target,
        parameter: 'slide',
        name: `${trackLabel} Slide`,
        points: slidePoints,
        interpolation: 'step',
        originalRange: [0, 1],
      });
    }

    return lanes;
  }

  /**
   * Convert RBS automation lanes to Hyphon format
   * 
   * Supports:
   * - Tempo changes
   * - TB-303 A/B cutoff modulation
   * - PCF modulation
   * - Master volume
   */
  private convertAutomationLanes(lanes: AutomationLane[]): HyphonAutomationLane[] {
    const hyphonLanes: HyphonAutomationLane[] = [];

    for (const lane of lanes) {
      const converted = this.convertAutomationLane(lane);
      if (converted) {
        hyphonLanes.push(converted);
      }
    }

    return hyphonLanes;
  }

  /**
   * Convert a single automation lane
   */
  private convertAutomationLane(lane: AutomationLane): HyphonAutomationLane | null {
    // Determine target and parameter based on lane type
    let target: HyphonAutomationLane['target'];
    let parameter: string;
    let name: string;

    switch (lane.parameter) {
      case 'tempo':
        target = 'master';
        parameter = 'tempo';
        name = lane.name || 'Tempo';
        break;
      case 'swing':
        target = 'master';
        parameter = 'swing';
        name = lane.name || 'Swing';
        break;
      case 'tb303Acutoff':
        target = 'synthA';
        parameter = 'filterCutoff';
        name = lane.name || 'TB-303 A Cutoff';
        break;
      case 'tb303Bcutoff':
        target = 'synthB';
        parameter = 'filterCutoff';
        name = lane.name || 'TB-303 B Cutoff';
        break;
      case 'tb303Aresonance':
        target = 'synthA';
        parameter = 'filterResonance';
        name = lane.name || 'TB-303 A Resonance';
        break;
      case 'tb303Bresonance':
        target = 'synthB';
        parameter = 'filterResonance';
        name = lane.name || 'TB-303 B Resonance';
        break;
      case 'tb303Adecay':
        target = 'synthA';
        parameter = 'decay';
        name = lane.name || 'TB-303 A Decay';
        break;
      case 'tb303Bdecay':
        target = 'synthB';
        parameter = 'decay';
        name = lane.name || 'TB-303 B Decay';
        break;
      case 'pcfCutoff':
        target = 'master';
        parameter = 'pcfModulation';
        name = lane.name || 'PCF Modulation';
        break;
      case 'pcfResonance':
        target = 'master';
        parameter = 'pcfResonance';
        name = lane.name || 'PCF Resonance';
        break;
      case 'pcfEnvAmount':
        target = 'master';
        parameter = 'pcfEnvAmount';
        name = lane.name || 'PCF Env Amount';
        break;
      case 'masterVolume':
        target = 'master';
        parameter = 'volume';
        name = lane.name || 'Master Volume';
        break;
      default:
        return null; // Unsupported parameter
    }

    // Convert points with optional interpolation
    const points = this.convertAutomationPoints(
      lane.points,
      lane.range,
      lane.interpolation
    );

    return {
      target,
      parameter,
      name,
      points,
      interpolation: this.options.interpolateAutomation ? 'smooth' : lane.interpolation,
      originalRange: lane.range
    };
  }

  /**
   * Convert automation points to normalized Hyphon format
   */
  private convertAutomationPoints(
    points: [number, number][],
    range: [number, number],
    interpolation: 'step' | 'linear' | 'smooth'
  ): [number, number][] {
    const [minVal, maxVal] = range;
    const rangeSpan = maxVal - minVal || 1;
    const numSteps = this.options.expandTo32Steps ? 32 : 16;

    const convertedPoints: [number, number][] = [];

    for (const [stepIndex, value] of points) {
      // Normalize value to 0-1 range
      const normalizedValue = clampNormalized((value - minVal) / rangeSpan);
      
      // Quantize if requested
      const finalStep = this.options.quantizeTo16th 
        ? Math.round(stepIndex) 
        : stepIndex;

      // Only include points within valid step range
      if (finalStep >= 0 && finalStep < numSteps) {
        convertedPoints.push([finalStep, normalizedValue]);
      }
    }

    // Sort by step index
    convertedPoints.sort((a, b) => a[0] - b[0]);

    // Remove duplicate step indices
    const uniquePoints: [number, number][] = [];
    let lastStep = -1;
    for (const point of convertedPoints) {
      if (point[0] !== lastStep) {
        uniquePoints.push(point);
        lastStep = point[0];
      }
    }

    return uniquePoints;
  }

  // ============================================================================
  // PARAMETER CONVERSION HELPERS (Exponential Curves)
  // ============================================================================

  /**
   * Convert RBS cutoff (0-127) to Hz using exponential curve
   * Formula: 100 * 2^(rbsCutoff / 21.17) → 127 ≈ 8000Hz
   */
  private convertCutoffToHz(rbsCutoff: number): number {
    const clampedCutoff = Math.max(0, Math.min(127, rbsCutoff));
    return 100 * Math.pow(2, clampedCutoff / 21.17);
  }

  /**
   * Convert RBS resonance (0-127) to Hyphon resonance (0-20)
   * Linear mapping: resonance / 6.35
   */
  private convertResonance(rbsResonance: number): number {
    const clampedResonance = Math.max(0, Math.min(127, rbsResonance));
    return clampedResonance / 6.35;
  }

  /**
   * Convert RBS decay (0-127) to seconds using exponential curve
   * Formula: 0.05 * 40^(rbsDecay / 127) → range 0.05-2.0s
   */
  private convertDecayToSeconds(rbsDecay: number): number {
    const clampedDecay = Math.max(0, Math.min(127, rbsDecay));
    return 0.05 * Math.pow(40, clampedDecay / 127);
  }

  /**
   * Convert RBS accent (0-127) to velocity boost (0-0.4)
   * Linear mapping: accent / 317.5
   */
  private convertAccentToBoost(rbsAccent: number): number {
    const clampedAccent = Math.max(0, Math.min(127, rbsAccent));
    return clampedAccent / 317.5;
  }

  /**
   * Extract params object from TB-303 pattern (for metadata preservation)
   */
  /**
   * Build songArrangement data from parsed IFF song data.
   * Populates trackStorage with pattern banks and creates songStructure from TRAK events.
   * This enables SongMode playback with the correct pattern sequence.
   */
  private buildSongArrangement(raw: RawRbsData, warnings: string[]): HyphonSong['songArrangement'] {
    const songData = raw.songData!;
    const numSteps = this.options.expandTo32Steps ? 32 : raw.project.patternLength;
    const isExpansion = numSteps === 32 && raw.project.patternLength === 16;

    // Convert pattern banks to Hyphon track storage format (up to 8 slots)
    const maxSlots = 8;
    const partASlots: (Pattern['partA'] | null)[] = Array(maxSlots).fill(null);
    const partBSlots: (Pattern['partB'] | null)[] = Array(maxSlots).fill(null);
    const bass2Slots: (Pattern['bass2'] | null)[] = Array(maxSlots).fill(null);
    const kickSlots: (Pattern['kick'] | null)[] = Array(maxSlots).fill(null);
    const snareSlots: (Pattern['snare'] | null)[] = Array(maxSlots).fill(null);
    const closedHatSlots: (Pattern['closedHat'] | null)[] = Array(maxSlots).fill(null);
    const openHatSlots: (Pattern['openHat'] | null)[] = Array(maxSlots).fill(null);

    // Map pattern banks to track storage (first 8 of up to 32)
    const numA = Math.min(maxSlots, songData.patternBanks.tb303A.length);
    for (let i = 0; i < numA; i++) {
      const pat = songData.patternBanks.tb303A[i];
      if (isExpansion) {
        partASlots[i] = this.expandPattern16To32(pat.steps, false);
      } else {
        partASlots[i] = this.convertTb303ToPartSequence(pat, numSteps, false);
      }
    }

    const numB = Math.min(maxSlots, songData.patternBanks.tb303B.length);
    for (let i = 0; i < numB; i++) {
      const pat = songData.patternBanks.tb303B[i];
      if (isExpansion) {
        partBSlots[i] = this.expandPattern16To32(pat.steps, false);
      } else {
        partBSlots[i] = this.convertTb303ToPartSequence(pat, numSteps, false);
      }
      // Also populate bass2 from 303B
      if (this.options.tb303BTarget === 'bass2') {
        if (isExpansion) {
          bass2Slots[i] = this.expandPattern16To32(pat.steps, true);
        } else {
          bass2Slots[i] = this.convertTb303ToPartSequence(pat, numSteps, true);
        }
      }
    }

    // Drum patterns
    const drumBank = songData.patternBanks.drums808.length > 0
      ? songData.patternBanks.drums808
      : songData.patternBanks.drums909;
    const numDrums = Math.min(maxSlots, drumBank.length);
    for (let i = 0; i < numDrums; i++) {
      const dp = drumBank[i];
      kickSlots[i] = this.convertDrumPattern(dp.kick, numSteps, 'kick');
      snareSlots[i] = this.convertDrumPattern(dp.snare, numSteps, 'snare');
      closedHatSlots[i] = this.convertDrumPattern(dp.closedHat, numSteps, 'closedHat');
      openHatSlots[i] = this.convertDrumPattern(dp.openHat, numSteps, 'openHat');
    }

    // Build songStructure from TRAK events (pattern changes over time)
    const songStructure: Array<Record<string, number | null>> = [];
    const totalBars = Math.min(songData.totalLengthBars, 64); // max arrangement measures

    // Find the main track for pattern select events
    const tb303_1Track = songData.tracks.find(t => t.trackIndex === TRAK_TRACK_INDEX.TB303_1);
    const tb303_2Track = songData.tracks.find(t => t.trackIndex === TRAK_TRACK_INDEX.TB303_2);
    const drumsTrack = songData.tracks.find(t => t.trackIndex === TRAK_TRACK_INDEX.TR808)
      || songData.tracks.find(t => t.trackIndex === TRAK_TRACK_INDEX.TR909);

    for (let bar = 0; bar < totalBars; bar++) {
      const barStart = bar * TICKS_PER_BAR;
      const barEnd = barStart + TICKS_PER_BAR;

      // Find the active pattern for each track at this bar
      const partAIdx = this.findActivePatternAtTick(tb303_1Track, barStart, maxSlots);
      const partBIdx = this.findActivePatternAtTick(tb303_2Track, barStart, maxSlots);
      const drumIdx = this.findActivePatternAtTick(drumsTrack, barStart, maxSlots);

      songStructure.push({
        partA: partAIdx,
        partB: partBIdx,
        bass2: this.options.tb303BTarget === 'bass2' ? partBIdx : null,
        kick: drumIdx,
        snare: drumIdx,
        closedHat: drumIdx,
        openHat: drumIdx,
        sampler: null,
      });
    }

    // Collect all TRAK events for sub-step automation scheduling
    const allTrakEvents = songData.tracks.flatMap(t => t.events);

    if (songData.usedPatternCount > maxSlots) {
      warnings.push(`Song uses ${songData.usedPatternCount} patterns but Hyphon supports ${maxSlots} slots. Excess patterns truncated.`);
    }

    return {
      mode: songData.glob.playMode === 1 ? 'song' : 'pattern',
      trackStorage: {
        partA: partASlots,
        partB: partBSlots,
        bass2: bass2Slots,
        kick: kickSlots,
        snare: snareSlots,
        closedHat: closedHatSlots,
        openHat: openHatSlots,
      },
      songStructure,
      loopStart: songData.glob.loopStart || undefined,
      loopEnd: songData.glob.loopEnd || undefined,
      trakEvents: allTrakEvents.length > 0 ? allTrakEvents : undefined,
    };
  }

  /**
   * Find the active pattern index at a given tick position for a track.
   * Scans pattern-select events (controller 0) and returns the last pattern set before `tick`.
   */
  private findActivePatternAtTick(
    track: RbsSongData['tracks'][number] | undefined,
    tick: number,
    maxSlots: number
  ): number | null {
    if (!track || track.events.length === 0) return 0;

    let activePattern = 0;
    for (const evt of track.events) {
      if (evt.absoluteTicks > tick) break;
      if (evt.controllerId === 0) { // pattern select
        activePattern = evt.value;
      }
    }

    // Clamp to available slots
    return activePattern < maxSlots ? activePattern : 0;
  }

  private extractTb303Params(tb303: { cutoff: number; resonance: number; envMod: number; decay: number; accent: number; waveform: 0 | 1; distortion?: number; delaySend?: number }) {
    const { ...params } = tb303;
    return params;
  }

  /**
   * Count total steps across all patterns
   */
  private countSteps(raw: RawRbsData): number {
    const stepLength = this.options.expandTo32Steps ? 32 : raw.project.patternLength;
    // 2x 303 patterns + 4 drum tracks
    return stepLength * 6;
  }

  /**
   * Map a value from one range to another (linear)
   */
  private mapRange(value: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
    const clampedValue = Math.max(inMin, Math.min(inMax, value));
    return ((clampedValue - inMin) * (outMax - outMin)) / (inMax - inMin) + outMin;
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

  /**
   * Get step conversion statistics from last conversion
   */
  getStepStats(): StepConversionStats {
    return { ...this.stepStats };
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
