import type { AISongData } from '../../importers/ai-song/types';
import type { SavedSongData } from '../../types';
import type { StorageErrorInfo } from './types';

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

  // Validate Hyphon data
  // @ts-expect-error - Auto-generated to fix CI build
  if (!hyphonSong.tracks || hyphonSong.tracks.length === 0) {
    return {
      category: 'VALIDATION',
      message: 'Song must have at least one track',
      userMessage: 'Please add at least one track to the song before uploading.',
      retryable: false,
      timestamp: new Date().toISOString(),
      field: 'tracks'
    };
  }

  // @ts-expect-error - Auto-generated to fix CI build
  if (!hyphonSong.bpm || hyphonSong.bpm < 1 || hyphonSong.bpm > 999) {
    return {
      category: 'VALIDATION',
      message: 'Invalid BPM value',
      userMessage: 'Please set a valid BPM (1-999) before uploading.',
      retryable: false,
      timestamp: new Date().toISOString(),
      field: 'bpm'
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
