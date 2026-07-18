import type { AISongData } from '../../importers/ai-song/types';
import type { CloudSongMeta } from '../CloudStorage';
import { AI_FOLDERS, AI_GENERATORS, AI_SONGS_FOLDER, RETRY_CONFIG } from './constants';
import type { AIGenerator } from './constants';
import type { AISongMetadata } from './types';

/**
 * Extract generator name from AISongData meta
 */
export function extractGenerator(aiData: AISongData): AIGenerator {
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
export function getFolderForGenerator(generator: AIGenerator): string {
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
export function buildAIDescription(aiData: AISongData, maxLength: number = 500): string {
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
export function buildAITags(aiData: AISongData, customTags?: string[]): string[] {
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
export function mapToAISongMetadata(meta: CloudSongMeta): AISongMetadata | null {
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
export function addJitter(delayMs: number): number {
  const jitter = delayMs * RETRY_CONFIG.JITTER_PERCENT * Math.random();
  return delayMs + jitter;
}

/**
 * Delay function for retry logic
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, addJitter(ms)));
}
