declare global {
  interface Window {
    __HYPHON_E2E_TRANSPORT__?: {
      step: number;
      laneCount: number;
    };
    __HYPHON_E2E_SESSION__?: {
      playingCount: number;
      lastApplyStep: number;
      captureCount: number;
    };
    /** Drum triggers dispatched to the engine (most recent last, capped). */
    __HYPHON_E2E_DRUM_HITS__?: Array<{ track: string; songStep: number; step: number }>;
  }
}

export function isE2eMode(): boolean {
  return typeof location !== 'undefined' && new URLSearchParams(location.search).has('e2e');
}

export function e2eTransportSnapshot(): { step: number; laneCount: number } {
  if (typeof window === 'undefined') return { step: -1, laneCount: 0 };
  const bucket = window.__HYPHON_E2E_TRANSPORT__ ?? { step: -1, laneCount: 0 };
  window.__HYPHON_E2E_TRANSPORT__ = bucket;
  return bucket;
}

export function setE2eTransportStep(step: number): void {
  if (!isE2eMode()) return;
  e2eTransportSnapshot().step = step;
}

export function setE2eLaneCount(count: number): void {
  if (!isE2eMode()) return;
  e2eTransportSnapshot().laneCount = count;
}

export function setE2eSessionState(state: {
  playingCount: number;
  lastApplyStep: number;
  captureCount: number;
}): void {
  if (!isE2eMode() || typeof window === 'undefined') return;
  window.__HYPHON_E2E_SESSION__ = state;
}

const MAX_E2E_DRUM_HITS = 128;

/**
 * Log a dispatched drum trigger. `songStep` is the arrangement position when
 * the linear player is running, else -1.
 */
export function recordE2eDrumHit(track: string, songStep: number, step: number): void {
  if (!isE2eMode() || typeof window === 'undefined') return;
  const hits = (window.__HYPHON_E2E_DRUM_HITS__ ??= []);
  hits.push({ track, songStep, step });
  if (hits.length > MAX_E2E_DRUM_HITS) hits.splice(0, hits.length - MAX_E2E_DRUM_HITS);
}
