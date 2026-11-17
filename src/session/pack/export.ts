/**
 * Export the live session as a `.hyphonpack.json`.
 *
 * The file is built from the same state the song save reads (`trackStorage`,
 * the session document, SYNTH A / B), then run back through the importer's
 * own validator: a file this module returns is a file `parseSessionPackText`
 * accepts. If the live state cannot be written as a valid pack the result
 * says why instead of producing a file that would fail to load.
 */

import { TRACK_KEYS } from '@/constants';
import type { TrackKey } from '@/constants/appDefaults';
import type { PartSequence, SynthParams } from '@/types';
import { clamp } from '@/utils/math';
import { normalizeWaveform } from '@/utils/waveformParser';
import type { TrackStorageMap } from '@/utils/trackStorageUtils';
import type { SessionDocument } from '../types';
import {
  PACK_LIMITS,
  SESSION_PACK_FILE_EXTENSION,
  SESSION_PACK_FORMAT,
  SESSION_PACK_FORMAT_VERSION,
  type PackInstruments,
  type PackIssue,
  type SessionPackFile,
} from './format';
import { PACK_MACRO_RANGES, PACK_SYNTH_NUMERIC_RANGES, PACK_WAVEFORMS } from './instruments';
import { parseSessionPackText } from './validate';
import { TB303_MODELS } from '@/engines/TB303Models';
import { MACRO_MAX_POLYPHONY } from '@/engines/MacroParams';

export interface PackExportInput {
  name: string;
  description?: string;
  author?: string;
  session: SessionDocument;
  trackStorage: TrackStorageMap;
  /** Live SYNTH A / B parameters; only the fields the format supports are written. */
  synthA?: Partial<SynthParams>;
  synthB?: Partial<SynthParams>;
}

export type PackExportResult =
  | { ok: true; file: SessionPackFile; text: string; filename: string; warnings: string[] }
  | { ok: false; errors: PackIssue[] };

/** `"Acid Set #2"` → `"acid-set-2"`; never empty, never over the id limit. */
export function slugifyPackId(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, PACK_LIMITS.maxIdLength)
    .replace(/-+$/g, '');
  return slug || 'session-pack';
}

const clampTo = (v: number, [min, max]: readonly [number, number]) => clamp(v, min, max);

/**
 * The part of a `SynthParams` a pack can carry. Values are clamped into the
 * documented ranges (the UI keeps them there anyway); anything unsupported,
 * non-finite or unknown is left out and named in `dropped`.
 */
export function pickPackSynthSettings(params: Partial<SynthParams> | undefined): {
  settings: Partial<SynthParams>;
  dropped: string[];
} {
  const settings: Partial<SynthParams> = {};
  const dropped: string[] = [];
  if (!params) return { settings, dropped };

  if (params.waveform !== undefined) {
    const waveform = normalizeWaveform(params.waveform);
    if (PACK_WAVEFORMS.includes(waveform)) settings.waveform = waveform;
    else dropped.push(`waveform "${String(params.waveform)}"`);
  }
  if (params.engine303 === 'open303' || params.engine303 === 'jc303') settings.engine303 = params.engine303;
  if (params.model303 !== undefined) {
    if (TB303_MODELS.some((m) => m.id === params.model303)) settings.model303 = params.model303;
    else dropped.push(`303 voice "${String(params.model303)}"`);
  }
  const numeric = settings as Record<string, number>;
  for (const [key, range] of Object.entries(PACK_SYNTH_NUMERIC_RANGES)) {
    const value = (params as Record<string, unknown>)[key];
    if (typeof value === 'number' && Number.isFinite(value)) numeric[key] = clampTo(value, range);
  }
  if (params.macro) {
    const macro: NonNullable<SynthParams['macro']> = {};
    const out = macro as Record<string, number>;
    for (const [key, range] of Object.entries(PACK_MACRO_RANGES)) {
      const value = (params.macro as Record<string, unknown>)[key];
      if (typeof value === 'number' && Number.isFinite(value)) out[key] = clampTo(value, range);
    }
    const poly = params.macro.polyphony;
    if (typeof poly === 'number' && Number.isFinite(poly)) macro.polyphony = Math.round(clamp(poly, 1, MACRO_MAX_POLYPHONY));
    if (params.macro.lpgMode === 'gate' || params.macro.lpgMode === 'ping') macro.lpgMode = params.macro.lpgMode;
    if (Object.keys(macro).length > 0) settings.macro = macro;
  }
  return { settings, dropped };
}

type Slot = PartSequence | PartSequence[] | null | undefined;

