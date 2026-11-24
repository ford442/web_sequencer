// User-facing engine fallback / degradation reporting. Never throws into audio paths.

import { engineDegradationStore } from '../../stores/engineDegradationStore';
import { engineTelemetry } from './collector';

/** Throttle user-visible fallback warnings — one per subsystem per interval. */
export const ENGINE_FALLBACK_WARN_THROTTLE_MS = 10_000;

const lastUserWarnAt = new Map<string, number>();
const activeFallbacks = new Map<string, { requestedBackend: string; reason: string }>();


export function getActiveEngineFallbacks(): ReadonlyMap<string, { requestedBackend: string; reason: string }> {
  return activeFallbacks;
}

export function clearEngineFallbackWarning(subsystem: string): void {
  activeFallbacks.delete(subsystem);
  lastUserWarnAt.delete(subsystem);
}

/**
 * Throttled, user-visible warning when a selected engine degrades to JS fallback.
 * Dispatches `hyphon-engine-fallback` on window for optional UI hooks.
 */
export function emitUserEngineFallbackWarning(
  subsystem: string,
  requestedBackend: string,
  reason: string,
): void {
  const now = Date.now();
  const last = lastUserWarnAt.get(subsystem) ?? 0;
  if (now - last < ENGINE_FALLBACK_WARN_THROTTLE_MS) return;
  lastUserWarnAt.set(subsystem, now);

  activeFallbacks.set(subsystem, { requestedBackend, reason });
  const message =
    `Hyphon: "${subsystem}" engine could not load (${reason}). ` +
    `Audio will use the basic JavaScript oscillator instead of "${requestedBackend}".`;

  console.warn(`[Hyphon Engine Warning] ${message}`);

  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(
        new CustomEvent('hyphon-engine-fallback', {
          detail: { subsystem, requestedBackend, reason, message },
        }),
      );
    } catch {
      /* DOM may be unavailable in tests */
    }
  }
}

/**
 * Report that a backend rendered a *different waveform family* than the one
 * requested (e.g. a triangle request serviced as a saw).
 *
 * This is the one degradation a user hears but cannot see, so it is never
 * allowed to be silent: console, telemetry resolution history and the
 * degradation store (which drives the banner and EngineHUD) all get it.
 */
export function logWaveformSubstitution(
  subsystem: string,
  backendId: string,
  requestedShape: string,
  substitutedShape: string,
  reason: string,
): void {
  const detail = `${backendId} cannot render "${requestedShape}", using "${substitutedShape}" (${reason})`;
  console.warn(`[WaveformSubstitution] ${subsystem}: ${detail}`);
  try {
    engineTelemetry.registerResolution(subsystem, `${backendId}:${substitutedShape}`, detail);
    engineTelemetry.recordDegradation(subsystem, true, detail);
    engineDegradationStore.report({
      id: `waveform-substitution-${subsystem}-${requestedShape}`,
      subsystem,
      category: 'audio',
      message: `"${requestedShape}" waveform is being played as "${substitutedShape}"`,
      reason: detail,
      status: 'active',
      activeBackend: `${backendId}:${substitutedShape}`,
      requestedBackend: `${backendId}:${requestedShape}`,
      retryable: false,
    });
  } catch {
    /* telemetry must never break audio */
  }
}

/**
 * One cell of the host-oscillator × filter-source cross-product as it sounds
 * (#1663): the oscillator family a part selected, the filter source it asked
 * for, the one that actually runs (the requested one, or "JS" after a fallback)
 * and the response. All four are display labels.
 */
export interface FilterPairing {
  /** The part's oscillator engine, e.g. "Rust OSC". */
  host: string;
  /** The filter source the part selected, e.g. "C++". */
  requested: string;
  /** The filter source shaping the sound now. */
  active: string;
  /** Filter response, e.g. "HP". */
  type: string;
  /**
   * The filter plays its own pre-filtered table instead of the host's samples
   * (the WebGPU / Pyodide table filters), so the host engine is not heard.
   */
  replacesHost?: boolean;
  /**
   * The requested source is still being made ready (a GPU bank baking, the
   * Python runtime loading) and `active` stands in with the same response: a
   * warm-up, not a degradation.
   */
  warming?: boolean;
  /** Why `requested` could not run, when `active` is a fallback. */
  fallbackReason?: string;
}

