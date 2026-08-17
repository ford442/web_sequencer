import { TRACK_KEYS } from '@/constants';
import type { TrackKey } from '@/constants/appDefaults';
import type { PartSequence } from '@/types';
import type { TrackStorageMap } from '@/utils/trackStorageUtils';
import { createDefaultSessionDocument, createEmptyClip } from './defaults';
import {
  SESSION_DEFAULT_ROWS,
  SESSION_DOCUMENT_VERSION,
  type SessionClip,
  type SessionDocument,
  type SessionScene,
  type SessionTrackColumn,
} from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseLaunchMode(value: unknown): SessionClip['launchMode'] {
  if (value === 'trigger' || value === 'gate' || value === 'toggle' || value === 'one-shot') {
    return value;
  }
  return 'trigger';
}

function parseFollow(value: unknown): SessionClip['followAction'] {
  if (
    value === 'none' ||
    value === 'next' ||
    value === 'previous' ||
    value === 'random' ||
    value === 'stop' ||
    value === 'repeat'
  ) {
    return value;
  }
  return 'none';
}

function parseClip(raw: unknown, track: TrackKey, fallbackSlot: number): SessionClip {
  const base = createEmptyClip(track, fallbackSlot, true);
  if (!isRecord(raw)) return base;
  const slotIndex = typeof raw.slotIndex === 'number' && Number.isInteger(raw.slotIndex)
    ? Math.max(0, raw.slotIndex)
    : fallbackSlot;
  return {
    id: typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : base.id,
    name: typeof raw.name === 'string' && raw.name.length > 0 ? raw.name : String(slotIndex + 1),
    slotIndex,
    launchMode: parseLaunchMode(raw.launchMode),
    followAction: parseFollow(raw.followAction),
    followRepeatN:
      typeof raw.followRepeatN === 'number' && raw.followRepeatN >= 1
        ? Math.floor(raw.followRepeatN)
        : 1,
    empty: raw.empty === false ? false : Boolean(raw.empty ?? true),
  };
}

function parseColumn(raw: unknown, track: TrackKey): SessionTrackColumn {
  const fallback = createDefaultSessionDocument().columns[track];
  if (!isRecord(raw) || !Array.isArray(raw.clips)) return fallback;
  const clips = raw.clips.map((c, i) => parseClip(c, track, i));
  return { track, clips: clips.length > 0 ? clips : fallback.clips };
}

function parseScene(raw: unknown, index: number, fallback: SessionScene): SessionScene {
  if (!isRecord(raw)) return fallback;
  const clipIds: SessionScene['clipIds'] = { ...fallback.clipIds };
  if (isRecord(raw.clipIds)) {
    for (const track of TRACK_KEYS) {
      const v = raw.clipIds[track];
      if (v === null || typeof v === 'string') clipIds[track] = v;
    }
  }
  return {
    id: typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : fallback.id,
    name: typeof raw.name === 'string' && raw.name.length > 0 ? raw.name : fallback.name,
    clipIds,
  };
}

/**
 * Build a session document from existing trackStorage: occupied slots become
 * non-empty clips. Legacy 8-slot songs map to 8 rows / 8 scenes.
 */
export function sessionFromTrackStorage(
  storage: TrackStorageMap | undefined,
  rows = SESSION_DEFAULT_ROWS,
): SessionDocument {
  const doc = createDefaultSessionDocument(rows);
  if (!storage) return doc;
  for (const track of TRACK_KEYS) {
    const slots = storage[track] ?? [];
    const clips = doc.columns[track].clips.map((clip, i) => {
      const stored = slots[clip.slotIndex] ?? slots[i] ?? null;
      const occupied = stored != null && hasAnyNotes(stored);
      return { ...clip, empty: !occupied };
    });
    doc.columns[track] = { track, clips };
  }
  doc.scenes = doc.scenes.map((scene, i) => {
    const clipIds: SessionScene['clipIds'] = {};
    for (const track of TRACK_KEYS) {
      const clip = doc.columns[track].clips[i];
      clipIds[track] = clip && !clip.empty ? clip.id : null;
    }
    return { ...scene, clipIds };
  });
  return doc;
}

function hasAnyNotes(seq: PartSequence | PartSequence[]): boolean {
  if (Array.isArray(seq)) {
    return seq.some((bank) => bank.steps.some((n) => n != null));
  }
  return seq.steps.some((n) => n != null);
}

/** Parse unknown JSON into a valid SessionDocument; never throws. */
export function parseSessionDocument(
  raw: unknown,
  storage?: TrackStorageMap,
): SessionDocument {
  const fallback = sessionFromTrackStorage(storage);
  if (!isRecord(raw)) return fallback;

  const columns = {} as Record<TrackKey, SessionTrackColumn>;
  const rawColumns = isRecord(raw.columns) ? raw.columns : {};
  for (const track of TRACK_KEYS) {
    columns[track] = parseColumn(rawColumns[track], track);
  }

  const defaultScenes = fallback.scenes;
  const scenesRaw = Array.isArray(raw.scenes) ? raw.scenes : [];
  const scenes = (scenesRaw.length > 0 ? scenesRaw : defaultScenes).map((s, i) =>
    parseScene(s, i, defaultScenes[i] ?? defaultScenes[0]),
  );

  const quant = raw.quantization;
  const quantization =
    quant === 'immediate' ||
    quant === 'step' ||
    quant === 'beat' ||
    quant === 'bar' ||
    quant === '2bars' ||
    quant === '4bars'
      ? quant
      : fallback.quantization;

  return {
    schemaVersion: SESSION_DOCUMENT_VERSION,
    quantization,
    columns,
    scenes: scenes.length > 0 ? scenes : defaultScenes,
  };
}

export function migrateSavedSongSession(
  version: number | undefined,
  sessionRaw: unknown,
  storage?: TrackStorageMap,
): SessionDocument {
  if (sessionRaw != null) {
    return parseSessionDocument(sessionRaw, storage);
  }
  // v1 (8 slots) and v2 (32 slots) songs without a session document.
  const rows = version === 1 ? 8 : SESSION_DEFAULT_ROWS;
  return sessionFromTrackStorage(storage, rows);
}
