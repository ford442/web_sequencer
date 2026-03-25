import type { AIImportErrorDetails } from '../importers/ai-song';
import type { ErrorCategory, ValidationStage } from '../types/aiSongModal';

/**
 * Generate unique ID for files
 */
export function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}

/**
 * Auto-fix common JSON issues
 */
export function fixCommonJsonIssues(json: string): { fixed: string; changes: string[] } {
  const changes: string[] = [];
  let fixed = json;

  // Remove markdown code fences
  const codeFenceMatch = fixed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeFenceMatch) {
    fixed = codeFenceMatch[1].trim();
    changes.push('Removed markdown code fences');
  }

  // Fix trailing commas
  const beforeTrailingComma = fixed;
  fixed = fixed.replace(/,(\s*[}\]])/g, '$1');
  if (fixed !== beforeTrailingComma) {
    changes.push('Fixed trailing commas');
  }

  // Fix single quotes to double quotes (basic)
  const beforeQuotes = fixed;
  fixed = fixed.replace(/'([^']*)':/g, '"$1":');
  fixed = fixed.replace(/: '([^']*)'/g, ': "$1"');
  if (fixed !== beforeQuotes) {
    changes.push('Converted single quotes to double quotes');
  }

  // Fix missing quotes around property names
  const beforePropQuotes = fixed;
  fixed = fixed.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)(\s*:)/g, '$1"$2"$3');
  if (fixed !== beforePropQuotes) {
    changes.push('Added quotes around property names');
  }

  return { fixed, changes };
}

/**
 * Categorize error type
 */
export function categorizeError(error: string | AIImportErrorDetails): ErrorCategory {
  const errorStr = typeof error === 'string' ? error : JSON.stringify(error);

  if (errorStr.includes('JSON') || errorStr.includes('parse') || errorStr.includes('Unexpected')) {
    return 'JSON_SYNTAX';
  }
  if (errorStr.includes('VALIDATION') || errorStr.includes('required') || errorStr.includes('must be')) {
    return 'SCHEMA_VIOLATION';
  }
  if (errorStr.includes('CONVERSION')) {
    return 'CONVERSION_ERROR';
  }
  if (errorStr.includes('STORAGE') || errorStr.includes('upload') || errorStr.includes('network')) {
    return 'NETWORK_ERROR';
  }
  return 'SCHEMA_VIOLATION';
}

/**
 * Get error suggestions based on category
 */
export function getErrorSuggestions(category: ErrorCategory): string[] {
  switch (category) {
    case 'JSON_SYNTAX':
      return [
        'Check for missing commas or brackets',
        'Ensure all strings are in double quotes',
        'Remove any trailing commas before closing braces',
        'Try the "Fix Common Issues" button'
      ];
    case 'SCHEMA_VIOLATION':
      return [
        'Verify the meta.title field exists and is a string',
        'Check that globals.tempo is a number between 30-300',
        'Ensure tracks object contains valid track data',
        'Version must be exactly "1.0"'
      ];
    case 'CONVERSION_ERROR':
      return [
        'Check note formats (e.g., "C4", "F#3")',
        'Ensure step values are within 0-31',
        'Verify velocity values are between 0-1'
      ];
    case 'NETWORK_ERROR':
      return [
        'Check your internet connection',
        'The song can still be imported locally',
        'Try uploading again later'
      ];
  }
}

/**
 * Get validation status color for status bar
 */
export function getValidationColor(stage: ValidationStage): string {
  switch (stage) {
    case 'idle': return 'bg-gray-700';
    case 'parsing': return 'bg-yellow-500';
    case 'validating': return 'bg-yellow-500';
    case 'converting': return 'bg-emerald-500';
    case 'complete': return 'bg-emerald-500';
    case 'error': return 'bg-red-500';
  }
}

/**
 * Get textarea border color based on validation state
 */
export function getTextareaBorderColor(stage: ValidationStage, hasContent: boolean): string {
  if (!hasContent) return 'border-gray-800 focus:border-emerald-500/50';
  switch (stage) {
    case 'idle':
    case 'parsing':
    case 'validating':
      return 'border-yellow-500/50 focus:border-yellow-500';
    case 'converting':
    case 'complete':
      return 'border-emerald-500/50 focus:border-emerald-500';
    case 'error':
      return 'border-red-500/50 focus:border-red-500';
  }
}

/**
 * Format file size
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Get file icon based on extension
 */
export function getFileIcon(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'json': return '📄';
    case 'txt': return '📝';
    case 'md': return '📑';
    default: return '📎';
  }
}