/** The app only writes sampler banks as arrays and every other track as one pattern; mend the odd one out. */
function normalizeSlot(track: TrackKey, slot: Slot): PartSequence | PartSequence[] | null {
  if (slot == null) return null;
  if (track === 'sampler') return Array.isArray(slot) ? slot : [slot];
  return Array.isArray(slot) ? (slot[0] ?? null) : slot;
}

function packTrackStorage(storage: TrackStorageMap): SessionPackFile['trackStorage'] {
  const out: SessionPackFile['trackStorage'] = {};
  for (const track of TRACK_KEYS) {
    const slots = storage[track].map((slot) => normalizeSlot(track, slot));
    while (slots.length > 0 && slots[slots.length - 1] === null) slots.pop();
    if (slots.length > 0) out[track] = slots;
  }
  return out;
}

/**
 * JSON with short things on one line: a step stays `{"note":"C2","velocity":0.9}`,
 * a pattern's steps stack one per line. Same data as `JSON.stringify`, much
 * easier to read and diff.
 */
export function stringifyPackFile(value: unknown, indent = 0, width = 96): string {
  const flat = JSON.stringify(value);
  if (flat === undefined) return 'null';
  if (typeof value !== 'object' || value === null || flat.length <= width) return flat;
  const pad = '  '.repeat(indent + 1);
  const close = '  '.repeat(indent);
  if (Array.isArray(value)) {
    return `[\n${value.map((v) => pad + stringifyPackFile(v, indent + 1, width)).join(',\n')}\n${close}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
  return `{\n${entries.map(([k, v]) => `${pad}${JSON.stringify(k)}: ${stringifyPackFile(v, indent + 1, width)}`).join(',\n')}\n${close}}`;
}

export function exportSessionPack(input: PackExportInput): PackExportResult {
  const warnings: string[] = [];
  const name = input.name.trim().slice(0, PACK_LIMITS.maxNameLength) || 'Session pack';
  const trackStorage = packTrackStorage(input.trackStorage);

  // A clip with no pattern behind it cannot be launched; write it as empty rather than as a dangling reference.
  let mended = 0;
  const session: SessionDocument = JSON.parse(JSON.stringify(input.session)) as SessionDocument;
  for (const track of TRACK_KEYS) {
    for (const clip of session.columns[track].clips) {
      if (!clip.empty && trackStorage[track]?.[clip.slotIndex] == null) {
        clip.empty = true;
        mended += 1;
      }
    }
  }
  if (mended > 0) warnings.push(`${mended} clip${mended === 1 ? '' : 's'} pointed at an empty pattern slot and ${mended === 1 ? 'was' : 'were'} exported as empty.`);

  const instruments: PackInstruments = {};
  for (const part of ['synthA', 'synthB'] as const) {
    const { settings, dropped } = pickPackSynthSettings(input[part]);
    if (Object.keys(settings).length > 0) instruments[part] = settings;
    if (dropped.length > 0) warnings.push(`${part === 'synthA' ? 'SYNTH A' : 'SYNTH B'}: left out ${dropped.join(', ')} (not part of the pack format).`);
  }

  const file: SessionPackFile = {
    format: SESSION_PACK_FORMAT,
    formatVersion: SESSION_PACK_FORMAT_VERSION,
    id: slugifyPackId(name),
    name,
    description: (input.description ?? '').trim().slice(0, PACK_LIMITS.maxDescriptionLength),
    ...(input.author?.trim() ? { author: input.author.trim().slice(0, PACK_LIMITS.maxNameLength) } : {}),
    session,
    trackStorage,
    ...(Object.keys(instruments).length > 0 ? { instruments } : {}),
  };

  // Readable first; the compact form only if the readable one is over the size limit.
  // Proving the round trip: what we hand out must be what the importer accepts.
  let text = `${stringifyPackFile(file)}\n`;
  let check = parseSessionPackText(text);
  if (!check.ok && check.errors[0]?.code === 'too-large') {
    text = `${JSON.stringify(file)}\n`;
    check = parseSessionPackText(text);
  }
  if (!check.ok) {
    return {
      ok: false,
      errors: check.errors.map((e) => ({
        ...e,
        code: e.code === 'too-large' ? e.code : 'export',
        message: e.code === 'too-large' ? 'This session is too large to export as a pack.' : `This session cannot be exported as a pack — ${e.message}`,
      })),
    };
  }
  return { ok: true, file, text, filename: `${file.id}${SESSION_PACK_FILE_EXTENSION}`, warnings };
}
