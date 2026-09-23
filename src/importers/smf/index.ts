/**
 * SMF (Standard MIDI File) importer/exporter module.
 *
 * Import/export .mid files (format 0/1) — the generic DAW-interchange path,
 * independent of `src/importers/rbs/**` (the Electribe/ReBirth-native path).
 *
 * Usage:
 * ```typescript
 * import { parseSmfFile, convertToHyphonSong } from './importers/smf';
 *
 * const result = await parseSmfFile(file);
 * if (result.success) {
 *   const importResult = convertToHyphonSong(result.data);
 *   if (importResult.success) loadSong(importResult.song);
 * }
 * ```
 */

export type {
  ParsedSmf,
  SmfNoteEvent,
  SmfControlChangeEvent,
  SmfProgramChangeEvent,
  SmfTempoEvent,
  SmfTimeSignatureEvent,
  SmfTrackMeta,
  SmfParserError,
  SmfParserResult,
  SmfChannelMapEntry,
  SmfImportOptions,
  SmfImportReport,
  SmfImportResult,
  HyphonSmfSong,
  SmfAutomationLane,
} from './types';

export {
  DEFAULT_SMF_IMPORT_OPTIONS,
  DEFAULT_SMF_CHANNEL_MAP,
  GM_DRUM_NOTE_MAP,
} from './types';

export { SmfParser, parseSmfBytes, parseSmfFile, DEFAULT_PPQ, MIN_SMF_FILE_SIZE, MAX_SMF_FILE_SIZE } from './SmfParser';
export { convertToHyphonSong } from './SmfImporter';
export { SmfExporter, exportSmfFile, hyphonSongFromSavedDataForSmf } from './SmfExporter';
export type { SmfExportOptions, SmfExportResult } from './SmfExporter';
