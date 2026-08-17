import { TRACK_KEYS } from '@/constants';
import type { TrackKey } from '@/constants/appDefaults';
import { clipIdForSlot, sceneIdForIndex } from './ids';
import {
  SESSION_DEFAULT_ROWS,
  SESSION_DOCUMENT_VERSION,
  type SessionClip,
  type SessionDocument,
  type SessionScene,
  type SessionTrackColumn,
} from './types';

export function createEmptyClip(track: TrackKey, slotIndex: number, empty = true): SessionClip {
  return {
    id: clipIdForSlot(track, slotIndex),
    name: `${slotIndex + 1}`,
    slotIndex,
    launchMode: 'trigger',
    followAction: 'none',
    followRepeatN: 1,
    empty,
  };
}

export function createDefaultColumn(track: TrackKey, rows = SESSION_DEFAULT_ROWS): SessionTrackColumn {
  return {
    track,
    clips: Array.from({ length: rows }, (_, i) => createEmptyClip(track, i, true)),
  };
}

export function createDefaultScenes(columns: Record<TrackKey, SessionTrackColumn>): SessionScene[] {
  const rows = columns.partA?.clips.length ?? SESSION_DEFAULT_ROWS;
  return Array.from({ length: rows }, (_, i) => {
    const clipIds: SessionScene['clipIds'] = {};
    for (const track of TRACK_KEYS) {
      const clip = columns[track]?.clips[i];
      clipIds[track] = clip && !clip.empty ? clip.id : clip?.id ?? null;
    }
    return {
      id: sceneIdForIndex(i),
      name: `Scene ${i + 1}`,
      clipIds,
    };
  });
}

export function createDefaultSessionDocument(rows = SESSION_DEFAULT_ROWS): SessionDocument {
  const columns = {} as Record<TrackKey, SessionTrackColumn>;
  for (const track of TRACK_KEYS) {
    columns[track] = createDefaultColumn(track, rows);
  }
  return {
    schemaVersion: SESSION_DOCUMENT_VERSION,
    quantization: 'bar',
    columns,
    scenes: createDefaultScenes(columns),
  };
}

export function emptyPlayingMap(): Record<TrackKey, null> {
  const map = {} as Record<TrackKey, null>;
  for (const track of TRACK_KEYS) {
    map[track] = null;
  }
  return map;
}
