// src/services/AISongStorage.ts
// Bulletproof AI Song Storage with enhanced reliability
// Integrates with HF Storage Manager API for AI song persistence

import type { SavedSongData, Pattern, Note } from '../types';
import type { AISongData } from '../importers/ai-song/types';
import {
  CloudStorage,
  type StorageResult,
  type UploadSuccess,
  type CloudSongMeta,
  API_BASE_URL
} from './CloudStorage';

// =============================================================================
// TYPES
// =============================================================================

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
interface CircuitBreakerState {
  failures: number;
  lastFailureTime: number | null;
  isOpen: boolean;
}

/** Track reference for version comparison */
interface TrackRef {
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
interface TrackModification {
  trackId: string;
  trackName: string;
  changes: {
    field: string;
    oldValue: unknown;
    newValue: unknown;
  }[];
}

/** Parameter change details */
interface ParameterChange {
  trackId: string;
  trackName: string;
  parameter: string;
  oldValue: number;
  newValue: number;
}

/** Note change details */
interface NoteChange {
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
interface CloudSongPayload {
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

// =============================================================================
// CONSTANTS
// =============================================================================

/** Default folder for AI-generated songs */
export const AI_SONGS_FOLDER = 'ai-generated';

/** Known AI generator identifiers */
export const AI_GENERATORS = [
  'claude',
  'claude-3-opus',
  'claude-3-sonnet',
  'gemini',
  'gemini-pro',
  'jules',
  'copilot',
  'gpt-4',
  'gpt-3.5',
  'unknown'
] as const;

export type AIGenerator = typeof AI_GENERATORS[number];

/** Auto-folder structure */
export const AI_FOLDERS = {
  ROOT: 'ai-generated',
  CLAUDE: 'ai-generated/claude',
  GEMINI: 'ai-generated/gemini',
  JULES: 'ai-generated/jules',
  COPILOT: 'ai-generated/copilot',
  OTHER: 'ai-generated/other'
} as const;

/** Retry configuration */
const RETRY_CONFIG = {
  MAX_ATTEMPTS: 4,
  DELAYS: [0, 1000, 2000, 4000], // Immediate, 1s, 2s, 4s
  JITTER_PERCENT: 0.3,
  CIRCUIT_BREAKER_THRESHOLD: 3,
  CIRCUIT_BREAKER_RESET_MS: 30000
};

/** IndexedDB configuration */
const DB_CONFIG = {
  NAME: 'AISongStorage',
  VERSION: 1,
  STORES: {
    PENDING_UPLOADS: 'pendingUploads',
    SONG_ERRORS: 'songErrors',
    VERSION_HISTORY: 'versionHistory'
  }
};

// =============================================================================
// LOGGING
// =============================================================================

const DEBUG = true;

function log(message: string, ...args: unknown[]): void {
  if (DEBUG) {
    console.log(`[AISongStorage] ${message}`, ...args);
  }
}

function logError(message: string, error: unknown): void {
  console.error(`[AISongStorage] ${message}`, error);
}

// =============================================================================
// ERROR HANDLING
// =============================================================================

/**
 * Create a user-friendly error message based on error category
 */
function createUserMessage(category: ErrorCategory, message: string): string {
  const messages: Record<ErrorCategory, string> = {
    NETWORK: 'Connection failed. Please check your internet connection and try again.',
    TIMEOUT: 'The request took too long. Please try again.',
    VALIDATION: `Validation error: ${message}`,
    SERVER: 'Server error. Our team has been notified. Please try again later.',
    NOT_FOUND: 'The requested song could not be found.',
    OFFLINE: 'You appear to be offline. Your song has been queued for upload when you reconnect.'
  };
  return messages[category] || message;
}

/**
 * Classify and enhance an error with user-friendly messaging
 */
function classifyAndEnhanceError(
  error: unknown,
  category?: ErrorCategory
): StorageErrorInfo {
  const now = new Date().toISOString();
  
  if (error && typeof error === 'object' && 'category' in error) {
    const existing = error as StorageErrorInfo;
    return {
      ...existing,
      userMessage: existing.userMessage || createUserMessage(existing.category, existing.message),
      timestamp: existing.timestamp || now
    };
  }

  const err = error instanceof Error ? error : new Error(String(error));
  const cat: ErrorCategory = category || 
    (err.message.includes('fetch') ? 'NETWORK' :
     err.message.includes('timeout') ? 'TIMEOUT' :
     err.message.includes('validation') ? 'VALIDATION' :
     err.message.includes('offline') ? 'OFFLINE' : 'SERVER');

  return {
    category: cat,
    message: err.message,
    userMessage: createUserMessage(cat, err.message),
    retryable: ['NETWORK', 'TIMEOUT', 'SERVER', 'OFFLINE'].includes(cat),
    timestamp: now
  };
}

// =============================================================================
// INDEXEDDB MANAGEMENT
// =============================================================================

class IndexedDBManager {
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_CONFIG.NAME, DB_CONFIG.VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        if (!db.objectStoreNames.contains(DB_CONFIG.STORES.PENDING_UPLOADS)) {
          const store = db.createObjectStore(DB_CONFIG.STORES.PENDING_UPLOADS, { keyPath: 'id' });
          store.createIndex('attempts', 'attempts', { unique: false });
          store.createIndex('lastAttempt', 'lastAttempt', { unique: false });
        }
        
