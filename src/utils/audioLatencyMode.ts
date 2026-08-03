// User-selectable AudioContext latency policy (P0 audio foundation, #1033).
// Persisted so the choice survives reloads; only takes effect on the next
// AudioContext construction (playback engine init / page reload).

/** Mirrors the Web Audio spec's AudioContextLatencyCategory. */
export type LatencyMode = AudioContextLatencyCategory;

export const LATENCY_MODES: readonly LatencyMode[] = ['interactive', 'balanced', 'playback'];

export const DEFAULT_LATENCY_MODE: LatencyMode = 'interactive';

export const LATENCY_MODE_STORAGE_KEY = 'hyphon.audioLatencyMode';

export function isLatencyMode(value: unknown): value is LatencyMode {
  return typeof value === 'string' && (LATENCY_MODES as readonly string[]).includes(value);
}

/** Read the persisted latency mode, falling back to the default if unset/invalid. */
export function getStoredLatencyMode(): LatencyMode {
  try {
    const raw = localStorage.getItem(LATENCY_MODE_STORAGE_KEY);
    if (isLatencyMode(raw)) return raw;
  } catch {
    /* localStorage unavailable (private mode / disabled storage) */
  }
  return DEFAULT_LATENCY_MODE;
}

/** Persist the latency mode. Applies on the next AudioContext construction. */
export function setStoredLatencyMode(mode: LatencyMode): void {
  try {
    localStorage.setItem(LATENCY_MODE_STORAGE_KEY, mode);
  } catch {
    /* localStorage unavailable; selection just won't persist across reloads */
  }
}
