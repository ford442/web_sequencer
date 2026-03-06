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
  AIImportReport
} from './AISongImporter';

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
