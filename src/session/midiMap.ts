import type { MidiControlId } from '@/types/midi';
import type { TrackKey } from '@/constants/appDefaults';
import { TRACK_KEYS } from '@/constants';

export function sessionClipControlId(track: TrackKey, row: number): MidiControlId {
  return `session:clip:${track}:${row}` as MidiControlId;
}

export function sessionSceneControlId(sceneIndex: number): MidiControlId {
  return `session:scene:${sceneIndex}` as MidiControlId;
}

export function sessionStopTrackControlId(track: TrackKey): MidiControlId {
  return `session:stop:${track}` as MidiControlId;
}

export function sessionStopAllControlId(): MidiControlId {
  return 'session:stopAll' as MidiControlId;
}

export type SessionMidiAction =
  | { type: 'clip'; track: TrackKey; row: number; down: boolean }
  | { type: 'scene'; sceneIndex: number; down: boolean }
  | { type: 'stop-track'; track: TrackKey }
  | { type: 'stop-all' };

export function parseSessionMidiParam(param: string, normalized: number): SessionMidiAction | null {
  const down = normalized > 0;
  if (param === 'stopAll') return { type: 'stop-all' };
  if (param.startsWith('scene:')) {
    const sceneIndex = Number(param.slice('scene:'.length));
    if (!Number.isInteger(sceneIndex) || sceneIndex < 0) return null;
    return { type: 'scene', sceneIndex, down };
  }
  if (param.startsWith('stop:')) {
    const track = param.slice('stop:'.length) as TrackKey;
    if (!TRACK_KEYS.includes(track)) return null;
    return { type: 'stop-track', track };
  }
  if (param.startsWith('clip:')) {
    const rest = param.slice('clip:'.length);
    const colon = rest.lastIndexOf(':');
    if (colon <= 0) return null;
    const track = rest.slice(0, colon) as TrackKey;
    const row = Number(rest.slice(colon + 1));
    if (!TRACK_KEYS.includes(track) || !Number.isInteger(row) || row < 0) return null;
    return { type: 'clip', track, row, down };
  }
  return null;
}
