import type { TrackKey } from '@/constants/appDefaults';
import type { SessionClip, SessionDocument } from './types';

export function clipById(doc: SessionDocument, track: TrackKey, clipId: string): SessionClip | null {
  return doc.columns[track]?.clips.find((c) => c.id === clipId) ?? null;
}

export function columnClips(doc: SessionDocument, track: TrackKey): SessionClip[] {
  return doc.columns[track]?.clips ?? [];
}

export function resolveFollowClip(
  doc: SessionDocument,
  track: TrackKey,
  current: SessionClip,
  rng: () => number = Math.random,
): SessionClip | 'stop' | null {
  const clips = columnClips(doc, track);
  const idx = clips.findIndex((c) => c.id === current.id);
  if (idx < 0) return null;

  switch (current.followAction) {
    case 'none':
      return null;
    case 'stop':
      return 'stop';
    case 'repeat':
      return null;
    case 'next': {
      for (let i = 1; i <= clips.length; i++) {
        const c = clips[(idx + i) % clips.length];
        if (c && !c.empty && c.id !== current.id) return c;
      }
      return 'stop';
    }
    case 'previous': {
      for (let i = 1; i <= clips.length; i++) {
        const c = clips[(idx - i + clips.length) % clips.length];
        if (c && !c.empty && c.id !== current.id) return c;
      }
      return 'stop';
    }
    case 'random': {
      const candidates = clips.filter((c) => !c.empty && c.id !== current.id);
      if (candidates.length === 0) return 'stop';
      const pick = Math.floor(rng() * candidates.length);
      return candidates[pick] ?? 'stop';
    }
    default:
      return null;
  }
}