        if (!db.objectStoreNames.contains(DB_CONFIG.STORES.SONG_ERRORS)) {
          db.createObjectStore(DB_CONFIG.STORES.SONG_ERRORS, { keyPath: 'id' });
        }
        
        if (!db.objectStoreNames.contains(DB_CONFIG.STORES.VERSION_HISTORY)) {
          const store = db.createObjectStore(DB_CONFIG.STORES.VERSION_HISTORY, { keyPath: 'id' });
          store.createIndex('songId', 'songId', { unique: false });
        }
      };
    });
  }

  async addPendingUpload(payload: CloudSongPayload): Promise<void> {
    await this.ensureDB();
    const pending: PendingUpload = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      payload,
      attempts: 0,
      lastAttempt: new Date().toISOString()
    };

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([DB_CONFIG.STORES.PENDING_UPLOADS], 'readwrite');
      const store = tx.objectStore(DB_CONFIG.STORES.PENDING_UPLOADS);
      const request = store.put(pending);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getPendingUploads(): Promise<PendingUpload[]> {
    await this.ensureDB();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([DB_CONFIG.STORES.PENDING_UPLOADS], 'readonly');
      const store = tx.objectStore(DB_CONFIG.STORES.PENDING_UPLOADS);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async removePendingUpload(id: string): Promise<void> {
    await this.ensureDB();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([DB_CONFIG.STORES.PENDING_UPLOADS], 'readwrite');
      const store = tx.objectStore(DB_CONFIG.STORES.PENDING_UPLOADS);
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async updatePendingUpload(pending: PendingUpload): Promise<void> {
    await this.ensureDB();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([DB_CONFIG.STORES.PENDING_UPLOADS], 'readwrite');
      const store = tx.objectStore(DB_CONFIG.STORES.PENDING_UPLOADS);
      const request = store.put(pending);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async storeSongError(songId: string, error: StorageErrorInfo): Promise<void> {
    await this.ensureDB();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([DB_CONFIG.STORES.SONG_ERRORS], 'readwrite');
      const store = tx.objectStore(DB_CONFIG.STORES.SONG_ERRORS);
      const request = store.put({ id: songId, error, timestamp: new Date().toISOString() });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getSongError(songId: string): Promise<StorageErrorInfo | null> {
    await this.ensureDB();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([DB_CONFIG.STORES.SONG_ERRORS], 'readonly');
      const store = tx.objectStore(DB_CONFIG.STORES.SONG_ERRORS);
      const request = store.get(songId);
      request.onsuccess = () => {
        const result = request.result;
        resolve(result ? result.error : null);
      };
      request.onerror = () => reject(request.error);
    });
  }

  private async ensureDB(): Promise<void> {
    if (!this.db) {
      await this.init();
    }
  }
}

const dbManager = new IndexedDBManager();

// =============================================================================
// CIRCUIT BREAKER
// =============================================================================

const circuitBreaker: CircuitBreakerState = {
  failures: 0,
  lastFailureTime: null,
  isOpen: false
};

function checkCircuitBreaker(): boolean {
  if (!circuitBreaker.isOpen) return true;
  
  const now = Date.now();
  const timeSinceLastFailure = now - (circuitBreaker.lastFailureTime || 0);
  
  if (timeSinceLastFailure >= RETRY_CONFIG.CIRCUIT_BREAKER_RESET_MS) {
    log('Circuit breaker reset');
    circuitBreaker.isOpen = false;
    circuitBreaker.failures = 0;
    return true;
  }
  
  return false;
}

function recordFailure(): void {
  circuitBreaker.failures++;
  circuitBreaker.lastFailureTime = Date.now();
  
  if (circuitBreaker.failures >= RETRY_CONFIG.CIRCUIT_BREAKER_THRESHOLD) {
    log('Circuit breaker opened - too many failures');
    circuitBreaker.isOpen = true;
  }
}

function recordSuccess(): void {
  if (circuitBreaker.failures > 0) {
    log('Circuit breaker - resetting failure count after success');
    circuitBreaker.failures = 0;
    circuitBreaker.isOpen = false;
  }
}

// =============================================================================
// NETWORK STATUS
// =============================================================================

let isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
const onlineListeners: ((online: boolean) => void)[] = [];

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    isOnline = true;
    onlineListeners.forEach(l => l(true));
    syncPendingUploads();
  });
  
  window.addEventListener('offline', () => {
    isOnline = false;
    onlineListeners.forEach(l => l(false));
  });
}

