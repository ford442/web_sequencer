/**
 * Pack format migrations — pure functions on parsed JSON, run at the import
 * boundary before anything is validated or stored.
 *
 * A migration lifts a file from version N to N + 1 and does nothing else: no
 * I/O, no clock, no randomness, no mutation of its input (the input is a deep
 * copy anyway). Version 1 is the first format, so the table is empty today;
 * the day the format changes, add `PACK_MIGRATIONS[1]` here and bump
 * `SESSION_PACK_FORMAT_VERSION`. Files from a build newer than this one are
 * refused rather than guessed at.
 */

import { SESSION_PACK_FORMAT, SESSION_PACK_FORMAT_VERSION, type PackIssue } from './format';

type RawPack = Record<string, unknown>;

/** Lifts a version-N file to N + 1. `formatVersion` is stamped by the runner, not by the migration. */
export type PackMigration = (raw: RawPack) => RawPack;

/** Keyed by the version a migration upgrades *from*. */
export const PACK_MIGRATIONS: Readonly<Record<number, PackMigration>> = {};

export interface MigrateOptions {
  /** Version to migrate to. Defaults to this build's `SESSION_PACK_FORMAT_VERSION`. */
  current?: number;
  /** Migration table. Defaults to `PACK_MIGRATIONS`; tests inject their own. */
  migrations?: Readonly<Record<number, PackMigration>>;
}

export type MigrateResult =
  | { ok: true; raw: RawPack; fromVersion: number }
  | { ok: false; error: PackIssue };

function isRecord(value: unknown): value is RawPack {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A friendlier "not a pack" for the two other JSON files people are likely to pick by mistake. */
function wrongFileHint(raw: RawPack): string {
  if ('pattern' in raw && 'params' in raw) return ' This looks like a song file — open it with Load Song instead.';
  if ('meta' in raw && 'tracks' in raw) return ' This looks like an AI song — use the AI Song import instead.';
  return '';
}

export function migrateSessionPack(input: unknown, options: MigrateOptions = {}): MigrateResult {
  const current = options.current ?? SESSION_PACK_FORMAT_VERSION;
  const migrations = options.migrations ?? PACK_MIGRATIONS;

  if (!isRecord(input)) {
    return { ok: false, error: { code: 'not-a-pack', path: '', message: 'The file must contain a JSON object, not an array or a bare value.' } };
  }
  if (input.format !== SESSION_PACK_FORMAT) {
    return {
      ok: false,
      error: {
        code: 'not-a-pack',
        path: 'format',
        message: `Not a Hyphon session pack: "format" must be "${SESSION_PACK_FORMAT}".${wrongFileHint(input)}`,
      },
    };
  }
  const version = input.formatVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return {
      ok: false,
      error: { code: 'unsupported-version', path: 'formatVersion', message: '"formatVersion" must be a whole number, 1 or higher.' },
    };
  }
  if (version > current) {
    return {
      ok: false,
      error: {
        code: 'unsupported-version',
        path: 'formatVersion',
        message: `This pack is format version ${version}; this build reads up to version ${current}. Update Hyphon, or export the pack again from a build that matches.`,
      },
    };
  }

  // structuredClone: a migration may build on its input freely and the caller's object stays as it was.
  let raw: RawPack = structuredClone(input);
  for (let from = version; from < current; from++) {
    const step = migrations[from];
    if (!step) {
      return {
        ok: false,
        error: { code: 'unsupported-version', path: 'formatVersion', message: `No migration from pack format version ${from} to ${from + 1}.` },
      };
    }
    try {
      raw = { ...step(raw), formatVersion: from + 1 };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: { code: 'unsupported-version', path: 'formatVersion', message: `Could not upgrade the pack from format version ${from}: ${reason}` },
      };
    }
  }
  return { ok: true, raw, fromVersion: version };
}
