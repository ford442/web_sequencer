/**
 * The `.hyphonpack.json` session-pack format: constants, limits and types.
 *
 * A pack is a portable Session Launcher starter: pack metadata, a
 * `SessionDocument` (scenes + clips), the pattern slots those clips point at
 * (`trackStorage`) and optional SYNTH A / B settings. It is data only — no
 * code, no URLs, no audio. See docs/session-pack-format.md.
 *
 * Runtime-light on purpose: this module is imported by the pack schema, the
 * generator script and the built-in pack factories, so it carries no logic.
 */

import { MAX_TRACK_PATTERN_SLOTS } from '@/constants';
import type { SynthParams } from '@/types';
import type { TrackStorageMap } from '@/utils/trackStorageUtils';
import type { SessionDocument } from '../types';

/** Magic string every pack file starts with (`"format"`). */
export const SESSION_PACK_FORMAT = 'hyphon-session-pack';

/**
 * The version this build writes and the schema describes. Older versions are
 * upgraded to it by `migrateSessionPack` before validation; newer ones are
 * refused (`unsupported-version`).
 */
export const SESSION_PACK_FORMAT_VERSION = 1;

export const SESSION_PACK_FILE_EXTENSION = '.hyphonpack.json';

/** Pack ids are slugs: lowercase words joined by single hyphens. Also the export file's stem. */
export const PACK_ID_SOURCE = '^[a-z0-9]+(-[a-z0-9]+)*$';

/** Hard caps. Each is enforced by the schema or by the validator, never by truncation. */
export const PACK_LIMITS = {
  /** File size in bytes (UTF-8). Checked before parsing. */
  maxBytes: 4 * 1024 * 1024,
  /** Pattern slots per track (the app's `MAX_TRACK_PATTERN_SLOTS`). */
  maxSlotsPerTrack: MAX_TRACK_PATTERN_SLOTS,
  /** Rows (scenes / clips per column). */
  maxRows: 32,
  /** Steps in one pattern (the app's `MAX_STEPS`). */
  maxSteps: 64,
  /** Sampler banks in one sampler slot. */
  maxSamplerBanks: 8,
  /** Notes stacked on one step (`chord`). */
  maxChordNotes: 16,
  /** Points in a custom LFO / window / grain curve. */
  maxCurvePoints: 512,
  /** Phoneme edits on one note. */
  maxPhonemes: 64,
  /** Automation lanes in one pattern. */
  maxAutomationLanes: 64,
  /** Issues reported for one failed import. */
  maxReportedIssues: 25,
  maxIdLength: 64,
  maxNameLength: 80,
  maxDescriptionLength: 500,
} as const;

/** SYNTH A / B settings a pack may carry. The values are validated against fixed ranges. */
export interface PackInstruments {
  synthA?: Partial<SynthParams>;
  synthB?: Partial<SynthParams>;
}

/**
 * A pack in memory: what the Session Launcher loads. Built-in starters, library
 * starters and imported files all end up as this.
 */
export interface SessionPack {
  formatVersion: typeof SESSION_PACK_FORMAT_VERSION;
  /** Stable slug (`^[a-z0-9]+(-[a-z0-9]+)*$`). Collisions are resolved on import, see `resolvePackId`. */
  id: string;
  name: string;
  description: string;
  author?: string;
  session: SessionDocument;
  trackStorage: TrackStorageMap;
  /** Instrument settings the pack's clips were written for, applied on load. */
  instruments?: PackInstruments;
}

/** The JSON document on disk. `trackStorage` may omit empty tracks and trailing empty slots. */
export interface SessionPackFile extends Omit<SessionPack, 'trackStorage'> {
  format: typeof SESSION_PACK_FORMAT;
  trackStorage: Partial<TrackStorageMap>;
}

export type PackIssueCode =
  /** The text is larger than `PACK_LIMITS.maxBytes`. */
  | 'too-large'
  | 'invalid-json'
  /** Parsed, but not a pack (wrong or missing `format`, not an object). */
  | 'not-a-pack'
  /** `formatVersion` is newer than this build, or has no migration path. */
  | 'unsupported-version'
  /** A field has the wrong type, an out-of-range value, an unknown key, … */
  | 'schema'
  /** A scene, clip or slot points at something that is not there. */
  | 'reference'
  /** An id (clip, scene) is used twice. */
  | 'duplicate-id'
  /** Rows / columns / names disagree with each other. */
  | 'inconsistent'
  /** A note name is not a playable pitch. */
  | 'note'
  /** The session cannot be written as a valid pack (export). */
  | 'export';

export interface PackIssue {
  code: PackIssueCode;
  /** Where, as a JS-style path (`trackStorage.kick[0].steps[3].velocity`); empty for the whole file. */
  path: string;
  /** What is wrong and what to change, in one sentence. */
  message: string;
}

export type PackImportResult =
  | { ok: true; pack: SessionPack; warnings: PackIssue[]; bytes: number }
  | { ok: false; errors: PackIssue[] };
