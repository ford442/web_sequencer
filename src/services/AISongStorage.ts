// src/services/AISongStorage.ts
// Specialized storage service for AI-generated songs
// Integrates with HF Storage Manager API for AI song persistence

import type { SavedSongData } from '../types';
import type { AISongData } from '../importers/ai-song';
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
}

/** Search filters for AI songs */
export interface AISongSearchFilters {
  generator?: string;
  author?: string;
  tags?: string[];
  dateFrom?: string;
  dateTo?: string;
}

/** Upload options for AI songs */
export interface AISongUploadOptions {
  folder?: string;
  tags?: string[];
  isVersion?: boolean;
  previousVersionId?: string;
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
 * Build AI-specific description with prompt info
 */
function buildAIDescription(aiData: AISongData, maxLength: number = 500): string {
  const generator = aiData.meta.generator;
  const prompt = aiData.meta.prompt;
  const tags = aiData.meta.tags?.join(', ') || '';
  
  // Format: [generator] Prompt text... | Tags: tag1, tag2
  let description = `[${generator}] ${prompt}`;
  
  if (tags) {
    description += ` | Tags: ${tags}`;
  }
  
  // Truncate if too long
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
  
  // Remove duplicates and empty strings
  return [...new Set(baseTags)].filter(tag => tag.length > 0);
}

/**
 * Map CloudSongMeta to AISongMetadata
 */
function mapToAISongMetadata(meta: CloudSongMeta): AISongMetadata | null {
  if (!meta.description) return null;
  
  // Parse description format: [generator] Prompt text... | Tags: tag1, tag2
  const match = meta.description.match(/^\[([^\]]+)\]\s*(.+?)(?:\s*\|\s*Tags:\s*(.+))?$/);
  
  if (!match) return null;
  
  const [, generator, prompt, tagsStr] = match;
  const aiTags = tagsStr ? tagsStr.split(',').map(t => t.trim()) : ['ai-generated'];
  
  return {
    ...meta,
    generator,
    prompt: prompt.trim(),
    version: meta.version || 1,
    aiTags
  };
}

// =============================================================================
// MAIN SERVICE
// =============================================================================

/**
 * AISongStorage - Specialized storage service for AI-generated songs
 * 
 * Provides AI-specific features:
 * - Auto-tagging with generator names
 * - Prompt storage in descriptions
 * - Version history tracking
 * - AI song search/filtering
 * - Folder organization for AI songs
 * 
 * Usage:
 * ```typescript
 * const result = await AISongStorage.uploadAISong(aiData, hyphonSong);
 * if (result.success) {
 *   console.log('Uploaded to:', result.data.publicUrl);
 * }
 * 
 * // Get all AI songs
 * const songs = await AISongStorage.getAISongs();
 * 
 * // Search by prompt content
 * const results = await AISongStorage.searchAISongs('funky bass');
 * ```
 */
