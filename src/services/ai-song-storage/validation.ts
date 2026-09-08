import type { AISongData } from '../../importers/ai-song/types';
import type { Pattern, PartSequence, SavedSongData } from '../../types';
import type { StorageErrorInfo } from './types';

/** True when any track sequence in the pattern holds at least one note. */
function hasAnyNote(pattern: Pattern): boolean {
  const sequences: (PartSequence | PartSequence[] | undefined)[] = Object.values(pattern);
  return sequences.some((entry) => {
    const parts = Array.isArray(entry) ? entry : entry ? [entry] : [];
    return parts.some((part) => part?.steps?.some((step) => step !== null));
  });
}

/**
 * Validate song data before upload
 * Catches issues early to prevent failed uploads
 */
export function validateBeforeUpload(
  aiData: AISongData,
  hyphonSong: SavedSongData
): StorageErrorInfo | null {
  // Validate AI data
  if (!aiData.meta?.title || aiData.meta.title.trim().length === 0) {
    return {
      category: 'VALIDATION',
      message: 'Song title is required',
      userMessage: 'Please provide a song title before uploading.',
      retryable: false,
      timestamp: new Date().toISOString(),
      field: 'title'
    };
  }

  if (!aiData.meta?.author || aiData.meta.author.trim().length === 0) {
    return {
      category: 'VALIDATION',
      message: 'Author is required',
      userMessage: 'Please provide an author name before uploading.',
      retryable: false,
      timestamp: new Date().toISOString(),
      field: 'author'
    };
  }

  if (!aiData.meta?.prompt || aiData.meta.prompt.trim().length === 0) {
    return {
      category: 'VALIDATION',
      message: 'Prompt is required for AI-generated songs',
      userMessage: 'AI prompt information is missing. Please ensure the song has generation metadata.',
      retryable: false,
      timestamp: new Date().toISOString(),
      field: 'prompt'
    };
  }

  // Validate Hyphon data.
  // SavedSongData stores note data on `pattern` (plus the per-slot
  // `trackStorage`) and the transport rate on `tempo` — there are no
  // `tracks` / `bpm` fields.
  if (!hyphonSong.pattern || !hyphonSong.trackStorage) {
    return {
      category: 'VALIDATION',
      message: 'Song must have at least one track',
      userMessage: 'Please add at least one track to the song before uploading.',
      retryable: false,
      timestamp: new Date().toISOString(),
      field: 'pattern'
    };
  }

  if (!hasAnyNote(hyphonSong.pattern)) {
    return {
      category: 'VALIDATION',
      message: 'Song must have at least one note',
      userMessage: 'This song is empty. Please add at least one note before uploading.',
      retryable: false,
      timestamp: new Date().toISOString(),
      field: 'pattern'
    };
  }

  if (!hyphonSong.tempo || hyphonSong.tempo < 1 || hyphonSong.tempo > 999) {
    return {
      category: 'VALIDATION',
      message: 'Invalid tempo value',
      userMessage: 'Please set a valid tempo (1-999 BPM) before uploading.',
      retryable: false,
      timestamp: new Date().toISOString(),
      field: 'tempo'
    };
  }

  // Check data size (rough estimate)
  const dataSize = JSON.stringify({ aiData, hyphonSong }).length;
  if (dataSize > 10 * 1024 * 1024) { // 10MB limit
    return {
      category: 'VALIDATION',
      message: 'Song data exceeds maximum size',
      userMessage: 'The song data is too large. Please reduce the number of notes or patterns.',
      retryable: false,
      timestamp: new Date().toISOString(),
      field: 'size'
    };
  }

  return null;
}
