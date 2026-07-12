import type {
  RawRbsData, HyphonSong, RbsImportOptions, HyphonAutomationLane,
  StepConversionStats, DetailedParameterMapping,
} from './types';
import { DEFAULT_RBS_IMPORT_OPTIONS } from './types';
import { inferDevicesPresent } from './deviceInference';
import type { RbsImportResult } from './importer-types';
import type { ImporterContext } from './importer/importerContext';
import { convertPattern } from './importer/patternConversion';
import { convertSynthParams } from './importer/synthParams';
import {
  convertPcfToAutomation,
  convertAutomationLanes,
  resolveTb303Target,
  generateAccentSlideAutomation,
} from './importer/automationConversion';
import { buildSongArrangement } from './importer/songArrangement';
import {
  buildFormatWarnings,
  buildPcfReportStats,
  countSteps,
  extractTb303Params,
} from './importer/report';

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
      totalSteps: 0,
    };
  }

  private ctx(): ImporterContext {
    return { options: this.options, stepStats: this.stepStats };
  }

  /**
   * Main entry point: convert RawRbsData to HyphonSong
   */
  convertToHyphonSong(raw: RawRbsData): RbsImportResult {
    const warnings: string[] = [...buildFormatWarnings(raw)];
    const mappings: DetailedParameterMapping[] = [];

    this.stepStats = {
      slideCount: 0,
      accentCount: 0,
      tieCount: 0,
      totalSteps: 0,
    };
    const ctx = this.ctx();

    const pattern = convertPattern(ctx, raw, warnings);
    const params = convertSynthParams(ctx, raw, mappings);

    const automation: HyphonAutomationLane[] = [];
    if (this.options.convertPcfToAutomation && raw.pcf.enabled && !this.options.importPcfAsFilter) {
      automation.push(...convertPcfToAutomation(ctx, raw.pcf));
    }

    automation.push(...convertAutomationLanes(ctx, raw.automation));

    const tb303ATarget = resolveTb303Target(this.options.tb303ATarget);
    const tb303BTarget = resolveTb303Target(this.options.tb303BTarget);
    automation.push(
      ...generateAccentSlideAutomation(ctx, raw.tb303PatternA.steps, tb303ATarget, raw.tb303PatternA.accent / 127),
      ...generateAccentSlideAutomation(ctx, raw.tb303PatternB.steps, tb303BTarget, raw.tb303PatternB.accent / 127),
    );

    const song: HyphonSong = {
      version: 1,
      metadata: {
        name: raw.project.name,
        author: raw.project.author,
        importedFrom: 'rbs',
        originalSource: raw.project.sourceSoftware,
        importedAt: new Date(),
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
        tb303AParams: extractTb303Params(raw.tb303PatternA),
        tb303BParams: extractTb303Params(raw.tb303PatternB),
      },
      songArrangement: raw.songData ? buildSongArrangement(ctx, raw, warnings) : undefined,
    };

    const stepsConverted = countSteps(ctx, raw);

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

    const pcfStats = buildPcfReportStats(raw);
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
      },
    };
  }

  setOptions(options: Partial<RbsImportOptions>): void {
    this.options = { ...this.options, ...options };
  }

  getOptions(): RbsImportOptions {
    return { ...this.options };
  }

  getStepStats(): StepConversionStats {
    return { ...this.stepStats };
  }
}

/** Convenience function for direct conversion */
export function convertToHyphonSong(
  raw: RawRbsData,
  options?: Partial<RbsImportOptions>,
): RbsImportResult {
  const importer = new RbsImporter(options);
  return importer.convertToHyphonSong(raw);
}

export default RbsImporter;
