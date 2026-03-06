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
  RbsRawAutomationLane
} from './types';

export { DEFAULT_RBS_IMPORT_OPTIONS, AUTOMATION_PARAMETER_MAP } from './types';

// Parser
export { RbsParser, parseRbsFile } from './RbsParser';
export type { RbsParserResult, RbsParserError } from './RbsParser';

// Importer
export { RbsImporter, convertToHyphonSong } from './RbsImporter';
export type { RbsImportResult, ImportReport, RbsImportError } from './RbsImporter';
