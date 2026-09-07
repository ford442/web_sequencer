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
