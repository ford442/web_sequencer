/**
 * Track pattern slot storage (8 → 32 slot migration, ReBirth RBS import).
 */

import type { PartSequence } from '../types';
import type { TrackKey } from '../constants/appDefaults';
import {
  LEGACY_TRACK_PATTERN_SLOTS,
  MAX_TRACK_PATTERN_SLOTS,
  SAVED_SONG_DATA_VERSION,
  TRACK_KEYS,
} from '../constants';

export { MAX_TRACK_PATTERN_SLOTS, LEGACY_TRACK_PATTERN_SLOTS, SAVED_SONG_DATA_VERSION };

/** Highest valid zero-based pattern slot index (31 when max slots is 32). */
export const MAX_TRACK_PATTERN_SLOT_INDEX = MAX_TRACK_PATTERN_SLOTS - 1;

/** Slot indices 0 … MAX_TRACK_PATTERN_SLOTS - 1 */
export const TRACK_PATTERN_SLOT_INDICES = Array.from(
  { length: MAX_TRACK_PATTERN_SLOTS },
  (_, i) => i,
);

export type TrackStorageMap = Record<TrackKey, (PartSequence | PartSequence[] | null)[]>;

/** Create empty track storage with `slotCount` null slots per track. */
export function createEmptyTrackStorage(slotCount = MAX_TRACK_PATTERN_SLOTS): TrackStorageMap {
  const storage = {} as TrackStorageMap;
  for (const key of TRACK_KEYS) {
    storage[key] = Array(slotCount).fill(null);
  }
  return storage;
}

/** Pad or trim each track's slot array to `targetSlots` (preserves existing data). */
export function migrateTrackStorage(
  storage: Partial<TrackStorageMap> | Record<string, unknown>,
  targetSlots = MAX_TRACK_PATTERN_SLOTS,
): TrackStorageMap {
  const result = createEmptyTrackStorage(targetSlots);
  for (const key of TRACK_KEYS) {
    const row = (storage as TrackStorageMap)[key];
    if (!Array.isArray(row)) continue;
    for (let i = 0; i < Math.min(row.length, targetSlots); i++) {
      result[key][i] = row[i] ?? null;
    }
  }
  return result;
}

/** Default active slots (all zero). */
export function defaultActiveTrackSlots(): Record<TrackKey, number> {
  return {
    partA: 0,
    partB: 0,
    bass2: 0,
    kick: 0,
    snare: 0,
    closedHat: 0,
    openHat: 0,
    sampler: 0,
  };
}

/**
 * Derive active pattern slots from song structure measure 0 (or first non-null per track).
 */
export function deriveActiveTrackSlotsFromStructure(
  songStructure: Array<Partial<Record<TrackKey, number | null>>>,
): Record<TrackKey, number> {
  const slots = defaultActiveTrackSlots();
  if (!songStructure.length) return slots;

  const first = songStructure[0];
  for (const key of TRACK_KEYS) {
    const v = first[key];
    if (v !== null && v !== undefined && v >= 0 && v < MAX_TRACK_PATTERN_SLOTS) {
      slots[key] = v;
    }
  }
  return slots;
}

/** Highest referenced pattern index per track in song structure (+1 for slot count hint). */
export function maxReferencedPatternSlots(
  songStructure: Array<Partial<Record<TrackKey, number | null>>>,
): number {
  let max = 1;
  for (const measure of songStructure) {
    for (const key of TRACK_KEYS) {
      const v = measure[key];
      if (v !== null && v !== undefined && v >= 0) {
        max = Math.max(max, v + 1);
      }
    }
  }
  return Math.min(max, MAX_TRACK_PATTERN_SLOTS);
}
