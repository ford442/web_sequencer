import type { TrackKey } from '@/constants/appDefaults';
import { TRACK_KEYS } from '@/constants';

export type SessionGridFocus = { kind: 'clip'; track: TrackKey; row: number } | { kind: 'scene'; row: number };

export function moveSessionFocus(
  focus: SessionGridFocus,
  key: string,
  rowCount: number,
): SessionGridFocus {
  const lastRow = Math.max(0, rowCount - 1);
  const trackIndex = (t: TrackKey) => TRACK_KEYS.indexOf(t);

  if (focus.kind === 'scene') {
    if (key === 'ArrowDown') return { kind: 'scene', row: Math.min(lastRow, focus.row + 1) };
    if (key === 'ArrowUp') return { kind: 'scene', row: Math.max(0, focus.row - 1) };
    if (key === 'ArrowRight') return { kind: 'clip', track: TRACK_KEYS[0], row: focus.row };
    return focus;
  }

  const ti = trackIndex(focus.track);
  if (key === 'ArrowLeft') {
    if (ti <= 0) return { kind: 'scene', row: focus.row };
    return { kind: 'clip', track: TRACK_KEYS[ti - 1], row: focus.row };
  }
  if (key === 'ArrowRight' && ti < TRACK_KEYS.length - 1) {
    return { kind: 'clip', track: TRACK_KEYS[ti + 1], row: focus.row };
  }
  if (key === 'ArrowDown') return { kind: 'clip', track: focus.track, row: Math.min(lastRow, focus.row + 1) };
  if (key === 'ArrowUp') return { kind: 'clip', track: focus.track, row: Math.max(0, focus.row - 1) };
  return focus;
}
