// src/services/AISongStorage.ts
// Backward-compatible re-exports from modular ai-song-storage package

export {
  AISongStorage,
  AI_SONGS_FOLDER,
  AI_GENERATORS,
  AI_FOLDERS,
  RETRY_CONFIG,
  DB_CONFIG,
  log,
  logError,
  createUserMessage,
  classifyAndEnhanceError,
  dbManager,
  checkCircuitBreaker,
  recordFailure,
  recordSuccess,
  subscribeToOnlineChanges,
  getIsOnline,
  getIsSyncing,
  syncPendingUploads,
  extractGenerator,
  getFolderForGenerator,
  buildAIDescription,
  buildAITags,
  mapToAISongMetadata,
  addJitter,
  delay,
  validateBeforeUpload,
  compareTracks,
  compareSteps
} from './ai-song-storage';

export type {
  AIGenerator,
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
} from './ai-song-storage';

export { default } from './ai-song-storage';
