/**
 * RBS Importer Module
 * 
 * Import .rbs files from ReBirth RB-338 and Roland-pattern-compatible sequencers.
 * 
 * Usage:
 * ```typescript
 * import { RbsParser, RbsImporter, parseRbsFile, convertToHyphonSong } from './importers/rbs';
 * 
 * // Parse RBS file
 * const result = await parseRbsFile(file);
 * if (result.success) {
 *   // Convert to Hyphon format
 *   const importResult = convertToHyphonSong(result.data);
 *   if (importResult.success) {
 *     loadSong(importResult.song);
 *   }
 * }
 * ```
 */

// Types
export type {
  RawRbsData,
  RbsProject,
  Tb303PatternA,
  Tb303PatternB,
  DrumPattern,
  PcfSettings,
  AutomationLane,
  HyphonAutomationLane,
  Tb303Step,
  HyphonSong,
  RbsImportOptions,
  StepConversionStats,
  DetailedParameterMapping,
  // Binary parsing types
  RbsBinaryHeader,
  RbsRawStep,
  RbsRawAutomationPoint,
  RbsRawAutomationLane,
  // IFF CAT RB40 song types
  RbsGlobData,
  RbsTrakEvent,
  RbsTrakData,
  RbsSongData,
} from './types';

export {
  DEFAULT_RBS_IMPORT_OPTIONS,
  AUTOMATION_PARAMETER_MAP,
  TRAK_CONTROLLER,
  TRAK_TRACK_INDEX,
  TRAK_TRACK_CONTROLLER_MAP,
  TB303_TRAK_CONTROLLER,
  MIXER_TRAK_CONTROLLER,
  PCF_TRAK_CONTROLLER,
  resolveTrakEventKind,
  isTrakPatternSelectEvent,
  isTrakParamAutomationEvent,
  resolveTrakParamMapping,
  resolveHyphonLaneToTrak,
  normaliseTrakParamValue,
  TICKS_PER_BAR,
  TICKS_PER_STEP,
} from './types';

// Parser
export { RbsParser, parseRbsFile } from './RbsParser';
export type { RbsParserResult, RbsParserError, RbsErrorCode } from './parser-types';
export { classifyParserError, RBS_ERROR_CODES } from './parser-types';

// New spec-driven Rebirth parser (recommended API per technical spec)
export { RebirthRBSParser, parseRebirthRBSFile } from './RebirthRBSParser';
export type {
  RebirthParseResult,
  RbsHeaderData,
  RbsPatternData,
  RbsSynthParameters,
  RbsSongArrangement,
  RbsAutomationData,
} from './RebirthRBSParser';

// Importer
export { RbsImporter, convertToHyphonSong } from './RbsImporter';
export type { RbsImportResult, ImportReport, RbsImportError } from './importer-types';

// Exporter
export { RbsExporter, exportRbsFile, hyphonSongFromSavedData, shouldExportRbsSongMode } from './RbsExporter';
export { applyPcfFilterToEffect, applyTrackParamSlotToEngine, pcfFilterToPcfSettings } from './applyImportedEngineState';
export type { TrackParamStorage } from './applyImportedEngineState';
export { trakEventsFromAutomationLanes } from './trakExport';
export type { RbsExportOptions, RbsExportResult, RbsExportVersionTarget, RbsExportMode } from './exporter-types';
export { DEFAULT_RBS_EXPORT_OPTIONS } from './exporter-types';
