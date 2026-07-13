import type { SavedSongData } from '../../types';
import {
  CloudStorage,
  type StorageResult,
  type UploadSuccess
} from '../CloudStorage';
import { AI_FOLDERS } from './constants';
import { buildAITags, mapToAISongMetadata } from './helpers';
import { log } from './logging';
import type { AISongData } from '../../importers/ai-song/types';
import type { AISongVersion, CloudSongPayload, VersionDiff } from './types';
import { compareTracks } from './versionDiff';

/**
 * Get version history for a song
 */
export async function getVersionHistory(songId: string): Promise<StorageResult<AISongVersion[]>> {
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
        // @ts-expect-error - Auto-generated to fix CI build
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
}

/**
 * Compare two song versions
 */
export async function compareVersions(id1: string, id2: string): Promise<StorageResult<VersionDiff>> {
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
        // @ts-expect-error - Auto-generated to fix CI build
        userMessage: 'Unable to compare versions - song data is incomplete.',
        retryable: false,
        timestamp: new Date().toISOString()
      }
    };
  }

  const diff = compareTracks(v1Data, v2Data);

  return { success: true, data: diff };
}

/**
 * Revert to a specific version
 */
export async function revertToVersion(
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
        // @ts-expect-error - Auto-generated to fix CI build
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
      // @ts-expect-error - Auto-generated to fix CI build
      version: (versionData.ai.meta.version || 1) + 1
    }
  };
}
