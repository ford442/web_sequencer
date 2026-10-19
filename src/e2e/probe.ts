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

const e2eAudioTaps = new Map<string, AudioNode>();

/**
 * Expose an engine's output node to `measureAudioTapPeak` (e2e mode only), so a
 * spec can tell a native voice that renders from one that is merely wired up.
 */
export function registerE2eAudioTap(name: string, node: AudioNode | null): void {
  if (!isE2eMode()) return;
  if (node) e2eAudioTaps.set(name, node);
  else e2eAudioTaps.delete(name);
}

/**
 * Peak |sample| on a registered tap over `ms` of audio clock, or null if no
 * such tap. The analyser is pulled through a gain-0 node into the destination:
 * an AnalyserNode with no path to the destination is not rendered.
 */
export async function measureE2eAudioTapPeak(name: string, ms: number): Promise<number | null> {
  const node = e2eAudioTaps.get(name);
  if (!node) return null;
  const context = node.context;
  const analyser = context.createAnalyser();
  analyser.fftSize = 2048;
  const sink = context.createGain();
  sink.gain.value = 0;
  node.connect(analyser);
  analyser.connect(sink);
  sink.connect(context.destination);
  const buf = new Float32Array(analyser.fftSize);
  let peak = 0;
  const end = performance.now() + ms;
  try {
    while (performance.now() < end) {
      analyser.getFloatTimeDomainData(buf);
      for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]));
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
  } finally {
    node.disconnect(analyser);
    analyser.disconnect();
    sink.disconnect();
  }
  return peak;
}
