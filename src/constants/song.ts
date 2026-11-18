/** Song-wide constants: grid size, slot counts, the save format's version. No imports. */

export const NUM_STEPS = 32;
export const DEFAULT_TEMPO = 120;

/** Legacy pattern-mode bank size (pre–v2 saved songs). */
export const LEGACY_TRACK_PATTERN_SLOTS = 8;
/** ReBirth-compatible pattern banks per track (DEVL supports 32). */
export const MAX_TRACK_PATTERN_SLOTS = 32;
/**
 * SavedSongData schema: 1 = 8 slots, 2 = 32 slots, 3 = 32 slots + session, 4 = song meter,
 * 5 = arrangement, 6 = audio clips + audio tracks + media table (#1629).
 */
export const SAVED_SONG_DATA_VERSION = 6;

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

/** Audio tracks a song can have (v6, #1629). Each is an `audioTrackVoice` socket in the patch. */
export const MAX_AUDIO_TRACKS = 8;

/** Audio track keys in lane order (`AudioTrackKey`). */
export const AUDIO_TRACK_KEYS = [
  'audio-1',
  'audio-2',
  'audio-3',
  'audio-4',
  'audio-5',
  'audio-6',
  'audio-7',
  'audio-8',
] as const;

/** A media id (#1629): the SHA-256 of the stored media file, lower-case hex. */
export const MEDIA_ID_PATTERN = /^[0-9a-f]{64}$/;
