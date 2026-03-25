/**
 * Utility functions and types for the RBS Import Modal.
 */

import type { RbsParserError } from '../importers/rbs';

// ============================================================================
// TYPES
// ============================================================================

export type ParseStage = 'idle' | 'reading' | 'parsing' | 'converting' | 'complete' | 'error';
export type ErrorCategory = 'INVALID_FORMAT' | 'CORRUPTED_DATA' | 'UNSUPPORTED_VERSION' | 'READ_ERROR';

export interface ParseState {
  stage: ParseStage;
  progress: number;
  stageLabel: string;
  error?: RbsParserError;
  category?: ErrorCategory;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Categorize parser error
 */
export function categorizeError(error: RbsParserError): ErrorCategory {
  switch (error.type) {
    case 'INVALID_FORMAT':
      return 'INVALID_FORMAT';
    case 'UNSUPPORTED_VERSION':
      return 'UNSUPPORTED_VERSION';
    case 'CORRUPTED_DATA':
      return 'CORRUPTED_DATA';
    case 'READ_ERROR':
      return 'READ_ERROR';
    default:
      return 'INVALID_FORMAT';
  }
}

/**
 * Get human-readable error message
 */
export function getErrorMessage(error: RbsParserError): string {
  switch (error.type) {
    case 'INVALID_FORMAT':
      return error.message;
    case 'UNSUPPORTED_VERSION':
      return `RBS version ${error.version} is not supported. Supported versions: ${error.supported.join(', ')}`;
    case 'CORRUPTED_DATA':
      return `Corrupted data in ${error.section}${error.details ? `: ${error.details}` : ''}`;
    case 'READ_ERROR':
      return `Read error: ${error.message}`;
    default:
      return 'Unknown error';
  }
}

/**
 * Get error suggestions based on category
 */
export function getErrorSuggestions(category: ErrorCategory): string[] {
  switch (category) {
    case 'INVALID_FORMAT':
      return [
        'Ensure the file has a .rbs extension',
        'Check that the file is a valid ReBirth RB-338 file',
        'Try re-exporting from ReBirth if possible'
      ];
    case 'CORRUPTED_DATA':
      return [
        'The file may be damaged or incomplete',
        'Try opening and re-saving in ReBirth',
        'Check if the file was transferred correctly'
      ];
    case 'UNSUPPORTED_VERSION':
      return [
        'This version of RBS is not yet supported',
        'Try exporting in a compatible format',
        'Contact support for version compatibility info'
      ];
    case 'READ_ERROR':
      return [
        'Check file permissions',
        'Ensure the file is not open in another program',
        'Try refreshing the page and importing again'
      ];
  }
}

/**
 * Get progress bar color based on stage
 */
export function getProgressColor(stage: ParseStage): string {
  switch (stage) {
    case 'idle': return 'bg-gray-700';
    case 'reading': return 'bg-amber-500';
    case 'parsing': return 'bg-amber-500';
    case 'converting': return 'bg-emerald-500';
    case 'complete': return 'bg-emerald-500';
    case 'error': return 'bg-red-500';
  }
}

/**
 * Convert TB-303 note number to note name
 */
export function noteToName(note: number, octave: number): string {
  if (note === -1) return '—';
  const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return `${notes[note]}${octave}`;
}

/**
 * Generate example RBS file for testing
 */
export function generateExampleRbsFile(): File {
  // Create a minimal RBS-like binary structure
  // This is a mock that will trigger the parser's mock data generation
  const header = new Uint8Array([
    0x52, 0x42, 0x53, 0x00, // "RBS\0" magic
    0x32, 0x2E, 0x30, 0x00, // "2.0\0" version
  ]);

  // Add some padding to make it look like a valid file
  const padding = new Uint8Array(200).fill(0);
  const data = new Uint8Array([...header, ...padding]);

  return new File(
    [data],
    'Demo_Acid_130BPM.rbs',
    { type: 'application/octet-stream' }
  );
}
