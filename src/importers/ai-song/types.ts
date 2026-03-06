/**
 * AI Song Importer Types
 *
 * Re-exported from AISongImporter.ts for clean module structure
 */

export type {
  AISongData,
  AITrackData,
  AINoteEvent,
  AISamplerBankData,
  AIImportResult,
  AIImportError,
  AIImportErrorDetails,
  AIImportResultType,
  AIImportReport,
  // Effects types
  AIEffectsChain,
  AIMasterEffects,
  AITrackEffects,
  AICompressorSettings,
  AIDistortionSettings,
  AIDelaySettings,
  AIReverbSettings,
  AIFilterSettings,
  AIChorusSettings,
  AIPhaserSettings,
  AIHarmonizerConfig,
  AIPhonemePainterConfig,
  AIPhonemeMapping,
  // Automation (from AISongImporter)
  AIAutomationLane,
  AIAutomationTarget,
  AITargetedParameter,
  AIInterpolationMode
} from './AISongImporter';

// Automation utilities (from automation module)
export type {
  AutomationValidationError,
  AutomationValidationResult,
  AutomationLaneSummary
} from './automation';

export { isValidNote } from './AISongImporter';

// ============================================================================
// VERSIONING TYPES
// ============================================================================

export type {
  VersionEntry,
  PreviewData,
  VersionHistory
} from './versioning';

export {
  generateVersionId,
  createVersionEntry,
  initializeVersionHistory,
  addVersion,
  getVersionById,
  getCurrentVersion,
  generatePreviewData,
  serializeVersionHistory,
  deserializeVersionHistory
} from './versioning';
