import { describe, expect, it } from 'vitest';
import {
  createEmptyTrackStorage,
  migrateTrackStorage,
  deriveActiveTrackSlotsFromStructure,
  LEGACY_TRACK_PATTERN_SLOTS,
  MAX_TRACK_PATTERN_SLOTS,
  SAVED_SONG_DATA_VERSION,
} from '../utils/trackStorageUtils';

describe('trackStorageUtils', () => {
  it('creates 32 empty slots per track by default', () => {
    const storage = createEmptyTrackStorage();
    expect(storage.partA.length).toBe(MAX_TRACK_PATTERN_SLOTS);
    expect(storage.partA.every((s) => s === null)).toBe(true);
  });

  it('migrates legacy 8-slot storage to 32 slots preserving data', () => {
    const legacy = createEmptyTrackStorage(LEGACY_TRACK_PATTERN_SLOTS);
    legacy.partA[3] = { steps: Array(32).fill(null) };
    legacy.kick[7] = { steps: Array(32).fill({ note: 'C2', velocity: 1 }) };

    const migrated = migrateTrackStorage(legacy);
    expect(migrated.partA.length).toBe(32);
    expect(migrated.partA[3]).toEqual(legacy.partA[3]);
    expect(migrated.partA[8]).toBeNull();
    expect(migrated.kick[7]).toEqual(legacy.kick[7]);
    expect(migrated.kick[31]).toBeNull();
  });

  it('derives active slots from song structure measure 0', () => {
    const slots = deriveActiveTrackSlotsFromStructure([
      { partA: 5, partB: 12, kick: 0, snare: null },
    ]);
    expect(slots.partA).toBe(5);
    expect(slots.partB).toBe(12);
    expect(slots.kick).toBe(0);
    expect(slots.snare).toBe(0);
  });

  it('exports schema version 3 for songs with session launcher', () => {
    expect(SAVED_SONG_DATA_VERSION).toBe(3);
    expect(MAX_TRACK_PATTERN_SLOTS).toBe(32);
  });
});
