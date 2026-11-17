/**
 * Import boundary for `.hyphonpack.json`: text in, a validated `SessionPack`
 * or a list of actionable issues out. Nothing here touches app state — a
 * failed import cannot change the active session because this is all that runs
 * before the user confirms a load.
 *
 * Order matters and each stage only sees what the previous one accepted:
 *   1. size      — refuse oversized text before parsing it
 *   2. JSON.parse — data only: no reviver, no eval
 *   3. migrate   — older format versions are lifted to this build's version
 *   4. structure — the precompiled schema (types, ranges, closed objects)
 *   5. references — what a schema cannot say: ids, slots, scenes, note names
 *   6. normalize — a fresh `SessionPack` built from the accepted fields
 */

import { TRACK_KEYS } from '@/constants';
import type { TrackKey } from '@/constants/appDefaults';
import { NOTE_NAME_SOURCE, noteToMidi } from '@/utils/musicTheory';
import { createEmptyTrackStorage } from '@/utils/trackStorageUtils';
import { SESSION_TRACK_LABELS } from '../types';
import {
  PACK_ID_SOURCE,
  PACK_LIMITS,
  SESSION_PACK_FORMAT_VERSION,
  type PackImportResult,
  type PackIssue,
  type SessionPack,
  type SessionPackFile,
} from './format';
import { validate_session_pack, type PackValidationError } from './generated/packValidator.js';
import { migrateSessionPack } from './migrate';

// ── structural errors → sentences ───────────────────────────────────────────

/** `/trackStorage/kick/0/steps/3` → `trackStorage.kick[0].steps[3]`. */
export function formatPackPath(pointer: string): string {
  let out = '';
  for (const raw of pointer.split('/').slice(1)) {
    const segment = raw.replaceAll('~1', '/').replaceAll('~0', '~');
    out += /^\d+$/.test(segment) ? `[${segment}]` : out === '' ? segment : `.${segment}`;
  }
  return out;
}

