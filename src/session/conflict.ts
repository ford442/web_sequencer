import type { TrackKey } from '@/constants/appDefaults';
import type { CompiledLaunchEvent, LaunchSource } from './types';

/**
 * Conflict rules (same quantized boundary):
 *
 * 1. Song Mode vs Session
 *    - Starting Song Mode playback stops session clips (`song-mode` source).
 *    - A live session launch (`manual` / `midi` / `gamepad` / `scene`) preempts
 *      Song Mode: the arrangement yields at that boundary.
 *
 * 2. Scene vs per-track manual
 *    - Later `requestSeq` wins.
 *    - If seq is equal, manual/midi/gamepad clip launch beats scene.
 *    - `stop-track` / `stop-all` beat start/replace from a scene at the same seq.
 *
 * 3. Per-track independence
 *    - Events on different tracks never cancel each other (scene atomicity is
 *      expressed by sharing audioTime/step, not by locking tracks).
 */
const SOURCE_RANK: Record<LaunchSource, number> = {
  'song-mode': 0,
  scene: 1,
  follow: 2,
  'capture-replay': 3,
  manual: 4,
  midi: 4,
  gamepad: 4,
};

function actionRank(action: CompiledLaunchEvent['action']): number {
  if (action === 'stop') return 2;
  if (action === 'replace') return 1;
  return 0;
}

export function compareLaunchPriority(a: CompiledLaunchEvent, b: CompiledLaunchEvent): number {
  if (a.requestSeq !== b.requestSeq) return a.requestSeq - b.requestSeq;
  const src = SOURCE_RANK[a.source] - SOURCE_RANK[b.source];
  if (src !== 0) return src;
  return actionRank(a.action) - actionRank(b.action);
}

/** Keep the winning event per track at a shared timelineStep. */
export function resolveTrackConflicts(events: CompiledLaunchEvent[]): CompiledLaunchEvent[] {
  const byTrack = new Map<TrackKey, CompiledLaunchEvent>();
  const ordered = [...events].sort(compareLaunchPriority);
  for (const ev of ordered) {
    const prev = byTrack.get(ev.track);
    if (!prev) {
      byTrack.set(ev.track, ev);
      continue;
    }
    if (compareLaunchPriority(prev, ev) <= 0) {
      byTrack.set(ev.track, ev);
    }
  }
  return [...byTrack.values()].sort((a, b) => a.track.localeCompare(b.track));
}

export function shouldPreemptSongMode(source: LaunchSource, songModeActive: boolean): boolean {
  if (!songModeActive) return false;
  return source === 'manual' || source === 'midi' || source === 'gamepad' || source === 'scene';
}

export function shouldPreemptSession(source: LaunchSource): boolean {
  return source === 'song-mode';
}