export const AISongStorage = {
  /**
   * Upload an AI-generated song to cloud storage
   * 
   * @param aiData - Original AI song data with metadata
   * @param hyphonSong - Converted Hyphon song data
   * @param options - Upload options (folder, tags, versioning)
   * @returns StorageResult with UploadSuccess metadata
   * 
   * @example
   * ```typescript
   * const result = await AISongStorage.uploadAISong(
   *   aiSongData,
   *   hyphonSongData,
   *   { folder: 'my-ai-songs', tags: ['funky', 'bass'] }
   * );
   * ```
   */
  async uploadAISong(
    aiData: AISongData,
    hyphonSong: SavedSongData,
    options: AISongUploadOptions = {}
  ): Promise<StorageResult<UploadSuccess & { version: number; generator: string }>> {
    log('Uploading AI song:', aiData.meta.title);
    
    const generator = extractGenerator(aiData);
    const folder = options.folder || AI_SONGS_FOLDER;
    const tags = buildAITags(aiData, options.tags);
    
    // Build enriched description with prompt
    const description = buildAIDescription(aiData);
    
    // Prepare payload with AI-specific metadata
    const payload = {
      name: aiData.meta.title,
      author: aiData.meta.author,
      description,
      type: 'ai-generated' as const,
      data: {
        hyphon: hyphonSong,
        ai: aiData
      },
      folder,
      tags
    };
    
    log('Payload:', { name: payload.name, folder, tags });
    
    // Upload via base CloudStorage
    const result = await CloudStorage.uploadItem(payload);
    
    if (!result.success || !result.data) {
      logError('Upload failed:', result.error);
      return { success: false, error: result.error };
    }
    
    log('Upload successful:', result.data.id);
    
    return {
      success: true,
      data: {
        ...result.data,
        version: 1,
        generator
      }
    };
  },

  /**
   * Get all AI-generated songs
   * 
   * @param folder - Optional subfolder filter
   * @returns StorageResult with array of AISongMetadata
   * 
   * @example
   * ```typescript
   * const result = await AISongStorage.getAISongs('my-folder');
   * if (result.success) {
   *   result.data.forEach(song => {
   *     console.log(`${song.name} by ${song.generator}`);
   *   });
   * }
   * ```
   */
  async getAISongs(folder?: string): Promise<StorageResult<AISongMetadata[]>> {
    log('Fetching AI songs from folder:', folder || AI_SONGS_FOLDER);
    
    const result = await CloudStorage.getSongs('ai-generated', folder || AI_SONGS_FOLDER);
    
    if (!result.success || !result.data) {
      return { success: false, error: result.error };
    }
    
    // Map to AISongMetadata, filtering out non-parseable entries
    const aiSongs: AISongMetadata[] = result.data
      .map(mapToAISongMetadata)
      .filter((meta): meta is AISongMetadata => meta !== null);
    
    log(`Found ${aiSongs.length} AI songs`);
    
    return { success: true, data: aiSongs };
  },

  /**
   * Get version history for an AI song
   * 
   * Note: This queries the API for all songs with similar names
   * and filters by the original song's characteristics.
   * 
   * @param songId - The song ID to get versions for
   * @returns StorageResult with array of AISongVersion
   * 
   * @example
   * ```typescript
   * const versions = await AISongStorage.getAISongVersions('song-123');
   * if (versions.success) {
   *   versions.data.forEach(v => {
   *     console.log(`Version ${v.version}: ${v.timestamp}`);
   *   });
   * }
   * ```
   */
  async getAISongVersions(songId: string): Promise<StorageResult<AISongVersion[]>> {
    log('Fetching versions for song:', songId);
    
    // First, get the song to find its name
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
          field: 'songId',
          retryable: false
        }
      };
    }
    
    // Search for songs with similar names (versions typically share base name)
    const searchResult = await CloudStorage.searchSongs(songName);
    
    if (!searchResult.success || !searchResult.data) {
      return { success: false, error: searchResult.error };
    }
    
    // Filter to AI-generated songs and map to versions
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
      .sort((a, b) => b.version - a.version); // Newest first
    
    log(`Found ${versions.length} versions`);
    
    return { success: true, data: versions };
  },

  /**
   * Delete an AI song from cloud storage
   * 
   * @param songId - The song ID to delete
   * @returns StorageResult with success status
   * 
   * @example
   * ```typescript
   * const result = await AISongStorage.deleteAISong('song-123');
   * if (result.success) {
   *   console.log('Song deleted');
   * }
   * ```
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
   * Search AI songs by query (title, author, prompt content, or tags)
   * 
   * @param query - Search query string
   * @param filters - Additional filters (generator, date range, etc.)
   * @returns StorageResult with matching AISongMetadata
   * 
   * @example
   * ```typescript
   * // Simple search
   * const results = await AISongStorage.searchAISongs('funky bass');
   * 
   * // Search with filters
   * const claudeSongs = await AISongStorage.searchAISongs('melodic', {
   *   generator: 'claude',
   *   dateFrom: '2024-01-01'
   * });
   * ```
   */
  async searchAISongs(
    query: string,
    filters: AISongSearchFilters = {}
  ): Promise<StorageResult<AISongMetadata[]>> {
    log('Searching AI songs:', { query, filters });
    
    // First get all AI songs, then filter locally for more complex queries
    const allResult = await this.getAISongs();
    
    if (!allResult.success || !allResult.data) {
      return { success: false, error: allResult.error };
    }
    
    const queryLower = query.toLowerCase();
    
    // Apply filters
    const filtered = allResult.data.filter(song => {
      // Text search in name, author, prompt, or tags
      const matchesQuery = 
        song.name.toLowerCase().includes(queryLower) ||
        song.author.toLowerCase().includes(queryLower) ||
        song.prompt.toLowerCase().includes(queryLower) ||
        song.aiTags.some(tag => tag.toLowerCase().includes(queryLower));
      
      if (!matchesQuery) return false;
      
      // Apply generator filter
      if (filters.generator && !song.generator.toLowerCase().includes(filters.generator.toLowerCase())) {
        return false;
      }
      
      // Apply author filter
      if (filters.author && !song.author.toLowerCase().includes(filters.author.toLowerCase())) {
        return false;
      }
      
      // Apply tags filter
      if (filters.tags && filters.tags.length > 0) {
        const hasAllTags = filters.tags.every(tag => 
          song.aiTags.some(songTag => songTag.toLowerCase() === tag.toLowerCase())
        );
        if (!hasAllTags) return false;
      }
      
      // Apply date range filters
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
   * Get a specific AI song with full data (both Hyphon and AI formats)
   * 
   * @param songId - The song ID to fetch
   * @returns StorageResult with full song data
   * 
   * @example
   * ```typescript
   * const result = await AISongStorage.getAISong('song-123');
   * if (result.success) {
   *   const { hyphon, ai, metadata } = result.data;
   *   console.log(`Loaded ${metadata.name} by ${metadata.generator}`);
   * }
   * ```
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
    
    // Validate that we have both formats
    if (!data.hyphon || !data.ai) {
      return {
        success: false,
        error: {
          category: 'VALIDATION',
          message: 'Song data is missing required hyphon or ai fields',
          field: 'data',
          retryable: false
        }
      };
    }
    
    // Build metadata
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
          field: 'metadata',
          retryable: false
        }
      };
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
   * Get songs by specific AI generator
   * 
   * @param generator - The AI generator name (claude, gemini, etc.)
   * @param folder - Optional folder filter
   * @returns StorageResult with matching AISongMetadata
   * 
   * @example
   * ```typescript
   * const claudeSongs = await AISongStorage.getSongsByGenerator('claude');
   * ```
   */
  async getSongsByGenerator(
    generator: string,
    folder?: string
  ): Promise<StorageResult<AISongMetadata[]>> {
    return this.searchAISongs('', { generator, ...(folder && { folder: undefined }) });
  },

  /**
   * Check if a song with the same title already exists
   * Useful for preventing duplicates or prompting for overwrite
   * 
   * @param title - Song title to check
   * @param author - Optional author filter
   * @returns StorageResult with existing song ID if found
   * 
   * @example
   * ```typescript
   * const existing = await AISongStorage.checkDuplicate('My Song', 'John');
   * if (existing.success && existing.data.exists) {
   *   console.log('Song exists:', existing.data.id);
   * }
   * ```
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
  }
};

// Export singleton instance
export default AISongStorage;
