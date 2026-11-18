/** Song-wide constants: grid size, slot counts, the save format's version. No imports. */

export const NUM_STEPS = 32;
export const DEFAULT_TEMPO = 120;

/** Legacy pattern-mode bank size (pre–v2 saved songs). */
export const LEGACY_TRACK_PATTERN_SLOTS = 8;
/** ReBirth-compatible pattern banks per track (DEVL supports 32). */
export const MAX_TRACK_PATTERN_SLOTS = 32;
/** SavedSongData schema: 1 = 8 slots, 2 = 32 slots, 3 = 32 slots + session, 4 = song meter, 5 = arrangement. */
export const SAVED_SONG_DATA_VERSION = 5;

export const TRACK_KEYS = [
  'partA',
  'partB',
  'bass2',
  'kick',
  'snare',
  'closedHat',
  'openHat',
  'sampler',
] as const;
