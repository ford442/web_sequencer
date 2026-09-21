// User-selectable live AudioContext sample-rate policy (#1136 / remaining #1033).
// Persisted so the choice survives reloads; only takes effect on the next
// AudioContext construction (same as latency mode).

export type SampleRatePref = 'native' | 44100 | 48000;

export const SAMPLE_RATE_PREFS: readonly SampleRatePref[] = ['native', 44100, 48000];

export const DEFAULT_SAMPLE_RATE_PREF: SampleRatePref = 'native';

export const SAMPLE_RATE_STORAGE_KEY = 'hyphon.audioSampleRate';

export function isSampleRatePref(value: unknown): value is SampleRatePref {
  if (value === 'native') return true;
  if (value === 44100 || value === 48000) return true;
  if (value === '44100' || value === '48000') return true;
  return false;
}

export function parseSampleRatePref(raw: string | null): SampleRatePref | null {
  if (raw === null) return null;
  if (raw === 'native') return 'native';
  if (raw === '44100') return 44100;
  if (raw === '48000') return 48000;
  return null;
}

/** Omit `sampleRate` in AudioContextOptions when the user wants device native. */
export function toAudioContextSampleRate(pref: SampleRatePref): number | undefined {
  return pref === 'native' ? undefined : pref;
}

export function getStoredSampleRatePref(): SampleRatePref {
  try {
    const parsed = parseSampleRatePref(localStorage.getItem(SAMPLE_RATE_STORAGE_KEY));
    if (parsed) return parsed;
  } catch {
    /* localStorage unavailable */
  }
  return DEFAULT_SAMPLE_RATE_PREF;
}

export function setStoredSampleRatePref(pref: SampleRatePref): void {
  try {
    localStorage.setItem(SAMPLE_RATE_STORAGE_KEY, String(pref));
  } catch {
    /* localStorage unavailable */
  }
}

/**
 * Fallback rate for an export started before the live AudioContext exists
 * (or in a headless test): `native` has no meaning without a device, and
 * 44.1 kHz is what every export path used before #1233.
 */
export const DEFAULT_EXPORT_SAMPLE_RATE = 44100;

function isUsableSampleRate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Sample rate an offline render (freeze / stems / preview) must run at.
 *
 * This is the export half of #1136: a bounce is only honest if it is rendered
 * at the rate the user is monitoring at. `44100` / `48000` are taken verbatim;
 * `native` resolves to the rate the live `AudioContext` actually came up with
 * — which is *not* necessarily the rate that was requested, so callers pass
 * `context.sampleRate`, never their own guess.
 */
export function resolveExportSampleRate(
  pref: SampleRatePref = getStoredSampleRatePref(),
  liveSampleRate?: number | null,
): number {
  if (pref !== 'native') return pref;
  if (isUsableSampleRate(liveSampleRate)) return liveSampleRate;
  return DEFAULT_EXPORT_SAMPLE_RATE;
}
