declare global {
  interface Window {
    __HYPHON_E2E_TRANSPORT__?: {
      step: number;
      laneCount: number;
    };
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
