/**
 * AISongData v1.1 song block → Song Mode slots.
 *
 * A v1.1 song names its patterns (`patterns`) and arranges them one row per
 * measure (`song`). Hyphon's Song Mode stores pattern *slots* per track
 * (`trackStorage[track][slot]`) and measures as slot indexes
 * (`songStructure`). This module is the one place that maps the first onto
 * the second, so anything downstream of `songStructure` (the #1342
 * arrangement migration, `.rbs` TRAK export) sees AI songs like any other.
 *
 * Every function here assumes `validateAISongData` passed.
 */

import type { TrackKey } from '../../types';
import type {
  AIPatternData,
  AISongData,
  AISongRow,
  AISongTrackName,
  AISongTracks,
} from './types';

/** Track names a v1.1 `song` row may use. */
export const AI_SONG_TRACK_NAMES: readonly AISongTrackName[] = [
  'synthA', 'synthB', 'bass2', 'kick', 'snare', 'closedHat', 'openHat', 'sampler',
];

/** The pattern id top-level `tracks` stands for in a v1.1 song. */
export const DEFAULT_AI_PATTERN_ID = 'A';

/** Pattern slots per track (`MAX_TRACK_PATTERN_SLOTS`). */
export const MAX_AI_PATTERNS_PER_TRACK = 32;

/** Steps per pattern for a v1.1 song (`globals.stepCount`, default 32). */
export function songStepCount(song: Pick<AISongData, 'globals'>): number {
  return song.globals.stepCount ?? 32;
}

/** The Hyphon track each AI track name plays on. */
export const AI_TRACK_TO_TRACK_KEY: Readonly<Record<AISongTrackName, TrackKey>> = {
  synthA: 'partA',
  synthB: 'partB',
  bass2: 'bass2',
  kick: 'kick',
  snare: 'snare',
  closedHat: 'closedHat',
  openHat: 'openHat',
  sampler: 'sampler',
};

/** A v1.1 song resolved to slot indexes. */
export interface ResolvedAISongBlock {
  stepCount: number;
  patterns: Readonly<Record<string, AIPatternData>>;
  /** Per track, the pattern id in each slot (index = slot, first-seen order). */
  slots: Record<AISongTrackName, string[]>;
  /** One entry per measure: the slot each track plays, `null` = silent. */
  measures: Record<AISongTrackName, number | null>[];
  /** Pattern ids defined but never played. */
  unusedPatterns: string[];
}

/** True when the song is read through the song block (v1.1). */
export function hasSongBlock(song: AISongData): boolean {
  return song.meta.version === '1.1';
}

/** `patterns`, or top-level `tracks` as pattern `"A"`. */
function songPatterns(song: AISongData): Record<string, AIPatternData> {
  if (song.patterns) return song.patterns;
  return { [DEFAULT_AI_PATTERN_ID]: { tracks: song.tracks ?? {} } };
}

/** `song`, or one measure of pattern `"A"` on every track. */
function songRows(song: AISongData): AISongRow[] {
  if (song.song) return song.song;
  const row: AISongRow = {};
  for (const track of AI_SONG_TRACK_NAMES) row[track] = DEFAULT_AI_PATTERN_ID;
  return [row];
}

/**
 * Assign each track's patterns to slots in the order the song first plays
 * them, and turn every row into slot indexes.
 */
export function resolveSongBlock(song: AISongData): ResolvedAISongBlock {
  const patterns = songPatterns(song);
  const slots = Object.fromEntries(
    AI_SONG_TRACK_NAMES.map((track) => [track, [] as string[]]),
  ) as Record<AISongTrackName, string[]>;
  const played = new Set<string>();

  const measures = songRows(song).map((row) => {
    const measure = {} as Record<AISongTrackName, number | null>;
    for (const track of AI_SONG_TRACK_NAMES) {
      const id = row[track];
      if (id === undefined || id === null) {
        measure[track] = null;
        continue;
      }
      played.add(id);
      let slot = slots[track].indexOf(id);
      if (slot === -1) slot = slots[track].push(id) - 1;
      measure[track] = slot;
    }
    return measure;
  });

  return {
    stepCount: songStepCount(song),
    patterns,
    slots,
    measures,
    unusedPatterns: Object.keys(patterns).filter((id) => !played.has(id)),
  };
}

/**
 * The tracks of the pattern a single-pattern view should show: top-level
 * `tracks`, else the pattern the song opens with. Previews and summaries
 * that predate v1.1 read this instead of `song.tracks`.
 */
export function primaryAITracks(song: AISongData): AISongTracks {
  if (song.tracks) return song.tracks;
  const patterns = song.patterns ?? {};
  for (const row of song.song ?? []) {
    for (const track of AI_SONG_TRACK_NAMES) {
      const id = row[track];
      if (typeof id === 'string' && patterns[id]) return patterns[id].tracks;
    }
  }
  const first = Object.values(patterns)[0];
  return first?.tracks ?? {};
}
