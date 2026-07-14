// src/services/ai-song-storage/index.ts
// Bulletproof AI Song Storage with enhanced reliability
// Integrates with HF Storage Manager API for AI song persistence

export {
  AI_SONGS_FOLDER,
  AI_GENERATORS,
  AI_FOLDERS,
  RETRY_CONFIG,
  DB_CONFIG
} from './constants';
export type { AIGenerator } from './constants';

export type {
  AISongVersion,
  AISongMetadata,
  AISongSearchFilters,
  AISongUploadOptions,
  ErrorCategory,
  StorageErrorInfo,
  PendingUpload,
  VersionDiff,
  GeneratorStats,
  GeneratorStatsMap,
  OfflineQueueStatus
} from './types';

export { log, logError } from './logging';
export { createUserMessage, classifyAndEnhanceError } from './errorHandling';
export { dbManager } from './indexedDbManager';
export { checkCircuitBreaker, recordFailure, recordSuccess } from './circuitBreaker';
export {
  subscribeToOnlineChanges,
  getIsOnline,
  getIsSyncing,
  syncPendingUploads
} from './networkStatus';
export {
  extractGenerator,
  getFolderForGenerator,
  buildAIDescription,
  buildAITags,
  mapToAISongMetadata,
  addJitter,
  delay
} from './helpers';
export { validateBeforeUpload } from './validation';
export { compareTracks, compareSteps } from './versionDiff';

import { dbManager } from './indexedDbManager';
import { log, logError } from './logging';
import {
  checkDuplicate,
  deleteAISong,
  getAISong,
  getAISongs,
  getGeneratorStats,
  getSongsByFolder,
  getSongsByGenerator,
  moveSong,
  searchAISongs,
  searchByGenerator
} from './queryOperations';
import {
  clearPendingUploads,
  getOfflineQueueStatus,
  getPendingUploads,
  subscribeToOnlineChanges,
  syncPendingUploadsManual
} from './queueOperations';
import { uploadAISong, uploadWithRetry } from './uploadOperations';
import { validateBeforeUpload } from './validation';
import { compareVersions, getVersionHistory, revertToVersion } from './versionOperations';

/**
 * AISongStorage - Bulletproof storage service for AI-generated songs
 *
 * Provides enhanced reliability features:
 * - Exponential backoff with jitter for retries
 * - Circuit breaker pattern for failure recovery
 * - IndexedDB queue for offline support
 * - Auto-folder organization by AI generator
 * - Version history tracking and comparison
 * - Comprehensive error categorization
 *
 * Usage:
 * ```typescript
 * // Upload with bulletproof retry
 * const result = await AISongStorage.uploadWithRetry(aiData, hyphonSong);
 *
 * // Get songs by folder
 * const claudeSongs = await AISongStorage.getSongsByFolder('ai-generated/claude');
 *
 * // Compare versions
 * const diff = await AISongStorage.compareVersions('song-1', 'song-2');
 *
 * // Get generator stats
 * const stats = await AISongStorage.getGeneratorStats();
 * ```
 */
export const AISongStorage = {
  // Initialize IndexedDB
  async init(): Promise<void> {
    await dbManager.init();
    log('AISongStorage initialized');
  },

  /**
   * Validate song data before upload
   * @param aiData - Original AI song data
   * @param hyphonSong - Converted Hyphon song data
   * @returns null if valid, StorageErrorInfo if validation fails
   */
  validateBeforeUpload,

  /**
   * Upload an AI-generated song with bulletproof retry logic
   *
   * Features:
   * - 4 attempts with exponential backoff (0s, 1s, 2s, 4s + jitter)
   * - Circuit breaker after 3 failures (30s cooldown)
   * - Offline queueing when network unavailable
   * - IndexedDB persistence for failed uploads
   *
   * @param aiData - Original AI song data with metadata
   * @param hyphonSong - Converted Hyphon song data
   * @param options - Upload options
   * @returns StorageResult with upload success data
   */
  uploadWithRetry,

  /**
   * Legacy upload method (backward compatible)
   * @deprecated Use uploadWithRetry for better reliability
   */
  uploadAISong,

  /**
   * Get all AI-generated songs
   * @param folder - Optional subfolder filter
   * @returns StorageResult with array of AISongMetadata
   */
  getAISongs,

  /**
   * Get songs organized by folder
   * @param folder - Folder path (e.g., 'ai-generated/claude')
   * @returns StorageResult with songs in that folder
   */
  getSongsByFolder,

  /**
   * Move a song from one folder to another
   * @param songId - The song ID to move
   * @param fromFolder - Current folder
   * @param toFolder - Target folder
   * @returns StorageResult with updated metadata
   */
  moveSong,

  /**
   * Get version history for a song
   * @param songId - The song ID
   * @returns StorageResult with array of AISongVersion
   */
  getVersionHistory,

  /**
   * Compare two song versions
   * @param id1 - First version ID
   * @param id2 - Second version ID
   * @returns StorageResult with VersionDiff showing all changes
   */
  compareVersions,

  /**
   * Revert to a specific version
   * @param songId - Current song ID
   * @param versionId - Version to revert to
   * @returns StorageResult with new version data
   */
  revertToVersion,

  /**
   * Search AI songs by query with enhanced filtering
   * @param query - Search query string
   * @param filters - Additional filters
   * @returns StorageResult with matching AISongMetadata
   */
  searchAISongs,

  /**
   * Search songs by AI generator
   * @param generator - The AI generator (claude, gemini, etc.)
   * @returns StorageResult with matching songs
   */
  searchByGenerator,

  /**
   * Get songs by specific AI generator
   * @param generator - The AI generator name
   * @param folder - Optional folder filter
   * @returns StorageResult with matching AISongMetadata
   */
  getSongsByGenerator,

  /**
   * Get statistics for all AI generators
   * @returns StorageResult with GeneratorStatsMap
   */
  getGeneratorStats,

  /**
   * Get a specific AI song with full data
   * @param songId - The song ID to fetch
   * @returns StorageResult with full song data
   */
  getAISong,

  /**
   * Delete an AI song from cloud storage
   * @param songId - The song ID to delete
   * @returns StorageResult with success status
   */
  deleteAISong,

  /**
   * Check if a song with the same title already exists
   * @param title - Song title to check
   * @param author - Optional author filter
   * @returns StorageResult with duplicate info
   */
  checkDuplicate,

  /**
   * Get pending upload count for UI display
   * @returns StorageResult with pending count
   */
  getPendingUploads,

  /**
   * Get offline queue status
   * @returns OfflineQueueStatus
   */
  getOfflineQueueStatus,

  /**
   * Subscribe to online/offline status changes
   * @param callback - Function to call when status changes
   * @returns Unsubscribe function
   */
  subscribeToOnlineChanges,

  /**
   * Manually trigger sync of pending uploads
   * @returns StorageResult with sync results
   */
  syncPendingUploads: syncPendingUploadsManual,

  /**
   * Clear all pending uploads (use with caution)
   * @returns StorageResult with count cleared
   */
  clearPendingUploads
};

// Initialize on module load
dbManager.init().catch(err => logError('Failed to initialize IndexedDB:', err));

// Export singleton instance
export default AISongStorage;
