// src/services/CloudStorage.ts
// VPS Storage Manager API Integration
// Base URL: https://storage.noahcohn.com:8000

import type { SavedSongData } from '../types';

// =============================================================================
// API CONFIGURATION
// =============================================================================

export const API_BASE_URL = "https://storage.noahcohn.com:8000";
export const DEFAULT_TIMEOUT_MS = 15000;
export const MAX_RETRIES = 3;
export const INITIAL_RETRY_DELAY_MS = 1000;

// =============================================================================
// TYPES
// =============================================================================

export type CloudItemType = 'song' | 'pattern' | 'bank' | 'sample' | 'ai-generated';

/** API Response types for type safety */
export interface ApiSongResponse {
  id: string;
  name: string;
  author: string;
  date: string;
  type: CloudItemType;
  description?: string;
  filename?: string;
  size?: number;
  url?: string;
  version?: number;
  tags?: string[];
  folder?: string;
}

export interface ApiUploadResponse {
  id: string;
  url: string;
  timestamp: string;
  size: number;
  folder?: string;
}

export interface ApiErrorResponse {
  error: string;
  code?: number;
  field?: string;
}

/** Cloud metadata for songs */
export interface CloudSongMeta {
  id: string;
  name: string;
  author: string;
  date: string;
  type: CloudItemType;
  description?: string;
  filename?: string;
  size?: number;
  url?: string;
  version?: number;
  tags?: string[];
  folder?: string;
}

/** Payload for uploading songs */
export interface CloudSongPayload {
  name: string;
  author: string;
  description: string;
  type: CloudItemType;
  data: unknown;
  folder?: string;
  tags?: string[];
}

/** Storage error categories for better error handling */
export type StorageError =
  | { category: 'NETWORK'; message: string; retryable: boolean }
  | { category: 'TIMEOUT'; message: string; retryable: true }
  | { category: 'SERVER'; message: string; code: number; retryable: boolean }
  | { category: 'VALIDATION'; message: string; field: string; retryable: false }
  | { category: 'NOT_FOUND'; message: string; id: string; retryable: false };

/** Standard result type for all storage operations */
export interface StorageResult<T> {
  success: boolean;
  data?: T;
  error?: StorageError;
}

/** Upload success metadata */
export interface UploadSuccess {
  id: string;
  url: string;
  timestamp: string;
  size: number;
  folder: string;
  publicUrl: string;
}

/** Request interceptor for debugging/middleware */
export type RequestInterceptor = (
  url: string,
  options: RequestInit
) => { url: string; options: RequestInit } | Promise<{ url: string; options: RequestInit }>;

/** Response interceptor for debugging/middleware */
export type ResponseInterceptor = (
  response: Response,
  url: string
) => Response | Promise<Response>;

// =============================================================================
// ERROR CLASSIFICATION
// =============================================================================

/**
 * Classify an error into a StorageError category
 */
function classifyError(error: unknown, url?: string, statusCode?: number): StorageError {
  // Network errors (no response)
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return {
      category: 'NETWORK',
      message: `Network error connecting to ${url || 'API'}: ${error.message}`,
      retryable: true
    };
  }

  // AbortError = timeout
  if (error instanceof Error && error.name === 'AbortError') {
    return {
      category: 'TIMEOUT',
      message: `Request timed out after ${DEFAULT_TIMEOUT_MS}ms`,
      retryable: true
    };
  }

  // HTTP status errors
  if (statusCode !== undefined) {
    if (statusCode >= 500) {
      return {
        category: 'SERVER',
        message: `Server error (${statusCode}): ${error instanceof Error ? error.message : 'Unknown server error'}`,
        code: statusCode,
        retryable: true
      };
    }
    if (statusCode === 404) {
      return {
        category: 'NOT_FOUND',
        message: `Resource not found at ${url || 'unknown'}`,
        id: url?.split('/').pop() || 'unknown',
        retryable: false
      };
    }
    if (statusCode === 422 || statusCode === 400) {
      return {
        category: 'VALIDATION',
        message: `Validation error (${statusCode}): ${error instanceof Error ? error.message : 'Invalid request'}`,
        field: 'unknown',
        retryable: false
      };
    }
    return {
      category: 'SERVER',
      message: `HTTP error (${statusCode}): ${error instanceof Error ? error.message : 'Unknown error'}`,
      code: statusCode,
      retryable: false
    };
  }

  // Default to network error
  return {
    category: 'NETWORK',
    message: error instanceof Error ? error.message : 'Unknown error',
    retryable: true
  };
}