/** HUD subsystem key of one host × requested-source pairing, e.g. `filter: Rust OSC ← C++`. */
export function filterPairingSubsystem(host: string, requested: string): string {
  return `filter: ${host} ← ${requested}`;
}

/** Last published state of each pairing row, so a voice can report on every note without flooding history. */
const publishedPairings = new Map<string, string>();

/**
 * Publish which filter is shaping a part's sound, on the healthy path too, as
 * an EngineHUD row of its own per host × requested pairing (the badge names the
 * filter that runs). One row per pairing, not a single "filter" row, so two
 * parts on different sources do not overwrite each other on every note, and a
 * fallback is visible as a row whose badge is not the source in its name.
 * Only a change of the active source or response is published.
 */
export function reportFilterPairing(p: FilterPairing): void {
  const subsystem = filterPairingSubsystem(p.host, p.requested);
  const state = `${p.active}|${p.type}|${p.replacesHost ? 1 : 0}|${p.warming ? 1 : 0}|${p.fallbackReason ?? ''}`;
  if (publishedPairings.get(subsystem) === state) return;
  publishedPairings.set(subsystem, state);
  const reason = p.warming
    ? `${p.type} — ${p.requested} filter warming up, the ${p.active} filter stands in (same response)`
    : p.active !== p.requested
    ? `${p.type} — ${p.requested} filter unavailable, running on the ${p.active} filter${p.fallbackReason ? ` (${p.fallbackReason})` : ''}`
    : p.replacesHost
      ? `${p.type} — ${p.active} plays its own filtered table; ${p.host} is not heard`
      : `${p.type} — ${p.host} samples through the ${p.active} filter`;
  try {
    engineTelemetry.registerResolution(subsystem, p.active, reason);
  } catch {
    /* telemetry must never break audio */
  }
}

/** Test seam: forget which pairing states were already published. */
export function resetFilterPairingsForTests(): void {
  publishedPairings.clear();
}

/**
 * Report that a voice asked for a filter implementation it could not get and is
 * running a different one (#1663 / #1672 / #1673 / #1674: "WASM OSC", "Rust", "C++" or "DWGS" filter requested, native biquad
 * used). The sound changes (different filter), so like a waveform substitution
 * it is never silent: console, telemetry and the degradation store / EngineHUD.
 */
export function logFilterSourceFallback(
  requestedSource: string,
  activeSource: string,
  reason: string,
  /** One degradation entry per requested source (`filterSourceIssueId`); the legacy shared id by default. */
  issueId = 'filter-source',
): void {
  const detail = `filter source "${requestedSource}" unavailable, using "${activeSource}" (${reason})`;
  console.warn(`[FilterSourceFallback] ${detail}`);
  try {
    engineTelemetry.registerResolution('filter', activeSource, detail);
    engineTelemetry.recordDegradation('filter', true, detail);
    engineDegradationStore.report({
      id: issueId,
      subsystem: 'filter',
      category: 'wasm',
      message: `Filter running on the ${activeSource} filter instead of ${requestedSource}`,
      reason: detail,
      status: 'active',
      activeBackend: activeSource,
      requestedBackend: requestedSource,
      retryable: false,
    });
  } catch {
    /* telemetry must never break audio */
  }
}

/** A filter source that had fallen back runs again: the HUD's "filter" degradation is over. */
export function logFilterSourceRecovered(source: string): void {
  try {
    engineTelemetry.recordDegradation('filter', false, `${source} filter is running again`);
  } catch {
    /* telemetry must never break audio */
  }
}

/**
 * Loud fallback signal: always logs a concrete reason to the console and
 * records it in engineTelemetry before any JS-voice fallback is used.
 */
export function logEngineFallback(
  subsystem: string,
  requestedBackend: string,
  reason: string,
  err?: unknown,
): void {
  const errMsg =
    err instanceof Error ? err.message : err != null ? String(err) : undefined;
  const fullReason = errMsg ? `${reason}: ${errMsg}` : reason;
  console.error(
    `[EngineFallback] ${subsystem}: requested "${requestedBackend}" → JS fallback (${fullReason})`,
  );
  emitUserEngineFallbackWarning(subsystem, requestedBackend, fullReason);
  try {
    engineTelemetry.registerResolution(subsystem, 'fallback', fullReason);
    if (err != null) engineTelemetry.recordError(subsystem, err);
    engineDegradationStore.reportEngineFallback(subsystem, requestedBackend, fullReason);
  } catch {
    /* telemetry must never break audio init */
  }
}
