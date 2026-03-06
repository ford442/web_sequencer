/**
 * Version Management for AI Song Import System
 *
 * Tracks version history, generates unique version IDs,
 * and manages the version tree for AI-generated songs.
 */

import type { AISongData } from './AISongImporter';

// ============================================================================
// VERSION TYPES
// ============================================================================

/**
 * Single entry in the version history
 */
export interface VersionEntry {
  /** Unique version identifier */
  id: string;
  /** ISO 8601 timestamp of version creation */
  timestamp: string;
  /** Author who created this version */
  author: string;
  /** Description of changes in this version */
  changes: string;
  /** Parent version ID (for branching/version tree) */
  parentId?: string;
}

/**
 * Preview data for AI song before import
 * Used by the preview pane to display song summary
 */
export interface PreviewData {
  /** Summary of each track with note counts and density */
  trackSummary: Array<{
    name: string;
    noteCount: number;
    density: number; // 0-1 (notes per step / total steps)
  }>;
  /** Estimated song duration in seconds */
  estimatedDuration: number;
  /** Overall complexity score (0-100) */
  complexityScore: number;
  /** 32x8 grid for pattern visualization */
  patternGrid: boolean[][];
  /** Any warnings about the song */
  warnings: string[];
}

/**
 * Version history metadata attached to AI songs
 */
export interface VersionHistory {
  /** Current version ID */
  currentVersionId: string;
  /** List of all versions (newest first) */
  versions: VersionEntry[];
}

// ============================================================================
// VERSION ID GENERATION
// ============================================================================

/**
 * Generate a unique version ID based on timestamp and author hash
 *
 * Format: `v{timestamp}-{authorHash}`
 * Example: `v2024-03-15T143052-abc123`
 *
 * @param author - The author name
 * @returns A unique version ID
 */
export function generateVersionId(author: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '');
  const authorHash = hashString(author).slice(0, 6);
  return `v${timestamp}-${authorHash}`;
}

/**
 * Simple hash function for generating author hashes
 * Creates a deterministic hash from a string
 *
 * @param str - String to hash
 * @returns Hex hash string
 */
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  // Convert to positive hex string
  return Math.abs(hash).toString(16).padStart(8, '0');
}

// ============================================================================
// VERSION HISTORY MANAGEMENT
// ============================================================================

/**
 * Create a new version entry
 *
 * @param author - Author creating the version
 * @param changes - Description of changes
 * @param parentId - Optional parent version ID for branching
 * @returns New version entry
 */
export function createVersionEntry(
  author: string,
  changes: string,
  parentId?: string
): VersionEntry {
  return {
    id: generateVersionId(author),
    timestamp: new Date().toISOString(),
    author,
    changes,
    parentId
  };
}

/**
 * Initialize version history for a new AI song
 *
 * @param aiSong - The AI song data
 * @returns Version history with initial version
 */
export function initializeVersionHistory(aiSong: AISongData): VersionHistory {
  const initialVersion = createVersionEntry(
    aiSong.meta.author,
    'Initial AI-generated version'
  );

  return {
    currentVersionId: initialVersion.id,
    versions: [initialVersion]
  };
}

/**
 * Add a new version to existing history
 *
 * @param history - Current version history
 * @param author - Author making changes
 * @param changes - Description of changes
 * @returns Updated version history
 */
export function addVersion(
  history: VersionHistory,
  author: string,
  changes: string
): VersionHistory {
  const newVersion = createVersionEntry(author, changes, history.currentVersionId);

  return {
    currentVersionId: newVersion.id,
    versions: [newVersion, ...history.versions]
  };
}

/**
 * Get a specific version by ID
 *
 * @param history - Version history
 * @param versionId - Version ID to find
 * @returns Version entry or undefined if not found
 */
export function getVersionById(
  history: VersionHistory,
  versionId: string
): VersionEntry | undefined {
  return history.versions.find(v => v.id === versionId);
}

/**
 * Get the current version entry
 *
 * @param history - Version history
 * @returns Current version entry
 */
export function getCurrentVersion(history: VersionHistory): VersionEntry {
  const current = history.versions.find(v => v.id === history.currentVersionId);
  if (!current) {
    throw new Error(`Current version ${history.currentVersionId} not found in history`);
  }
  return current;
}

// ============================================================================
// PREVIEW DATA GENERATION
// ============================================================================

const NUM_STEPS = 32;
const GRID_ROWS = 8;
const STEPS_PER_ROW = 4; // 32 steps / 8 rows = 4 steps per row

/**
 * Generate preview data for an AI song
 * Provides summary statistics and visualization data
 *
 * @param aiSong - The AI song data
 * @returns Preview data for display
 */
