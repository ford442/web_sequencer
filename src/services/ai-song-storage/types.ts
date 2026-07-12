import type { SavedSongData, Pattern, Note } from '../../types';
import type { AISongData } from '../../importers/ai-song/types';
import type { CloudSongMeta } from '../CloudStorage';

/** AI Song metadata with version history */
export interface AISongVersion {
  id: string;
  version: number;
  timestamp: string;
  author: string;
  prompt: string;
  generator: string;
  changeDescription?: string;
}

/** Extended metadata for AI songs */
export interface AISongMetadata extends CloudSongMeta {
  generator: string;
  prompt: string;
  version: number;
  versions?: AISongVersion[];
  aiTags: string[];
  folder?: string;
  lastError?: StorageErrorInfo;
}

/** Search filters for AI songs */
export interface AISongSearchFilters {
  generator?: string;
  author?: string;
  tags?: string[];
  dateFrom?: string;
  dateTo?: string;
  folder?: string;
}

/** Upload options for AI songs */
export interface AISongUploadOptions {
  folder?: string;
  tags?: string[];
  isVersion?: boolean;
  previousVersionId?: string;
  skipValidation?: boolean;
}

/** Error categories for better handling */
export type ErrorCategory = 'NETWORK' | 'TIMEOUT' | 'VALIDATION' | 'SERVER' | 'NOT_FOUND' | 'OFFLINE';

/** Enhanced storage error with user-friendly messages */
export interface StorageErrorInfo {
  category: ErrorCategory;
  message: string;
  userMessage: string;
  retryable: boolean;
  timestamp: string;
  code?: number;
  field?: string;
  id?: string;
}

/** Pending upload queue item */
export interface PendingUpload {
  id: string;
  payload: CloudSongPayload;
  attempts: number;
  lastAttempt: string;
  error?: StorageErrorInfo;
}

/** Circuit breaker state */
export interface CircuitBreakerState {
  failures: number;
  lastFailureTime: number | null;
  isOpen: boolean;
}

/** Track reference for version comparison */
export interface TrackRef {
  id: string;
  name: string;
  sequence: Pattern[keyof Pattern];
}

/** Version comparison result */
export interface VersionDiff {
  addedTracks: TrackRef[];
  removedTracks: TrackRef[];
  modifiedTracks: TrackModification[];
  parameterChanges: ParameterChange[];
  addedNotes: NoteChange[];
  removedNotes: NoteChange[];
}

/** Track modification details */
export interface TrackModification {
  trackId: string;
  trackName: string;
  changes: {
    field: string;
    oldValue: unknown;
    newValue: unknown;
  }[];
}

/** Parameter change details */
export interface ParameterChange {
  trackId: string;
  trackName: string;
  parameter: string;
  oldValue: number;
  newValue: number;
}

/** Note change details */
export interface NoteChange {
  trackId: string;
  trackName: string;
  note: Note;
  stepIndex: number;
}

/** Generator statistics */
export interface GeneratorStats {
  count: number;
  avgTempo: number;
  totalDuration: number;
  lastGenerated: string;
  folderDistribution: Record<string, number>;
}

/** Generator stats map */
export type GeneratorStatsMap = Record<string, GeneratorStats>;

/** Payload for uploading songs (internal type) */
export interface CloudSongPayload {
  name: string;
  author: string;
  description: string;
  type: 'ai-generated';
  data: {
    hyphon: SavedSongData;
    ai: AISongData;
  };
  folder: string;
  tags: string[];
}

/** Offline queue status */
export interface OfflineQueueStatus {
  pendingCount: number;
  isOnline: boolean;
  lastSyncAttempt: string | null;
  isSyncing: boolean;
}