// =============================================================================
// RETRY LOGIC
// =============================================================================

/**
 * Delay function for exponential backoff
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate retry delay with exponential backoff and jitter
 */
function getRetryDelay(attempt: number): number {
  const exponentialDelay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
  const jitter = Math.random() * 0.3 * exponentialDelay; // 30% jitter
  return Math.min(exponentialDelay + jitter, 30000); // Max 30s
}

/**
 * Execute a fetch with retry logic
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retryCount: number = 0
): Promise<Response> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    
    clearTimeout(timeout);
    return response;
  } catch (error) {
    const storageError = classifyError(error, url);
    
    // Retry if error is retryable and we haven't exceeded max retries
    if (storageError.retryable && retryCount < MAX_RETRIES) {
      const retryDelay = getRetryDelay(retryCount);
      console.log(`[CloudStorage] Retrying request (${retryCount + 1}/${MAX_RETRIES}) after ${retryDelay}ms...`);
      await delay(retryDelay);
      return fetchWithRetry(url, options, retryCount + 1);
    }
    
    throw error;
  }
}

// =============================================================================
// INTERCEPTORS
// =============================================================================

const requestInterceptors: RequestInterceptor[] = [];
const responseInterceptors: ResponseInterceptor[] = [];

/**
 * Add a request interceptor for debugging or middleware
 */
export function addRequestInterceptor(interceptor: RequestInterceptor): () => void {
  requestInterceptors.push(interceptor);
  return () => {
    const idx = requestInterceptors.indexOf(interceptor);
    if (idx > -1) requestInterceptors.splice(idx, 1);
  };
}

/**
 * Add a response interceptor for debugging or middleware
 */
export function addResponseInterceptor(interceptor: ResponseInterceptor): () => void {
  responseInterceptors.push(interceptor);
  return () => {
    const idx = responseInterceptors.indexOf(interceptor);
    if (idx > -1) responseInterceptors.splice(idx, 1);
  };
}

/**
 * Apply all request interceptors
 */
async function applyRequestInterceptors(
  url: string,
  options: RequestInit
): Promise<{ url: string; options: RequestInit }> {
  let result = { url, options };
  for (const interceptor of requestInterceptors) {
    result = await interceptor(result.url, result.options);
  }
  return result;
}

/**
 * Apply all response interceptors
 */
async function applyResponseInterceptors(response: Response, url: string): Promise<Response> {
  let result = response;
  for (const interceptor of responseInterceptors) {
    result = await interceptor(result, url);
  }
  return result;
}

// Default logging interceptor (can be disabled by not registering it)
export const loggingInterceptor: RequestInterceptor = (url, options) => {
  console.log(`[CloudStorage] ${options.method || 'GET'} ${url}`);
  return { url, options };
};

// =============================================================================
// STATUS MANAGER
// =============================================================================

type StatusListener = (status: 'idle' | 'uploading' | 'complete' | 'error') => void;
const listeners: StatusListener[] = [];

export const CloudStatusManager = {
  subscribe(listener: StatusListener): () => void {
    listeners.push(listener);
    return () => {
      const idx = listeners.indexOf(listener);
      if (idx > -1) listeners.splice(idx, 1);
    };
  },
  notify(status: 'idle' | 'uploading' | 'complete' | 'error'): void {
    listeners.forEach(l => l(status));
  }
};

// =============================================================================
// CORE API METHODS
// =============================================================================