function subscribeToOnlineChanges(callback: (online: boolean) => void): () => void {
  onlineListeners.push(callback);
  return () => {
    const idx = onlineListeners.indexOf(callback);
    if (idx > -1) onlineListeners.splice(idx, 1);
  };
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Extract generator name from AISongData meta
 */
function extractGenerator(aiData: AISongData): AIGenerator {
  const generator = aiData.meta.generator.toLowerCase();
  
  for (const known of AI_GENERATORS) {
    if (generator.includes(known)) {
      return known;
    }
  }
  
  return 'unknown';
}

/**
 * Get auto-folder for a generator
 */
function getFolderForGenerator(generator: AIGenerator): string {
  switch (generator) {
    case 'claude':
    case 'claude-3-opus':
    case 'claude-3-sonnet':
      return AI_FOLDERS.CLAUDE;
    case 'gemini':
    case 'gemini-pro':
      return AI_FOLDERS.GEMINI;
    case 'jules':
      return AI_FOLDERS.JULES;
    case 'copilot':
      return AI_FOLDERS.COPILOT;
    default:
      return AI_FOLDERS.OTHER;
  }
}

/**
 * Build AI-specific description with prompt info
 */
function buildAIDescription(aiData: AISongData, maxLength: number = 500): string {
  const generator = aiData.meta.generator;
  const prompt = aiData.meta.prompt;
  const tags = aiData.meta.tags?.join(', ') || '';
  
  let description = `[${generator}] ${prompt}`;
  
  if (tags) {
    description += ` | Tags: ${tags}`;
  }
  
  if (description.length > maxLength) {
    description = description.substring(0, maxLength - 3) + '...';
  }
  
  return description;
}

/**
 * Build AI-specific tags
 */
function buildAITags(aiData: AISongData, customTags?: string[]): string[] {
  const generator = extractGenerator(aiData);
  const baseTags = [
    'ai-generated',
    generator,
    ...(aiData.meta.tags || [])
  ];
  
  if (customTags) {
    baseTags.push(...customTags);
  }
  
  return [...new Set(baseTags)].filter(tag => tag.length > 0);
}

/**
 * Map CloudSongMeta to AISongMetadata
 */
function mapToAISongMetadata(meta: CloudSongMeta): AISongMetadata | null {
  if (!meta.description) return null;
  
  const match = meta.description.match(/^\[([^\]]+)\]\s*(.+?)(?:\s*\|\s*Tags:\s*(.+))?$/);
  
  if (!match) return null;
  
  const [, generator, prompt, tagsStr] = match;
  const aiTags = tagsStr ? tagsStr.split(',').map(t => t.trim()) : ['ai-generated'];
  
  return {
    ...meta,
    generator,
    prompt: prompt.trim(),
    version: meta.version || 1,
    aiTags,
    folder: meta.folder || AI_SONGS_FOLDER
  };
}

/**
 * Add jitter to delay to prevent thundering herd
 */
function addJitter(delay: number): number {
  const jitter = delay * RETRY_CONFIG.JITTER_PERCENT * Math.random();
  return delay + jitter;
}

/**
 * Delay function for retry logic
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, addJitter(ms)));
}

// =============================================================================
// VALIDATION
// =============================================================================

/**
 * Validate song data before upload
 * Catches issues early to prevent failed uploads
 */
