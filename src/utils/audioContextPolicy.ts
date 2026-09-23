// User-selectable live AudioContext sample-rate policy (#1136 / remaining #1033).
// Persisted so the choice survives reloads; takes effect on the next
// AudioContext construction (engine start or HUD re-init, same as latency mode).

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
let lastLiveSampleRate: number | null = null;

/**
 * Record the rate the live AudioContext actually came up with. Called by the
 * context factory on every construction (including HUD re-init), so offline
 * renders resolving `native` follow the device the user is monitoring on
 * even when their caller has no context handle to pass.
 */
export function recordLiveSampleRate(rate: number | null): void {
  lastLiveSampleRate = isUsableSampleRate(rate) ? rate : null;
}

/** `AudioContext.sampleRate` of the most recent live context, or null. */
export function getLastLiveSampleRate(): number | null {
  return lastLiveSampleRate;
}

export function resolveExportSampleRate(
  pref: SampleRatePref = getStoredSampleRatePref(),
  liveSampleRate: number | null | undefined = getLastLiveSampleRate(),
): number {
  if (pref !== 'native') return pref;
  if (isUsableSampleRate(liveSampleRate)) return liveSampleRate;
  return DEFAULT_EXPORT_SAMPLE_RATE;
}

// ── Render quantum size (renderSizeHint, Web Audio 1.1 / Chrome 125+) ────────
// Persisted next to the latency hint. `default` omits the option entirely, so
// browsers without the field build the context exactly as before. The value is
// a *hint*: the quantum the browser actually picked is read back from the
// context (`renderQuantumSize`) and recorded — never assume 128.

export type RenderSizeHintPref = 'default' | 'hardware' | 128 | 256;

export const RENDER_SIZE_HINT_PREFS: readonly RenderSizeHintPref[] = ['default', 'hardware', 128, 256];

export const DEFAULT_RENDER_SIZE_HINT_PREF: RenderSizeHintPref = 'default';

export const RENDER_SIZE_HINT_STORAGE_KEY = 'hyphon.audioRenderSizeHint';

export function parseRenderSizeHintPref(raw: string | null): RenderSizeHintPref | null {
  if (raw === 'default' || raw === 'hardware') return raw;
  if (raw === '128') return 128;
  if (raw === '256') return 256;
  return null;
}

export function getStoredRenderSizeHintPref(): RenderSizeHintPref {
  try {
    const parsed = parseRenderSizeHintPref(localStorage.getItem(RENDER_SIZE_HINT_STORAGE_KEY));
    if (parsed) return parsed;
  } catch {
    /* localStorage unavailable */
  }
  return DEFAULT_RENDER_SIZE_HINT_PREF;
}

export function setStoredRenderSizeHintPref(pref: RenderSizeHintPref): void {
  try {
    localStorage.setItem(RENDER_SIZE_HINT_STORAGE_KEY, String(pref));
  } catch {
    /* localStorage unavailable */
  }
}

/** Omit `renderSizeHint` in AudioContextOptions for the browser default. */
export function toAudioContextRenderSizeHint(pref: RenderSizeHintPref): 'hardware' | number | undefined {
  return pref === 'default' ? undefined : pref;
}

/**
 * Whether this browser understands `renderSizeHint`. Engines that do expose
 * the negotiated quantum as `AudioContext.prototype.renderQuantumSize`; an
 * older engine silently drops unknown dictionary members, so without this
 * check a requested 256 would be reported as honoured when it never was.
 */
export function supportsRenderSizeHint(
  ctor: { prototype: object } | undefined = typeof AudioContext !== 'undefined' ? AudioContext : undefined,
): boolean {
  try {
    return !!ctor && 'renderQuantumSize' in ctor.prototype;
  } catch {
    return false;
  }
}

/** Render quantum the live context actually runs at, or null if unexposed. */
export function readRenderQuantumSize(context: BaseAudioContext): number | null {
  const size = (context as BaseAudioContext & { renderQuantumSize?: unknown }).renderQuantumSize;
  return typeof size === 'number' && Number.isFinite(size) && size > 0 ? size : null;
}