export const CloudStorage = {
  /**
   * Get all songs from the cloud storage
   * @param typeFilter - Optional filter by item type
   * @param folder - Optional folder filter
   * @returns StorageResult with array of CloudSongMeta
   */
  async getSongs(
    typeFilter?: CloudItemType,
    folder?: string
  ): Promise<StorageResult<CloudSongMeta[]>> {
    try {
      const params = new URLSearchParams();
      if (typeFilter) params.append('type', typeFilter);
      if (folder) params.append('folder', folder);
      
      const url = `${API_BASE_URL}/api/songs${params.toString() ? '?' + params.toString() : ''}`;
      
      // Apply request interceptors
      const { url: finalUrl, options } = await applyRequestInterceptors(url, {});
      
      const res = await fetchWithRetry(finalUrl, options);
      const resWithInterceptors = await applyResponseInterceptors(res, finalUrl);
      
      if (!resWithInterceptors.ok) {
        const error = classifyError(
          new Error(`HTTP ${resWithInterceptors.status}`),
          finalUrl,
          resWithInterceptors.status
        );
        return { success: false, error };
      }
      
      const data: ApiSongResponse[] = await resWithInterceptors.json();
      
      // Map API response to CloudSongMeta
      const mapped: CloudSongMeta[] = data.map(item => ({
        id: item.id,
        name: item.name,
        author: item.author,
        date: item.date,
        type: item.type,
        description: item.description,
        filename: item.filename,
        size: item.size,
        url: item.url,
        version: item.version,
        tags: item.tags,
        folder: item.folder
      }));
      
      return { success: true, data: mapped };
    } catch (e) {
      console.error("[CloudStorage] Fetch error:", e);
      return { success: false, error: classifyError(e) };
    }
  },

  /**
   * Get a specific song's data
   * @param id - Song ID
   * @param type - Optional type for faster lookup
   * @returns StorageResult with song data
   */
  async getSongData(
    id: string,
    type?: CloudItemType
  ): Promise<StorageResult<unknown>> {
    try {
      let url = `${API_BASE_URL}/api/songs/${encodeURIComponent(id)}`;
      if (type) url += `?type=${encodeURIComponent(type)}`;

      const { url: finalUrl, options } = await applyRequestInterceptors(url, {});
      const res = await fetchWithRetry(finalUrl, options);
      const resWithInterceptors = await applyResponseInterceptors(res, finalUrl);

      if (!resWithInterceptors.ok) {
        return {
          success: false,
          error: classifyError(new Error(`HTTP ${resWithInterceptors.status}`), finalUrl, resWithInterceptors.status)
        };
      }

      const data = await resWithInterceptors.json();
      return { success: true, data };
    } catch (e) {
      console.error("[CloudStorage] Get song error:", e);
      return { success: false, error: classifyError(e) };
    }
  },

  /**
   * Upload a new item to cloud storage
   * @param payload - Song data to upload
   * @returns StorageResult with UploadSuccess metadata
   */
  async uploadItem(payload: CloudSongPayload): Promise<StorageResult<UploadSuccess>> {
    CloudStatusManager.notify('uploading');

    try {
      const { url, options } = await applyRequestInterceptors(
        `${API_BASE_URL}/api/songs`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }
      );

      const res = await fetchWithRetry(url, options);
      const resWithInterceptors = await applyResponseInterceptors(res, url);

      if (!resWithInterceptors.ok) {
        const errorText = await resWithInterceptors.text().catch(() => 'Unknown error');
        CloudStatusManager.notify('error');
        setTimeout(() => CloudStatusManager.notify('idle'), 3000);
        
        return {
          success: false,
          error: classifyError(
            new Error(errorText),
            url,
            resWithInterceptors.status
          )
        };
      }

      const data: ApiUploadResponse = await resWithInterceptors.json();
      
      const result: UploadSuccess = {
        id: data.id,
        url: data.url,
        timestamp: data.timestamp,
        size: data.size,
        folder: data.folder || payload.folder || 'default',
        publicUrl: `${API_BASE_URL}/api/songs/${encodeURIComponent(data.id)}`
      };

      CloudStatusManager.notify('complete');
      setTimeout(() => CloudStatusManager.notify('idle'), 2000);
      
      return { success: true, data: result };
    } catch (e) {
      CloudStatusManager.notify('error');
      setTimeout(() => CloudStatusManager.notify('idle'), 3000);
      
      console.error("[CloudStorage] Upload error:", e);
      return { success: false, error: classifyError(e) };
    }
  },

  /**
   * Delete an item from cloud storage
   * @param id - Song ID to delete
   * @returns StorageResult with success status
   */
  async deleteItem(id: string): Promise<StorageResult<void>> {
    try {
      const { url, options } = await applyRequestInterceptors(
        `${API_BASE_URL}/api/songs/${encodeURIComponent(id)}`,
        { method: 'DELETE' }
      );

      const res = await fetchWithRetry(url, options);
      const resWithInterceptors = await applyResponseInterceptors(res, url);

      if (!resWithInterceptors.ok) {
        return {
          success: false,
          error: classifyError(
            new Error(`Delete failed: HTTP ${resWithInterceptors.status}`),
            url,
            resWithInterceptors.status
          )
        };
      }

      return { success: true };
    } catch (e) {
      console.error("[CloudStorage] Delete error:", e);
      return { success: false, error: classifyError(e) };
    }
  },

  /**
   * Update an existing item (for versioning)
   * @param id - Song ID to update
   * @param payload - Partial update payload
   * @returns StorageResult with updated metadata
   */
  async updateItem(
    id: string,
    payload: Partial<CloudSongPayload>
  ): Promise<StorageResult<UploadSuccess>> {
    CloudStatusManager.notify('uploading');

    try {
      const { url, options } = await applyRequestInterceptors(
        `${API_BASE_URL}/api/songs/${encodeURIComponent(id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }
      );

      const res = await fetchWithRetry(url, options);
      const resWithInterceptors = await applyResponseInterceptors(res, url);

      if (!resWithInterceptors.ok) {
        const errorText = await resWithInterceptors.text().catch(() => 'Unknown error');
        CloudStatusManager.notify('error');
        setTimeout(() => CloudStatusManager.notify('idle'), 3000);
        
        return {
          success: false,
          error: classifyError(
            new Error(errorText),
            url,
            resWithInterceptors.status
          )
        };
      }

      const data: ApiUploadResponse = await resWithInterceptors.json();
      
      const result: UploadSuccess = {
        id: data.id,
        url: data.url,
        timestamp: data.timestamp,
        size: data.size,
        folder: data.folder || payload.folder || 'default',
        publicUrl: `${API_BASE_URL}/api/songs/${encodeURIComponent(data.id)}`
      };

      CloudStatusManager.notify('complete');
      setTimeout(() => CloudStatusManager.notify('idle'), 2000);
      
      return { success: true, data: result };
    } catch (e) {
      CloudStatusManager.notify('error');
      setTimeout(() => CloudStatusManager.notify('idle'), 3000);
      
      console.error("[CloudStorage] Update error:", e);
      return { success: false, error: classifyError(e) };
    }
  },

  /**
   * Search songs by query string
   * @param query - Search query (title, author, or tags)
   * @returns StorageResult with matching songs
   */
  async searchSongs(query: string): Promise<StorageResult<CloudSongMeta[]>> {
    try {
      const url = `${API_BASE_URL}/api/songs?search=${encodeURIComponent(query)}`;
      
      const { url: finalUrl, options } = await applyRequestInterceptors(url, {});
      const res = await fetchWithRetry(finalUrl, options);
      const resWithInterceptors = await applyResponseInterceptors(res, finalUrl);

      if (!resWithInterceptors.ok) {
        return {
          success: false,
          error: classifyError(
            new Error(`Search failed: HTTP ${resWithInterceptors.status}`),
            finalUrl,
            resWithInterceptors.status
          )
        };
      }

      const data: ApiSongResponse[] = await resWithInterceptors.json();
      
      const mapped: CloudSongMeta[] = data.map(item => ({
        id: item.id,
        name: item.name,
        author: item.author,
        date: item.date,
        type: item.type,
        description: item.description,
        filename: item.filename,
        size: item.size,
        url: item.url,
        version: item.version,
        tags: item.tags,
        folder: item.folder
      }));
      
      return { success: true, data: mapped };
    } catch (e) {
      console.error("[CloudStorage] Search error:", e);
      return { success: false, error: classifyError(e) };
    }
  }
};

export default CloudStorage;