export function generatePreviewData(aiSong: AISongData): PreviewData {
  const warnings: string[] = [];
  const trackSummary: PreviewData['trackSummary'] = [];
  let totalNotes = 0;
  let maxDensity = 0;

  // Calculate track summaries
  const tracks = [
    { key: 'synthA', name: 'Synth A', data: aiSong.tracks.synthA },
    { key: 'synthB', name: 'Synth B', data: aiSong.tracks.synthB },
    { key: 'bass2', name: 'Bass 2', data: aiSong.tracks.bass2 },
  ] as const;

  for (const track of tracks) {
    if (track.data) {
      const noteCount = track.data.notes.length;
      const density = noteCount / NUM_STEPS;
      trackSummary.push({
        name: track.name,
        noteCount,
        density: Math.min(density, 1.0)
      });
      totalNotes += noteCount;
      maxDensity = Math.max(maxDensity, density);
    }
  }

  // Count drum hits
  const drumTracks = [
    { key: 'kick', name: 'Kick', data: aiSong.tracks.kick },
    { key: 'snare', name: 'Snare', data: aiSong.tracks.snare },
    { key: 'closedHat', name: 'Closed Hat', data: aiSong.tracks.closedHat },
    { key: 'openHat', name: 'Open Hat', data: aiSong.tracks.openHat },
  ] as const;

  for (const track of drumTracks) {
    if (track.data) {
      const noteCount = track.data.filter(Boolean).length;
      const density = noteCount / NUM_STEPS;
      trackSummary.push({
        name: track.name,
        noteCount,
        density: Math.min(density, 1.0)
      });
      totalNotes += noteCount;
      maxDensity = Math.max(maxDensity, density);
    }
  }

  // Count sampler notes
  if (aiSong.tracks.sampler) {
    for (const bank of aiSong.tracks.sampler) {
      const noteCount = bank.steps.length;
      const density = noteCount / NUM_STEPS;
      trackSummary.push({
        name: `Sampler ${bank.bankIndex + 1}`,
        noteCount,
        density: Math.min(density, 1.0)
      });
      totalNotes += noteCount;
      maxDensity = Math.max(maxDensity, density);
    }
  }

  // Generate warnings
  if (totalNotes === 0) {
    warnings.push('Song contains no notes');
  }
  if (aiSong.globals.tempo < 60 || aiSong.globals.tempo > 180) {
    warnings.push(`Unusual tempo: ${aiSong.globals.tempo} BPM`);
  }
  if (maxDensity > 0.75) {
    warnings.push('High note density may cause audio issues');
  }

  // Calculate estimated duration
  // 32 steps at 4/4 = 8 beats = 2 bars
  const beatsPerPattern = 8;
  const patternDurationSeconds = (beatsPerPattern / aiSong.globals.tempo) * 60;
  const estimatedDuration = patternDurationSeconds; // Single pattern for now

  // Calculate complexity score (0-100)
  // Factors: note count, density variety, track variety
  const trackVariety = trackSummary.filter(t => t.noteCount > 0).length / trackSummary.length;
  const avgDensity = trackSummary.length > 0
    ? trackSummary.reduce((sum, t) => sum + t.density, 0) / trackSummary.length
    : 0;
  const complexityScore = Math.min(100, Math.round(
    (totalNotes * 2) + (avgDensity * 50) + (trackVariety * 30)
  ));

  // Generate pattern grid (32x8)
  // Grid shows which steps have any notes across all tracks
  const patternGrid: boolean[][] = Array(GRID_ROWS).fill(null).map(() => Array(NUM_STEPS).fill(false));

  // Fill grid based on note presence
  for (const track of tracks) {
    if (track.data) {
      for (const note of track.data.notes) {
        if (note.step >= 0 && note.step < NUM_STEPS) {
          patternGrid[Math.floor(note.step / STEPS_PER_ROW)][note.step] = true;
        }
      }
    }
  }

  // Mark drum hits
  for (const track of drumTracks) {
    if (track.data) {
      const pattern = track.data.length === 16
        ? [...track.data, ...track.data] // Extend 16-step to 32
        : track.data;
      for (let i = 0; i < pattern.length && i < NUM_STEPS; i++) {
        if (pattern[i]) {
          patternGrid[Math.floor(i / STEPS_PER_ROW)][i] = true;
        }
      }
    }
  }

  // Mark sampler notes
  if (aiSong.tracks.sampler) {
    for (const bank of aiSong.tracks.sampler) {
      for (const note of bank.steps) {
        if (note.step >= 0 && note.step < NUM_STEPS) {
          patternGrid[Math.floor(note.step / STEPS_PER_ROW)][note.step] = true;
        }
      }
    }
  }

  return {
    trackSummary,
    estimatedDuration: Math.round(estimatedDuration * 10) / 10, // Round to 1 decimal
    complexityScore,
    patternGrid,
    warnings
  };
}

// ============================================================================
// SERIALIZATION
// ============================================================================

/**
 * Serialize version history for storage
 *
 * @param history - Version history
 * @returns JSON-serializable object
 */
export function serializeVersionHistory(history: VersionHistory): unknown {
  return JSON.parse(JSON.stringify(history));
}

/**
 * Deserialize version history from storage
 *
 * @param data - Stored data
 * @returns Version history or null if invalid
 */
export function deserializeVersionHistory(data: unknown): VersionHistory | null {
  try {
    const parsed = data as VersionHistory;
    if (
      parsed &&
      typeof parsed.currentVersionId === 'string' &&
      Array.isArray(parsed.versions) &&
      parsed.versions.every(
        (v: VersionEntry) =>
          typeof v.id === 'string' &&
          typeof v.timestamp === 'string' &&
          typeof v.author === 'string' &&
          typeof v.changes === 'string'
      )
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}
