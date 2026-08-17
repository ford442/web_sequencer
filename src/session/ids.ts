import type { TrackKey } from '@/constants/appDefaults';
import type { ClipId, SceneId } from './types';

/** Deterministic clip id used by migration / default adapters. */
export function clipIdForSlot(track: TrackKey, slotIndex: number): ClipId {
  return `c:${track}:${slotIndex}`;
}

export function sceneIdForIndex(index: number): SceneId {
  return `s:${index}`;
}

let extraSeq = 0;

/** Extra clips created after migration (still stable for the process + save). */
export function allocateClipId(track: TrackKey, slotIndex: number): ClipId {
  extraSeq += 1;
  return `c:${track}:${slotIndex}:x${extraSeq.toString(36)}`;
}

export function parseClipId(id: ClipId): { track: TrackKey; slotIndex: number } | null {
  const parts = id.split(':');
  if (parts.length < 3 || parts[0] !== 'c') return null;
  const track = parts[1] as TrackKey;
  const slotIndex = Number(parts[2]);
  if (!Number.isInteger(slotIndex) || slotIndex < 0) return null;
  return { track, slotIndex };
}