function validateBeforeUpload(
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

// =============================================================================
// VERSION COMPARISON
// =============================================================================

/**
 * Compare two song versions and return differences
 * Works with Pattern-based track structure
 */
function compareTracks(v1: SavedSongData, v2: SavedSongData): VersionDiff {
  const diff: VersionDiff = {
    addedTracks: [],
    removedTracks: [],
    modifiedTracks: [],
    parameterChanges: [],
    addedNotes: [],
    removedNotes: []
  };

  const trackKeys = ['partA', 'partB', 'bass2', 'kick', 'snare', 'closedHat', 'openHat', 'sampler'] as const;
  const v1Pattern = v1.pattern;
  const v2Pattern = v2.pattern;

  // Compare each track in the pattern
  for (const key of trackKeys) {
    const v1Track = v1Pattern[key];
    const v2Track = v2Pattern[key];

    // Handle sampler (array) vs other tracks (single sequence)
    if (key === 'sampler') {
      const v1Banks = v1Track as Pattern['sampler'];
      const v2Banks = v2Track as Pattern['sampler'];
      
      for (let i = 0; i < 8; i++) {
        const v1Bank = v1Banks[i];
        const v2Bank = v2Banks[i];
        const trackName = `sampler-${i}`;
        
        // Compare steps
        compareSteps(v1Bank?.steps || [], v2Bank?.steps || [], `sampler-${i}`, trackName, diff);
      }
    } else {
      const v1Seq = v1Track as Pattern['partA'];
      const v2Seq = v2Track as Pattern['partA'];
      
      // Compare steps for changes
      compareSteps(v1Seq.steps, v2Seq.steps, key, key, diff);
      
      // Check for parameter changes in params
      const v1Params = v1.params[key as keyof SavedSongData['params']];
      const v2Params = v2.params[key as keyof SavedSongData['params']];
      
      if (v1Params && v2Params && typeof v1Params === 'object' && typeof v2Params === 'object') {
        const changes: TrackModification['changes'] = [];
        
        for (const [param, val1] of Object.entries(v1Params)) {
          const val2 = (v2Params as Record<string, unknown>)[param];
          if (val1 !== val2) {
            changes.push({ field: param, oldValue: val1, newValue: val2 });
            
            if (param === 'volume' && typeof val1 === 'number' && typeof val2 === 'number') {
              diff.parameterChanges.push({
                trackId: key,
                trackName: key,
                parameter: param,
                oldValue: val1,
                newValue: val2
              });
            }
          }
        }
        
        if (changes.length > 0) {
          diff.modifiedTracks.push({ trackId: key, trackName: key, changes });
        }
      }
    }
  }

  return diff;
}

/**
 * Compare steps between two sequences
 */
function compareSteps(
  v1Steps: (Note | null)[],
  v2Steps: (Note | null)[],
  trackId: string,
  trackName: string,
  diff: VersionDiff
): void {
  const maxSteps = Math.max(v1Steps.length, v2Steps.length);
  
  for (let i = 0; i < maxSteps; i++) {
    const v1Note = v1Steps[i];
    const v2Note = v2Steps[i];
    
    // Note added
    if (!v1Note && v2Note) {
      diff.addedNotes.push({ trackId, trackName, note: v2Note, stepIndex: i });
    }
    // Note removed
    else if (v1Note && !v2Note) {
      diff.removedNotes.push({ trackId, trackName, note: v1Note, stepIndex: i });
    }
    // Note changed
    else if (v1Note && v2Note) {
      const noteChanged = 
        v1Note.note !== v2Note.note ||
        v1Note.velocity !== v2Note.velocity ||
        v1Note.length !== v2Note.length ||
        v1Note.slide !== v2Note.slide;
      
      if (noteChanged) {
        diff.removedNotes.push({ trackId, trackName, note: v1Note, stepIndex: i });
        diff.addedNotes.push({ trackId, trackName, note: v2Note, stepIndex: i });
      }
    }
  }
}

// =============================================================================
// OFFLINE SYNC
// =============================================================================

let isSyncing = false;

async function syncPendingUploads(): Promise<void> {
  if (isSyncing || !isOnline) return;
  
  isSyncing = true;
  log('Starting sync of pending uploads');

  try {
    const pending = await dbManager.getPendingUploads();
    log(`Found ${pending.length} pending uploads`);

    for (const upload of pending) {
      try {
        const result = await CloudStorage.uploadItem(upload.payload);
        
        if (result.success) {
          await dbManager.removePendingUpload(upload.id);
          log(`Synced pending upload: ${upload.id}`);
        } else {
          upload.attempts++;
          upload.lastAttempt = new Date().toISOString();
          upload.error = result.error ? classifyAndEnhanceError(result.error) : undefined;
          await dbManager.updatePendingUpload(upload);
        }
      } catch (e) {
        upload.attempts++;
        upload.lastAttempt = new Date().toISOString();
        upload.error = classifyAndEnhanceError(e);
        await dbManager.updatePendingUpload(upload);
      }
    }
  } finally {
    isSyncing = false;
  }
}

// =============================================================================
// MAIN SERVICE
// =============================================================================

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
  async uploadWithRetry(
    aiData: AISongData,
    hyphonSong: SavedSongData,
    options: AISongUploadOptions = {}
  ): Promise<StorageResult<UploadSuccess & { version: number; generator: string; queued?: boolean }>> {
    log('Starting bulletproof upload:', aiData.meta.title);

    // Validate before attempting upload
    if (!options.skipValidation) {
      const validationError = validateBeforeUpload(aiData, hyphonSong);
      if (validationError) {
        return { success: false, error: validationError };
      }
    }

    // Check if offline
    if (!isOnline) {
      log('Offline - queueing upload');
      const generator = extractGenerator(aiData);
      const folder = options.folder || getFolderForGenerator(generator);
      const payload: CloudSongPayload = {
        name: aiData.meta.title,
        author: aiData.meta.author,
        description: buildAIDescription(aiData),
        type: 'ai-generated',
        data: { hyphon: hyphonSong, ai: aiData },
        folder,
        tags: buildAITags(aiData, options.tags)
      };
      
      await dbManager.addPendingUpload(payload);
      
      return {
        success: true,
        data: {
          id: 'pending',
          url: '',
          timestamp: new Date().toISOString(),
          size: 0,
          folder,
          publicUrl: '',
          version: 1,
          generator,
          queued: true
        }
      };
    }

    // Check circuit breaker
    if (!checkCircuitBreaker()) {
      const error: StorageErrorInfo = {
        category: 'NETWORK',
        message: 'Circuit breaker is open - too many recent failures',
        userMessage: 'Too many recent upload failures. Please wait 30 seconds before trying again.',
        retryable: true,
        timestamp: new Date().toISOString()
      };
      return { success: false, error };
    }

    const generator = extractGenerator(aiData);
    const folder = options.folder || getFolderForGenerator(generator);
    const payload: CloudSongPayload = {
      name: aiData.meta.title,
      author: aiData.meta.author,
      description: buildAIDescription(aiData),
      type: 'ai-generated',
      data: { hyphon: hyphonSong, ai: aiData },
      folder,
      tags: buildAITags(aiData, options.tags)
    };

    // Retry loop
    for (let attempt = 0; attempt < RETRY_CONFIG.MAX_ATTEMPTS; attempt++) {
      try {
        if (attempt > 0) {
          const delayMs = RETRY_CONFIG.DELAYS[attempt];
          log(`Retry attempt ${attempt + 1}/${RETRY_CONFIG.MAX_ATTEMPTS} after ${delayMs}ms`);
          await delay(delayMs);
        }

        const result = await CloudStorage.uploadItem(payload);

        if (result.success && result.data) {
          recordSuccess();
          log('Upload successful after', attempt + 1, 'attempt(s)');
          return {
            success: true,
            data: {
              ...result.data,
              version: 1,
              generator
            }
          };
        }

        // Upload failed but returned gracefully
        if (result.error) {
          const enhanced = classifyAndEnhanceError(result.error);
          
          // Store error for this song
          await dbManager.storeSongError(aiData.meta.title, enhanced);
          
          if (!enhanced.retryable || attempt === RETRY_CONFIG.MAX_ATTEMPTS - 1) {
            recordFailure();
            return { success: false, error: enhanced };
          }
          
          log(`Attempt ${attempt + 1} failed, will retry:`, enhanced.message);
        }
      } catch (e) {
        const enhanced = classifyAndEnhanceError(e);
        await dbManager.storeSongError(aiData.meta.title, enhanced);
        
        if (!enhanced.retryable || attempt === RETRY_CONFIG.MAX_ATTEMPTS - 1) {
          recordFailure();
          return { success: false, error: enhanced };
        }
        
        log(`Attempt ${attempt + 1} error, will retry:`, enhanced.message);
      }
    }

    // All attempts exhausted - queue for later
    log('All retry attempts exhausted, queueing for later');
    await dbManager.addPendingUpload(payload);
    recordFailure();

    return {
      success: false,
      error: {
        category: 'NETWORK',
        message: 'All retry attempts failed',
        userMessage: 'Upload failed after multiple attempts. Your song has been saved for retry.',
        retryable: true,
        timestamp: new Date().toISOString()
      }
    };
  },

  /**
   * Legacy upload method (backward compatible)
   * @deprecated Use uploadWithRetry for better reliability
   */
  async uploadAISong(
    aiData: AISongData,
    hyphonSong: SavedSongData,
    options: AISongUploadOptions = {}
  ): Promise<StorageResult<UploadSuccess & { version: number; generator: string }>> {
    return this.uploadWithRetry(aiData, hyphonSong, options);
  },

  /**
   * Get all AI-generated songs
   * @param folder - Optional subfolder filter
   * @returns StorageResult with array of AISongMetadata
   */
  async getAISongs(folder?: string): Promise<StorageResult<AISongMetadata[]>> {
    log('Fetching AI songs from folder:', folder || AI_SONGS_FOLDER);
    
    const result = await CloudStorage.getSongs('ai-generated', folder || AI_SONGS_FOLDER);
    
    if (!result.success || !result.data) {
      return { success: false, error: result.error };
    }
    
    const aiSongs: AISongMetadata[] = result.data
      .map(mapToAISongMetadata)
      .filter((meta): meta is AISongMetadata => meta !== null);
    
    // Add lastError info if available
    for (const song of aiSongs) {
      const error = await dbManager.getSongError(song.id);
      if (error) {
        song.lastError = error;
      }
    }
    
    log(`Found ${aiSongs.length} AI songs`);
    
    return { success: true, data: aiSongs };
  },

  /**
   * Get songs organized by folder
   * @param folder - Folder path (e.g., 'ai-generated/claude')
   * @returns StorageResult with songs in that folder
   */
  async getSongsByFolder(folder: string): Promise<StorageResult<AISongMetadata[]>> {
    log('Fetching songs from folder:', folder);
    return this.getAISongs(folder);
  },

  /**
   * Move a song from one folder to another
   * @param songId - The song ID to move
   * @param fromFolder - Current folder
   * @param toFolder - Target folder
   * @returns StorageResult with updated metadata
   */
  async moveSong(
    songId: string,
    fromFolder: string,
    toFolder: string
  ): Promise<StorageResult<AISongMetadata>> {
    log('Moving song:', { songId, fromFolder, toFolder });
    
    // Get current song data
    const songResult = await this.getAISong(songId);
    if (!songResult.success || !songResult.data) {
      return { success: false, error: songResult.error };
    }

    // Update via CloudStorage
    const updateResult = await CloudStorage.updateItem(songId, { folder: toFolder });
    
    if (!updateResult.success) {
      return { success: false, error: updateResult.error };
    }

    // Return updated metadata
    const updatedMeta: AISongMetadata = {
      ...songResult.data.metadata,
      folder: toFolder
    };

    return { success: true, data: updatedMeta };
  },

  /**
   * Get version history for a song
   * @param songId - The song ID
   * @returns StorageResult with array of AISongVersion
   */
  async getVersionHistory(songId: string): Promise<StorageResult<AISongVersion[]>> {
    log('Fetching version history for:', songId);
    
    const songResult = await CloudStorage.getSongData(songId, 'ai-generated');
    
    if (!songResult.success || !songResult.data) {
      return { success: false, error: songResult.error };
    }
    
    const songData = songResult.data as { name?: string; ai?: AISongData };
    const songName = songData.name || songData.ai?.meta.title;
    
    if (!songName) {
      return {
        success: false,
        error: {
          category: 'VALIDATION',
          message: 'Could not determine song name for version lookup',
          userMessage: 'Unable to find version history for this song.',
          retryable: false,
          timestamp: new Date().toISOString(),
          field: 'songId'
        }
      };
    }
    
    const searchResult = await CloudStorage.searchSongs(songName);
    
    if (!searchResult.success || !searchResult.data) {
      return { success: false, error: searchResult.error };
    }
    
    const versions: AISongVersion[] = searchResult.data
      .filter(meta => meta.type === 'ai-generated')
      .map(meta => {
        const aiMeta = mapToAISongMetadata(meta);
        return {
          id: meta.id,
          version: meta.version || 1,
          timestamp: meta.date,
          author: meta.author,
          prompt: aiMeta?.prompt || '',
          generator: aiMeta?.generator || 'unknown',
          changeDescription: meta.description
        };
      })
      .sort((a, b) => b.version - a.version);
    
    return { success: true, data: versions };
  },

  /**
   * Compare two song versions
   * @param id1 - First version ID
   * @param id2 - Second version ID
   * @returns StorageResult with VersionDiff showing all changes
   */
  async compareVersions(id1: string, id2: string): Promise<StorageResult<VersionDiff>> {
    log('Comparing versions:', { id1, id2 });
    
    const [v1Result, v2Result] = await Promise.all([
      CloudStorage.getSongData(id1, 'ai-generated'),
      CloudStorage.getSongData(id2, 'ai-generated')
    ]);
    
    if (!v1Result.success || !v1Result.data) {
      return { success: false, error: v1Result.error };
    }
    
    if (!v2Result.success || !v2Result.data) {
      return { success: false, error: v2Result.error };
    }
    
    const v1Data = (v1Result.data as { hyphon?: SavedSongData }).hyphon;
    const v2Data = (v2Result.data as { hyphon?: SavedSongData }).hyphon;
    
    if (!v1Data || !v2Data) {
      return {
        success: false,
        error: {
          category: 'VALIDATION',
          message: 'Missing song data for comparison',
          userMessage: 'Unable to compare versions - song data is incomplete.',
          retryable: false,
          timestamp: new Date().toISOString()
        }
      };
    }
    
    const diff = compareTracks(v1Data, v2Data);
    
    return { success: true, data: diff };
  },

  /**
   * Revert to a specific version
   * @param songId - Current song ID
   * @param versionId - Version to revert to
   * @returns StorageResult with new version data
   */
  async revertToVersion(
    songId: string,
    versionId: string
  ): Promise<StorageResult<UploadSuccess & { version: number }>> {
    log('Reverting to version:', { songId, versionId });
    
    // Get the version to revert to
    const versionResult = await CloudStorage.getSongData(versionId, 'ai-generated');
    
    if (!versionResult.success || !versionResult.data) {
      return { success: false, error: versionResult.error };
    }
    
    const versionData = versionResult.data as { 
      hyphon?: SavedSongData; 
      ai?: AISongData;
      name?: string;
      author?: string;
    };
    
    if (!versionData.hyphon || !versionData.ai) {
      return {
        success: false,
        error: {
          category: 'VALIDATION',
          message: 'Invalid version data',
          userMessage: 'Cannot revert - version data is corrupted.',
          retryable: false,
          timestamp: new Date().toISOString()
        }
      };
    }
    
    // Create new version with reverted data
    const payload: CloudSongPayload = {
      name: `${versionData.name || versionData.ai.meta.title} (Reverted)`,
      author: versionData.author || versionData.ai.meta.author,
      description: `[${versionData.ai.meta.generator}] Reverted to version ${versionId} | ${versionData.ai.meta.prompt}`,
      type: 'ai-generated',
      data: { hyphon: versionData.hyphon, ai: versionData.ai },
      folder: AI_FOLDERS.ROOT,
      tags: buildAITags(versionData.ai, ['reverted'])
    };
    
    const result = await CloudStorage.uploadItem(payload);
    
    if (!result.success || !result.data) {
      return { success: false, error: result.error };
    }
    
    return {
      success: true,
      data: {
        ...result.data,
        version: (versionData.ai.meta.version || 1) + 1
      }
    };
  },

  /**
   * Search AI songs by query with enhanced filtering
   * @param query - Search query string
   * @param filters - Additional filters
   * @returns StorageResult with matching AISongMetadata
   */
  async searchAISongs(
    query: string,
    filters: AISongSearchFilters = {}
  ): Promise<StorageResult<AISongMetadata[]>> {
    log('Searching AI songs:', { query, filters });
    
    const allResult = await this.getAISongs(filters.folder);
    
    if (!allResult.success || !allResult.data) {
      return { success: false, error: allResult.error };
    }
    
    const queryLower = query.toLowerCase();
    
    const filtered = allResult.data.filter(song => {
      const matchesQuery = !query || 
        song.name.toLowerCase().includes(queryLower) ||
        song.author.toLowerCase().includes(queryLower) ||
        song.prompt.toLowerCase().includes(queryLower) ||
        song.aiTags.some(tag => tag.toLowerCase().includes(queryLower));
      
      if (!matchesQuery) return false;
      
      if (filters.generator && !song.generator.toLowerCase().includes(filters.generator.toLowerCase())) {
        return false;
      }
      
      if (filters.author && !song.author.toLowerCase().includes(filters.author.toLowerCase())) {
        return false;
      }
      
      if (filters.tags && filters.tags.length > 0) {
        const hasAllTags = filters.tags.every(tag => 
          song.aiTags.some(songTag => songTag.toLowerCase() === tag.toLowerCase())
        );
        if (!hasAllTags) return false;
      }
      
      if (filters.dateFrom) {
        const songDate = new Date(song.date);
        const fromDate = new Date(filters.dateFrom);
        if (songDate < fromDate) return false;
      }
      
      if (filters.dateTo) {
        const songDate = new Date(song.date);
        const toDate = new Date(filters.dateTo);
        if (songDate > toDate) return false;
      }
      
      return true;
    });
    
    log(`Search found ${filtered.length} matches`);
    
    return { success: true, data: filtered };
  },

  /**
   * Search songs by AI generator
   * @param generator - The AI generator (claude, gemini, etc.)
   * @returns StorageResult with matching songs
   */
  async searchByGenerator(generator: AIGenerator): Promise<StorageResult<AISongMetadata[]>> {
    return this.searchAISongs('', { generator });
  },

  /**
   * Get songs by specific AI generator
   * @param generator - The AI generator name
   * @param folder - Optional folder filter
   * @returns StorageResult with matching AISongMetadata
   */
  async getSongsByGenerator(
    generator: string,
    folder?: string
  ): Promise<StorageResult<AISongMetadata[]>> {
    return this.searchAISongs('', { generator, folder });
  },

  /**
   * Get statistics for all AI generators
   * @returns StorageResult with GeneratorStatsMap
   */
  async getGeneratorStats(): Promise<StorageResult<GeneratorStatsMap>> {
    log('Calculating generator statistics');
    
    const allSongs = await this.getAISongs();
    
    if (!allSongs.success || !allSongs.data) {
      return { success: false, error: allSongs.error };
    }
    
    const stats: GeneratorStatsMap = {};
    
    for (const song of allSongs.data) {
      if (!stats[song.generator]) {
        stats[song.generator] = {
          count: 0,
          avgTempo: 0,
          totalDuration: 0,
          lastGenerated: '',
          folderDistribution: {}
        };
      }
      
      const genStats = stats[song.generator];
      genStats.count++;
      
      // Track folder distribution
      const folder = song.folder || AI_FOLDERS.OTHER;
      genStats.folderDistribution[folder] = (genStats.folderDistribution[folder] || 0) + 1;
      
      // Update last generated
      if (!genStats.lastGenerated || song.date > genStats.lastGenerated) {
        genStats.lastGenerated = song.date;
      }
    }
    
    // Calculate averages (would need song data for tempo, using placeholder)
    for (const generator of Object.keys(stats)) {
      const genStats = stats[generator];
      // Note: For actual tempo, we'd need to fetch full song data
      // This is a simplified version
      genStats.avgTempo = 120; // Placeholder
    }
    
    return { success: true, data: stats };
  },

  /**
   * Get a specific AI song with full data
   * @param songId - The song ID to fetch
   * @returns StorageResult with full song data
   */
  async getAISong(songId: string): Promise<StorageResult<{
    hyphon: SavedSongData;
    ai: AISongData;
    metadata: AISongMetadata;
  }>> {
    log('Fetching AI song:', songId);
    
    const result = await CloudStorage.getSongData(songId, 'ai-generated');
    
    if (!result.success || !result.data) {
      return { success: false, error: result.error };
    }
    
    const data = result.data as {
      hyphon: SavedSongData;
      ai: AISongData;
      name?: string;
      author?: string;
      date?: string;
      description?: string;
      id?: string;
      type?: string;
    };
    
    if (!data.hyphon || !data.ai) {
      return {
        success: false,
        error: {
          category: 'VALIDATION',
          message: 'Song data is missing required hyphon or ai fields',
          userMessage: 'The song data appears to be corrupted or incomplete.',
          retryable: false,
          timestamp: new Date().toISOString(),
          field: 'data'
        }
      };
    }
    
    const baseMeta: CloudSongMeta = {
      id: data.id || songId,
      name: data.name || data.ai.meta.title,
      author: data.author || data.ai.meta.author,
      date: data.date || new Date().toISOString(),
      type: 'ai-generated',
      description: data.description
    };
    
    const metadata = mapToAISongMetadata(baseMeta);
    
    if (!metadata) {
      return {
        success: false,
        error: {
          category: 'VALIDATION',
          message: 'Could not parse AI song metadata',
          userMessage: 'The song metadata appears to be in an unexpected format.',
          retryable: false,
          timestamp: new Date().toISOString(),
          field: 'metadata'
        }
      };
    }
    
    // Add lastError if available
    const error = await dbManager.getSongError(songId);
    if (error) {
      metadata.lastError = error;
    }
    
    return {
      success: true,
      data: {
        hyphon: data.hyphon,
        ai: data.ai,
        metadata
      }
    };
  },

  /**
   * Delete an AI song from cloud storage
   * @param songId - The song ID to delete
   * @returns StorageResult with success status
   */
  async deleteAISong(songId: string): Promise<StorageResult<void>> {
    log('Deleting AI song:', songId);
    
    const result = await CloudStorage.deleteItem(songId);
    
    if (result.success) {
      log('Song deleted successfully');
    } else {
      logError('Delete failed:', result.error);
    }
    
    return result;
  },

  /**
   * Check if a song with the same title already exists
   * @param title - Song title to check
   * @param author - Optional author filter
   * @returns StorageResult with duplicate info
   */
  async checkDuplicate(
    title: string,
    author?: string
  ): Promise<StorageResult<{ exists: boolean; id?: string; song?: AISongMetadata }>> {
    log('Checking for duplicate:', { title, author });
    
    const result = await this.getAISongs();
    
    if (!result.success || !result.data) {
      return { success: false, error: result.error };
    }
    
    const match = result.data.find(song => {
      const titleMatch = song.name.toLowerCase() === title.toLowerCase();
      const authorMatch = !author || song.author.toLowerCase() === author.toLowerCase();
      return titleMatch && authorMatch;
    });
    
    if (match) {
      log('Duplicate found:', match.id);
      return {
        success: true,
        data: { exists: true, id: match.id, song: match }
      };
    }
    
    return { success: true, data: { exists: false } };
  },

  /**
   * Get pending upload count for UI display
   * @returns StorageResult with pending count
   */
  async getPendingUploads(): Promise<StorageResult<PendingUpload[]>> {
    const pending = await dbManager.getPendingUploads();
    return { success: true, data: pending };
  },

  /**
   * Get offline queue status
   * @returns OfflineQueueStatus
   */
  getOfflineQueueStatus(): OfflineQueueStatus {
    return {
      pendingCount: 0, // Will be populated async
      isOnline,
      lastSyncAttempt: null,
      isSyncing
    };
  },

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
  async syncPendingUploads(): Promise<StorageResult<{ synced: number; failed: number }>> {
    if (!isOnline) {
      return {
        success: false,
        error: {
          category: 'OFFLINE',
          message: 'Cannot sync while offline',
          userMessage: 'You are currently offline. Sync will happen automatically when you reconnect.',
          retryable: true,
          timestamp: new Date().toISOString()
        }
      };
    }

    const pending = await dbManager.getPendingUploads();
    let synced = 0;
    let failed = 0;

    for (const upload of pending) {
      try {
        const result = await CloudStorage.uploadItem(upload.payload);
        if (result.success) {
          await dbManager.removePendingUpload(upload.id);
          synced++;
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }

    return { success: true, data: { synced, failed } };
  },

  /**
   * Clear all pending uploads (use with caution)
   * @returns StorageResult with count cleared
   */
  async clearPendingUploads(): Promise<StorageResult<{ cleared: number }>> {
    const pending = await dbManager.getPendingUploads();
    for (const upload of pending) {
      await dbManager.removePendingUpload(upload.id);
    }
    return { success: true, data: { cleared: pending.length } };
  }
};

// Initialize on module load
dbManager.init().catch(err => logError('Failed to initialize IndexedDB:', err));

// Export singleton instance
export default AISongStorage;

// Re-export types for convenience
export type {
  PendingUpload,
  StorageErrorInfo,
  VersionDiff,
  GeneratorStats,
  OfflineQueueStatus
};
