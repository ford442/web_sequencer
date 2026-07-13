import type {
  RawRbsData, HyphonSong, RbsImportOptions, Tb303Step, PcfSettings, AutomationLane,
  HyphonAutomationLane, StepConversionStats, DetailedParameterMapping, RbsSongData, Tb303PatternA
} from './types';
import { DEFAULT_RBS_IMPORT_OPTIONS, TICKS_PER_BAR, TRAK_TRACK_INDEX } from './types';
import { MAX_TRACK_PATTERN_SLOTS } from '../../constants';
import { deriveActiveTrackSlotsFromStructure } from '../../utils/trackStorageUtils';
import { isTrakParamAutomationEvent, isTrakPatternSelectEvent } from './trakControllers';
import { isV15SubsetVersion } from './parser-types';
import { inferDevicesPresent, drumBankHasTriggers } from './deviceInference';
import type {
  Pattern, PartSequence, Note, SynthParams, KickParams, SnareParams, HatParams, Bass2Params, Waveform
} from '../../types';
import { noteToMidi, midiToNote } from '../../utils/musicTheory';
import type { RbsImportResult, ImportReport, TrackStats, StepStats, PCFStats, AutomationStats } from './importer-types';
import { clampNormalized, TB303_DEFAULT_SLIDE_TIME } from './importer-types';

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
    const warnings: string[] = [...this.buildFormatWarnings(raw)];
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
    const pcfStats = this.buildPcfReportStats(raw);
    const devicesPresent = raw.devicesPresent ?? inferDevicesPresent(raw);

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
        pcfStats,
        slideCount: this.stepStats.slideCount,
        accentCount: this.stepStats.accentCount,
        stepStats: this.stepStats,
        songMode: songModeReport,
        formatVersion: raw.version,
        devicesPresent,
        parsePath: raw.parsePath,
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
   * - Each 16th maps to two 32nd sub-steps
   * - Slides span both sub-steps of their source 16th (length 2, second slot null)
   * - Ties extend the previous note's length without placing new Note objects
   *   (avoids envelope re-trigger on sustained notes)
   * - Accents apply to the first sub-step only
   */
  private expandPattern16To32(steps16: Tb303Step[], _isBassTrack: boolean): PartSequence {
    const steps32: (Note | null)[] = Array(32).fill(null);

    for (let i = 0; i < 16; i++) {
      const sourceStep = steps16[i];

      if (sourceStep.tie) {
        this.stepStats.tieCount++;
        continue;
      }

      if (sourceStep.note === -1) {
        continue;
      }

      const targetIndex1 = i * 2;

      let tieCount = 0;
      while (i + 1 + tieCount < 16 && steps16[i + 1 + tieCount].tie) {
        tieCount++;
        this.stepStats.tieCount++;
      }

      const midiNote = (sourceStep.octave + 1) * 12 + sourceStep.note;
      const noteName = midiToNote(midiNote);

      const baseVelocity = 0.8;
      const accentBoost = sourceStep.accent ? this.convertAccentToBoost(127) : 0;
      const velocity1 = Math.min(1.0, baseVelocity + accentBoost);

      if (sourceStep.slide) this.stepStats.slideCount++;
      if (sourceStep.accent) this.stepStats.accentCount++;

      if (sourceStep.slide) {
        steps32[targetIndex1] = {
          note: noteName,
          velocity: velocity1,
          length: 2,
          slide: true,
          timbre: 0.5,
        };
        steps32[targetIndex1 + 1] = null;
        continue;
      }

      const sustainSubSteps = tieCount > 0 ? (1 + tieCount) * 2 : 1;
      steps32[targetIndex1] = {
        note: noteName,
        velocity: velocity1,
        length: sustainSubSteps,
        slide: false,
        timbre: 0.5,
      };
    }

    this.stepStats.totalSteps += 32;
    return { steps: steps32 };
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
    let drumKit = this.resolveDrumKitType(raw);
    if (this.options.drumKitMapping !== 'auto') {
      drumKit = this.options.drumKitMapping;
    }
    const { kick, snare, closedHat, openHat } = this.convertDrumParams(raw.drums, mappings, drumKit);

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
      slideTime: (tb303.slideTime ?? TB303_DEFAULT_SLIDE_TIME) / 127,
    };
  }

  /**
   * Convert drum parameters with kit-specific mapping (808 vs 909)
   */
  private convertDrumParams(
    drums: RawRbsData['drums'],
    mappings: DetailedParameterMapping[],
    kitType: '808' | '909',
  ): { kick: KickParams; snare: SnareParams; closedHat: HatParams; openHat: HatParams } {
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

    // Convert pattern banks to Hyphon track storage (up to 32 ReBirth pattern slots)
    const maxSlots = MAX_TRACK_PATTERN_SLOTS;
    const partASlots: (Pattern['partA'] | null)[] = Array(maxSlots).fill(null);
    const partBSlots: (Pattern['partB'] | null)[] = Array(maxSlots).fill(null);
    const bass2Slots: (Pattern['bass2'] | null)[] = Array(maxSlots).fill(null);
    const kickSlots: (Pattern['kick'] | null)[] = Array(maxSlots).fill(null);
    const snareSlots: (Pattern['snare'] | null)[] = Array(maxSlots).fill(null);
    const closedHatSlots: (Pattern['closedHat'] | null)[] = Array(maxSlots).fill(null);
    const openHatSlots: (Pattern['openHat'] | null)[] = Array(maxSlots).fill(null);

    // Map pattern banks to track storage (up to 32 ReBirth slots)
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

    // Build songStructure from TRAK events (one measure per bar in arrangement)
    const songStructure: Array<Record<string, number | null>> = [];
    const totalBars = Math.max(1, songData.totalLengthBars);

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

    // Collect TRAK events: full stream + param-only subset for sub-step automation.
    const allTrakEvents = songData.tracks.flatMap((t) => t.events);
    const trakParamEvents = allTrakEvents.filter((ev) =>
      isTrakParamAutomationEvent(ev.trackIndex, ev.controllerId, ev.eventKind),
    );

    if (songData.usedPatternCount > maxSlots) {
      warnings.push(
        `Song uses ${songData.usedPatternCount} patterns but Hyphon supports ${maxSlots} slots. Excess patterns truncated.`,
      );
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
      trackParamStorage: {
        synthA: this.buildTrackParamSlots(songData.patternBanks.tb303A, maxSlots, false),
        synthB: this.buildTrackParamSlots(songData.patternBanks.tb303B, maxSlots, false),
        bass2: this.options.tb303BTarget === 'bass2'
          ? this.buildTrackParamSlots(songData.patternBanks.tb303B, maxSlots, true)
          : Array(maxSlots).fill(null),
      },
      songStructure,
      activeTrackSlots: deriveActiveTrackSlotsFromStructure(songStructure),
      loopStart: songData.glob.loopStart || undefined,
      loopEnd: songData.glob.loopEnd || undefined,
      trakEvents: allTrakEvents.length > 0 ? allTrakEvents : undefined,
      trakParamEvents: trakParamEvents.length > 0 ? trakParamEvents : undefined,
    };
  }

  /**
   * Find the active pattern index at a given tick position for a track.
   * Scans pattern-select events and returns the last pattern set before `tick`.
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
      if (isTrakPatternSelectEvent(evt.trackIndex, evt.controllerId, evt.eventKind)) {
        activePattern = evt.value;
      }
    }

    // Pattern indices 0–31 are valid when maxSlots is 32
    if (activePattern >= maxSlots) {
      return maxSlots - 1;
    }
    return activePattern;
  }

  /** Map TB-303 pattern device params to Hyphon synth params (no mapping report noise). */
  private mapTb303PatternToSynthParams(
    tb303: Tb303PatternA,
    asBass2: boolean,
  ): Partial<SynthParams> | Partial<Bass2Params> {
    if (asBass2) {
      return this.convertToBass2Params(tb303, 'tb303B', undefined);
    }
    const waveform: Waveform = tb303.waveform === 0 ? '303-saw' : '303-sqr';
    const cutoffHz = this.convertCutoffToHz(tb303.cutoff);
    const resonance = this.convertResonance(tb303.resonance);
    const decaySeconds = this.convertDecayToSeconds(tb303.decay);
    const filterMode = clampNormalized(tb303.envMod / 127);
    const volume = 0.6 + this.convertAccentToBoost(tb303.accent);
    const portamento = clampNormalized((tb303.slideTime ?? TB303_DEFAULT_SLIDE_TIME) / 127);
    return {
      waveform,
      pitch: 0,
      filterCutoff: cutoffHz,
      filterResonance: resonance,
      filterMode,
      attack: 0.01,
      decay: decaySeconds,
      sustain: 0.5,
      release: 0.1,
      volume,
      portamento,
    };
  }

  private buildTrackParamSlots(
    patterns: Tb303PatternA[],
    maxSlots: number,
    asBass2: boolean,
  ): (Partial<SynthParams> | Partial<Bass2Params> | null)[] {
    const slots: (Partial<SynthParams> | Partial<Bass2Params> | null)[] = Array(maxSlots).fill(null);
    const count = Math.min(maxSlots, patterns.length);
    for (let i = 0; i < count; i++) {
      slots[i] = this.mapTb303PatternToSynthParams(patterns[i], asBass2);
    }
    return slots;
  }

  /**
   * Resolve drum kit for import. In `auto` mode prefers TR-808 when only 808 data is present
   * (typical v1.5 subset).
   */
  private resolveDrumKitType(raw: RawRbsData): '808' | '909' {
    if (this.options.drumKitMapping !== 'auto') {
      return this.options.drumKitMapping;
    }

    const banks = raw.songData?.patternBanks;
    if (banks) {
      const has808 = drumBankHasTriggers(banks.drums808);
      const has909 = drumBankHasTriggers(banks.drums909);
      if (has808 && !has909) return '808';
      if (has909 && !has808) return '909';
    }

    const devices = raw.devicesPresent ?? inferDevicesPresent(raw);
    if (devices.includes('808') && !devices.includes('909')) return '808';
    if (devices.includes('909') && !devices.includes('808')) return '909';

    return raw.drums.kitType;
  }

  /** Warnings for v1.5 subset files missing v2.0 devices/features. */
  private buildFormatWarnings(raw: RawRbsData): string[] {
    const warnings: string[] = [];
    const devices = raw.devicesPresent ?? inferDevicesPresent(raw);

    if (isV15SubsetVersion(raw.version)) {
      if (!devices.includes('303-2')) {
        warnings.push('v1.5 subset: TB-303 #2 not present — partB/synthB pattern left empty');
      }
      if (!devices.includes('909')) {
        warnings.push('v1.5 subset: TR-909 not present — using TR-808 drum mapping');
      }
      if (raw.songData?.glob.playMode === 1 && (raw.songData.tracks.length === 0)) {
        warnings.push('v1.5 subset: song mode requested but TRKL arrangement data is missing');
      }
    }

    return warnings;
  }

  private buildPcfReportStats(raw: RawRbsData): ImportReport['pcfStats'] {
    const p = raw.pcf;
    const patternMin = p.pattern.length > 0 ? Math.min(...p.pattern) : 0;
    const patternMax = p.pattern.length > 0 ? Math.max(...p.pattern) : 0;
    const targets: string[] = [];
    if (p.target.tb303A) targets.push('synthA');
    if (p.target.tb303B) targets.push('synthB');
    if (p.target.drums) targets.push('drums');

    const source: 'devl' | 'legacy' | 'none' =
      raw.songData ? 'devl' : (p.enabled ? 'legacy' : 'none');

    return {
      waveIndex: p.waveIndex ?? -1,
      patternMin,
      patternMax,
      patternVariance: patternMax - patternMin,
      targets,
      source,
    };
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