function valueAt(root: unknown, pointer: string): unknown {
  let cur: unknown = root;
  for (const raw of pointer.split('/').slice(1)) {
    if (typeof cur !== 'object' || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[raw.replaceAll('~1', '/').replaceAll('~0', '~')];
  }
  return cur;
}

function show(value: unknown): string {
  if (value === undefined) return 'nothing';
  const text = JSON.stringify(value) ?? 'a value';
  return text.length > 40 ? `${text.slice(0, 37)}…` : text;
}

const PATTERN_HINTS: Array<[string, string]> = [
  [PACK_ID_SOURCE, 'must be a lowercase slug: letters a–z and digits, words joined by single hyphens (e.g. "my-pack")'],
  [NOTE_NAME_SOURCE, 'is not a note name; use a letter A–G, an optional # or b, and an octave from -1 to 9 (e.g. "C4", "F#3")'],
  ['^[A-Za-z0-9:_.-]+$', 'may only contain letters, digits and the characters : _ . -'],
  ['^[A-Za-z][A-Za-z0-9]{0,47}$', 'must start with a letter and use only letters and digits (at most 48)'],
];

function describeSchemaError(errors: PackValidationError[], root: unknown): string {
  // `propertyNames` reports the unknown key; the enum error before it does not name it.
  const unknownName = errors.find((e) => e.keyword === 'propertyNames');
  const err = unknownName ?? errors[0];
  const where = err.instancePath;
  const value = valueAt(root, where);
  const p = err.params;
  const UNKNOWN_FIELD_HINT =
    'Packs only carry the fields listed in docs/session-pack-format.md — no URLs, scripts or other data.';
  switch (err.keyword) {
    case 'propertyNames':
      return `unknown field "${String(p.propertyName)}". ${UNKNOWN_FIELD_HINT}`;
    case 'additionalProperties':
      return `unknown field "${String(p.additionalProperty)}". ${UNKNOWN_FIELD_HINT}`;
    case 'required':
      return `missing required field "${String(p.missingProperty)}".`;
    case 'type': {
      const want = Array.isArray(p.type) ? (p.type as string[]).join(' or ') : String(p.type);
      // JSON has no Infinity, but `1e999` parses to one; JSON.stringify would print it as "null".
      if (typeof value === 'number' && !Number.isFinite(value)) return `must be a finite ${want}, got ${String(value)}.`;
      return `must be ${want}, got ${show(value)}.`;
    }
    case 'enum': {
      const allowed = (p.allowedValues as unknown[]) ?? [];
      const list = allowed.slice(0, 12).map((v) => JSON.stringify(v)).join(', ');
      return `${show(value)} is not allowed; use one of ${list}${allowed.length > 12 ? ', …' : ''}.`;
    }
    case 'const':
      return `must be ${show(p.allowedValue)}, got ${show(value)}.`;
    case 'minimum':
    case 'maximum':
      return `${show(value)} is out of range; it must be ${err.keyword === 'minimum' ? 'at least' : 'at most'} ${show(p.limit)}.`;
    case 'minLength':
      return 'must not be empty.';
    case 'maxLength':
      return `is too long (${typeof value === 'string' ? value.length : '?'} characters); the limit is ${show(p.limit)}.`;
    case 'minItems':
      return `needs at least ${show(p.limit)} item(s).`;
    case 'maxItems':
      return `has too many items (${Array.isArray(value) ? value.length : '?'}); the limit is ${show(p.limit)}.`;
    case 'maxProperties':
      return `has too many entries; the limit is ${show(p.limit)}.`;
    case 'pattern': {
      const hint = PATTERN_HINTS.find(([source]) => source === p.pattern)?.[1];
      return `${show(value)} ${hint ?? 'contains control or text-direction characters, which are not allowed in names'}.`;
    }
    default:
      return err.message ?? 'is not valid.';
  }
}

function structureIssue(errors: PackValidationError[], root: unknown): PackIssue {
  const err = errors.find((e) => e.keyword === 'propertyNames') ?? errors[0];
  const path = formatPackPath(err.instancePath);
  const message = describeSchemaError(errors, root);
  return { code: 'schema', path, message: path ? `${path}: ${message}` : message };
}

// ── references and other rules a schema cannot state ────────────────────────

interface Findings {
  errors: PackIssue[];
  warnings: PackIssue[];
}

function checkReferences(file: SessionPackFile): Findings {
  const errors: PackIssue[] = [];
  const warnings: PackIssue[] = [];
  const full = () => errors.length >= PACK_LIMITS.maxReportedIssues;
  const fail = (code: PackIssue['code'], path: string, message: string) => {
    if (!full()) errors.push({ code, path, message: `${path}: ${message}` });
  };
  const { session, trackStorage } = file;

  // Rows: one clip per scene row in every column.
  const rows = session.columns.partA.clips.length;
  for (const track of TRACK_KEYS) {
    const column = session.columns[track];
    if (column.track !== track) {
      fail('inconsistent', `session.columns.${track}.track`, `is "${column.track}" but the column sits under "${track}".`);
    }
    if (column.clips.length !== rows) {
      fail(
        'inconsistent',
        `session.columns.${track}.clips`,
        `has ${column.clips.length} clips but partA has ${rows}; every track needs one clip per row.`,
      );
    }
  }
  if (session.scenes.length > rows) {
    fail('inconsistent', 'session.scenes', `has ${session.scenes.length} scenes but the session only has ${rows} rows.`);
  }

  // Ids are unique across the whole document: a scene names a clip by id alone.
  const clipOwner = new Map<string, TrackKey>();
  for (const track of TRACK_KEYS) {
    session.columns[track].clips.forEach((clip, row) => {
      const path = `session.columns.${track}.clips[${row}]`;
      const seen = clipOwner.get(clip.id);
      if (seen) fail('duplicate-id', `${path}.id`, `"${clip.id}" is already used by a clip on ${SESSION_TRACK_LABELS[seen]}; clip ids must be unique.`);
      else clipOwner.set(clip.id, track);

      // A non-empty clip must have a pattern to play.
      if (!clip.empty && trackStorage[track]?.[clip.slotIndex] == null) {
        fail(
          'reference',
          `${path}.slotIndex`,
          `clip "${clip.name}" is not empty but trackStorage.${track}[${clip.slotIndex}] has no pattern. Add the pattern or set "empty": true.`,
        );
      }
    });
  }
  const sceneIds = new Set<string>();
  session.scenes.forEach((scene, i) => {
    if (sceneIds.has(scene.id)) fail('duplicate-id', `session.scenes[${i}].id`, `"${scene.id}" is used by another scene; scene ids must be unique.`);
    sceneIds.add(scene.id);
    for (const track of TRACK_KEYS) {
      const id = scene.clipIds[track];
      if (id == null) continue;
      const owner = clipOwner.get(id);
      const path = `session.scenes[${i}].clipIds.${track}`;
      if (!owner) fail('reference', path, `scene "${scene.name}" names clip "${id}", which does not exist.`);
      else if (owner !== track) fail('reference', path, `clip "${id}" belongs to ${SESSION_TRACK_LABELS[owner]}, not ${SESSION_TRACK_LABELS[track]}.`);
    }
  });

  // Note names must sound: the grammar allows spellings (G#9) above the MIDI range.
  const badNote = (name: string, path: string) => {
    if (noteToMidi(name) === null) fail('note', path, `"${name}" is outside the playable range C-1…G9.`);
  };
  for (const track of TRACK_KEYS) {
    const slots = trackStorage[track] ?? [];
    slots.forEach((slot, slotIndex) => {
      if (slot == null || full()) return;
      const patterns = Array.isArray(slot) ? slot : [slot];
      patterns.forEach((pattern, bank) => {
        const base = `trackStorage.${track}[${slotIndex}]${Array.isArray(slot) ? `[${bank}]` : ''}.steps`;
        pattern.steps.forEach((step, i) => {
          if (!step) return;
          badNote(step.note, `${base}[${i}].note`);
          step.chord?.forEach((name, c) => badNote(name, `${base}[${i}].chord[${c}]`));
        });
      });
    });
  }

  if (!TRACK_KEYS.some((track) => session.columns[track].clips.some((clip) => !clip.empty))) {
    warnings.push({ code: 'inconsistent', path: 'session', message: 'The pack has no clips to launch (every clip is empty).' });
  }
  return { errors, warnings };
}

// ── normalize ───────────────────────────────────────────────────────────────

function toPack(file: SessionPackFile): SessionPack {
  const trackStorage = createEmptyTrackStorage();
  for (const track of TRACK_KEYS) {
    (file.trackStorage[track] ?? []).forEach((slot, i) => {
      trackStorage[track][i] = slot ?? null;
    });
  }
  const columns = {} as SessionPack['session']['columns'];
  for (const track of TRACK_KEYS) columns[track] = file.session.columns[track];
  const instruments = file.instruments && Object.keys(file.instruments).length > 0 ? file.instruments : undefined;
  return {
    formatVersion: SESSION_PACK_FORMAT_VERSION,
    id: file.id,
    name: file.name,
    description: file.description ?? '',
    ...(file.author ? { author: file.author } : {}),
    session: { ...file.session, columns },
    trackStorage,
    ...(instruments ? { instruments } : {}),
  };
}

// ── entry points ────────────────────────────────────────────────────────────

/** Validate an already-parsed document of the current format version. */
export function validateSessionPackFile(raw: unknown, bytes = 0): PackImportResult {
  if (!validate_session_pack(raw)) {
    const errors = validate_session_pack.errors ?? [];
    return { ok: false, errors: [structureIssue(errors, raw)] };
  }
  const file = raw as SessionPackFile;
  const found = checkReferences(file);
  if (found.errors.length > 0) return { ok: false, errors: found.errors };
  return { ok: true, pack: toPack(file), warnings: found.warnings, bytes };
}

/** UTF-8 length without keeping a copy of the encoded text around. */
function utf8Length(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

/**
 * True when objects / arrays nest deeper than `max` levels (the root is level 1). Iterative on
 * purpose: the input this guards against is exactly what would overflow a recursive walk, and
 * `JSON.parse` accepts nesting far deeper than `structuredClone` or `JSON.stringify` survive.
 */
function nestsDeeperThan(value: unknown, max: number): boolean {
  const pending: Array<[node: object, depth: number]> = [];
  if (typeof value === 'object' && value !== null) pending.push([value, 1]);
  while (pending.length > 0) {
    const [node, depth] = pending.pop() as [object, number];
    if (depth > max) return true;
    for (const child of Object.values(node)) {
      if (typeof child === 'object' && child !== null) pending.push([child, depth + 1]);
    }
  }
  return false;
}

/**
 * Migrate and validate an already-parsed document (a JSON module, say). Same stages as
 * `parseSessionPackText` after `JSON.parse`; `bytes` is only reported back.
 */
export function parseSessionPackValue(parsed: unknown, bytes = 0): PackImportResult {
  // Before the first recursive stage (the migration runner deep-copies its input).
  if (nestsDeeperThan(parsed, PACK_LIMITS.maxDepth)) {
    return {
      ok: false,
      errors: [{
        code: 'schema',
        path: '',
        message: `The file nests data more than ${PACK_LIMITS.maxDepth} levels deep, which no session pack does. Export the pack again from Hyphon instead of editing its structure by hand.`,
      }],
    };
  }
  const migrated = migrateSessionPack(parsed);
  if (!migrated.ok) return { ok: false, errors: [migrated.error] };
  return validateSessionPackFile(migrated.raw, bytes);
}

/**
 * Parse and validate pack text. Pure and synchronous; never throws; never
 * changes anything outside its return value.
 */
export function parseSessionPackText(text: string, maxBytes: number = PACK_LIMITS.maxBytes): PackImportResult {
  // UTF-16 units never exceed UTF-8 bytes, so a long string is refused without encoding it.
  const bytes = text.length > maxBytes ? Infinity : utf8Length(text);
  if (bytes > maxBytes) {
    const mib = (maxBytes / (1024 * 1024)).toFixed(0);
    return {
      ok: false,
      errors: [{ code: 'too-large', path: '', message: `The file is larger than the ${mib} MiB limit for a session pack; nothing was read.` }],
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, errors: [{ code: 'invalid-json', path: '', message: `The file is not valid JSON: ${reason}` }] };
  }
  return parseSessionPackValue(parsed, bytes);
}
