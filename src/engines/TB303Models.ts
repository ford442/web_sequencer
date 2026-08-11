/**
 * TB303Models.ts — the "303 Voices" registry.
 *
 * A TB-303 *model* (a.k.a. voice) is a named sound character built on top of
 * one of the two DSP engine families compiled into hyphon_native.wasm:
 *
 *  - 'open303' family — custom synthesizer (emscripten/open303_wrapper.cpp).
 *    Models in this family are coefficient profiles applied to the same DSP
 *    topology (filter curves, envelope ranges, accent punch, waveshaping).
 *  - 'jc303' family — authentic rosic::Open303 (emscripten/jc303_wrapper.cpp).
 *  - 'highfid' family — offline-only diode-ladder engines (highfid-cpu /
 *    gpu-highfid). Never routed to AudioWorklet; used for freeze / export /
 *    multisample (Phase-2+).
 *
 * This registry is mirrored by `k303Models[]` in emscripten/open303_wrapper.cpp
 * for open303-family coefficient profiles. High-fid engines live in separate
 * wrappers (`highfid303_wrapper.cpp` / WGSL) and are catalogued here only.
 *
 * Adding a new voice:
 *   1. Add a profile row to `k303Models[]` in open303_wrapper.cpp and rebuild
 *      the WASM (`pnpm run build:emcc`) — open303-family only.
 *   2. Add a matching entry here with `available: true`.
 * Every call site (UI selector, worklet routing, song load/save) picks the new
 * voice up from this list — no other changes required.
 *
 * Backward compatibility: songs saved before the voices architecture carry an
 * `engine303: 'open303' | 'jc303'` field. `normalizeTB303Model()` maps those
 * (and any unknown/future ids) onto a valid model id, so legacy songs load
 * with the exact stock sound they were saved with.
 */

import { engineTelemetry } from '../utils/engineTelemetry';
import { engineDegradationStore } from '../stores/engineDegradationStore';

/** Which WASM API family a model is built on. Matches the legacy Engine303 type (+ highfid). */
export type Engine303Family = 'open303' | 'jc303' | 'highfid';

/** Legacy persisted mirror — only open303 | jc303 (older song readers). */
export type LegacyEngine303 = 'open303' | 'jc303';

export type TB303ModelId =
  | 'stock-open303'
  | 'jc303'
  | 'rebirth-338-1.5'
  | 'rebirth-2.0'
  | 'mb33-mkii'
  | 'raveolution'
  | '1ink303-v1'        // in-house
  | 'experimental-01'  // scratchpad
  | 'highfid-cpu'      // Phase-2 offline diode-ladder reference
  | 'gpu-highfid';     // Phase-3 WGSL offline authenticity tier

/** Catalog ids plus WASM-discovered voice strings from future builds. */
export type TB303Model = TB303ModelId | (string & {});

/** Default persisted 303 voice fields for new patterns and RBS imports. */
export const DEFAULT_TB303_VOICE_FIELDS = {
  model303: 'stock-open303' as const,
  engine303: 'open303' as const,
};

export interface TB303ModelInfo {
  id: TB303ModelId;
  /** Full human-readable name (tooltip / docs). */
  label: string;
  /** Short label for tight UI (selector buttons). */
  shortLabel: string;
  /** One-line character description shown as a tooltip. */
  description: string;
  /** DSP engine family the model runs on. */
  family: Engine303Family;
  /**
   * Whether the DSP profile for this model has shipped in hyphon_native.wasm.
   * Catalogued-but-unavailable models are hidden from the UI selector and
   * normalize to the stock model of their family when loaded from a song.
   */
  available: boolean;
  /**
   * When true, the voice is intended for offline / freeze / export only
   * (Phase-2 highfid-cpu, Phase-3 gpu-highfid). Excluded from the real-time
   * Voice303Selector.
   * (Phase-2 highfid-cpu, Phase-3 gpu-highfid). Realtime AudioWorklet falls
   * back via `resolveRealtimeTB303Model`; offline renderers use the id as-is.
   */
  offlineOnly?: boolean;
}

/**
 * The 303 voice catalog, in display order. Stock voices first.
 * Keep ids stable forever — they are persisted in saved songs.
 */
export const TB303_MODELS: readonly TB303ModelInfo[] = [
  {
    id: 'stock-open303',
    label: 'Stock Open303',
    shortLabel: 'Stock 303',
    description: 'Built-in custom Open303 synthesizer — the pristine default voice.',
    family: 'open303',
    available: true,
  },
  {
    id: 'jc303',
    label: 'Authentic JC303',
    shortLabel: 'JC303',
    description: 'Authentic rosic::Open303 DSP from the jc303_wasm submodule — accurate TB-303 behaviour.',
    family: 'jc303',
    available: true,
  },
  {
    id: '1ink303-v1',
    label: '1ink303 v1',
    shortLabel: '1ink v1',
    description: 'In-house voice — warmer filter base, rounder accent, slower slides.',
    family: 'open303',
    available: true,
  },
  {
    id: 'experimental-01',
    label: 'Experimental 01',
    shortLabel: 'Exp 01',
    description: 'Scratchpad voice — hotter resonance feedback, snappier envelope, harder accent punch.',
    family: 'open303',
    available: true,
  },
  {
    id: 'rebirth-338-1.5',
    label: 'ReBirth RB-338 1.5',
    shortLabel: 'RB-338 1.5',
    description: 'Inspired by ReBirth RB-338 1.5 (not a clone) — squishier, self-oscillation-prone filter, gooey slides, big accent lift.',
    family: 'open303',
    available: true,
  },
  {
    id: 'rebirth-2.0',
    label: 'ReBirth 2.0',
    shortLabel: 'RB 2.0',
    description: 'Inspired by ReBirth 2.0 (not a clone) — cleaner/tighter filter than 1.5, punchier accent, snappier envelope.',
    family: 'open303',
    available: true,
  },
  {
    id: 'mb33-mkii',
    label: 'MB33 mkII',
    shortLabel: 'MB33',
    description: 'Inspired by MAM MB33 mkII (not a clone) — boxier digital filter feel, distinct accent punch, square/saw grit.',
    family: 'open303',
    available: true,
  },
  {
    id: 'raveolution',
    label: 'Raveolution 309',
    shortLabel: 'Rave 309',
    description: 'Inspired by Quasimidi Raveolution 309 (not a clone) — brighter harsh self-osc, aggressive resonance, snappy envelope, heavy drive.',
    family: 'open303',
    available: true,
  },
  {
    id: 'highfid-cpu',
    label: 'High-Fidelity CPU (offline)',
    shortLabel: 'HiFi CPU',
    description:
      'Offline only — best for freeze / export / multisample. Diode-ladder CPU reference (Phase-2). Live playback uses Stock Open303.',
    family: 'highfid',
    available: true,
    offlineOnly: true,
  },
  {
    id: 'gpu-highfid',
    label: 'GPU High-Fidelity (offline)',
    shortLabel: 'HiFi GPU',
    description:
      'Offline only — best for freeze / export / multisample. WGSL diode-ladder (Phase-3); falls back to High-Fidelity CPU when WebGPU is unavailable. Live playback uses Stock Open303.',
    family: 'highfid',
    available: true,
    offlineOnly: true,
  },
];

const MODEL_BY_ID: ReadonlyMap<string, TB303ModelInfo> = new Map(
  TB303_MODELS.map((m) => [m.id, m]),
);

/** Look up a model entry by id. Returns undefined for unknown ids. */
export function getTB303Model(id: string | undefined): TB303ModelInfo | undefined {
  return id ? MODEL_BY_ID.get(id) : undefined;
}

export function isOfflineOnlyTB303Model(id: string | undefined): boolean {
  return !!getTB303Model(id)?.offlineOnly;
}

/**
 * Models selectable in the UI (DSP profile shipped).
 * By default excludes `offlineOnly` voices (highfid-cpu, gpu-highfid) so the
 * real-time selector stays latency-safe. Pass `{ includeOfflineOnly: true }`
 * for freeze / export / offline renderer UIs (Phase-4).
 * By default excludes `offlineOnly` voices so callers that only drive the
 * AudioWorklet stay latency-safe. Pass `{ includeOfflineOnly: true }` for the
 * voice selector / freeze / export UIs (Phase-4).
 */
export function getAvailableTB303Models(opts?: {
  includeOfflineOnly?: boolean;
}): TB303ModelInfo[] {
  return TB303_MODELS.filter(
    (m) => m.available && (opts?.includeOfflineOnly || !m.offlineOnly),
  );
}

/** The engine family a model runs on ('open303' for anything unknown). */
export function tb303ModelFamily(id: string | undefined): Engine303Family {
  return getTB303Model(id)?.family ?? 'open303';
}

/**
 * Legacy `engine303` mirror for song save. High-fid voices map to `open303`
 * so older builds still load a valid realtime engine field.
 */
export function legacyEngine303ForModel(id: string | undefined): LegacyEngine303 {
  return tb303ModelFamily(id) === 'jc303' ? 'jc303' : 'open303';
}

/** Stock (default) model id for an engine family. */
export function stockModelForFamily(family: Engine303Family): TB303ModelId {
  if (family === 'jc303') return 'jc303';
  if (family === 'highfid') return 'highfid-cpu';
  return 'stock-open303';
}

/**
 * Report when a requested 303 voice could not be used as-is (HUD + console).
 * Call sites pass a stable subsystem id (e.g. `synthA-model303`).
 */
export function reportTB303ModelFallback(
  requested: string,
  resolved: TB303ModelId,
  reason: string,
  subsystem = 'tb303-model',
): void {
  const msg = `[TB303] Model "${requested}" unavailable (${reason}) — using "${resolved}"`;
  console.warn(msg);
  try {
    engineTelemetry.registerResolution(subsystem, resolved, `${requested}: ${reason}`);
  } catch {
    /* telemetry optional */
  }
}

/**
 * Resolve a persisted model/engine pair to a valid, available model id.
 *
 *  - A known, available `model303` wins (including offline-only high-fid ids).
 *  - A known-but-unavailable model falls back to its family's stock voice.
 *  - Otherwise the legacy `engine303` field decides ('jc303' → 'jc303').
 *  - Default: 'stock-open303'.
 *
 * Offline-only ids are preserved for persistence / UI / offline render.
 * Use `resolveRealtimeTB303Model` before posting to AudioWorklet.
 *
 * When `reportFallback` is true and the resolved id differs from the requested
 * string, `reportTB303ModelFallback` is invoked (song load / runtime apply).
 */
export function normalizeTB303Model(
  model303?: string,
  engine303?: string,
  options?: { reportFallback?: boolean; subsystem?: string },
): TB303ModelId {
  const requested = model303?.trim();
  const model = getTB303Model(requested);
  if (model) {
    let resolved = model.available ? model.id : stockModelForFamily(model.family);

    // In environments without WebGPU, 'gpu-highfid' must fallback to stock.
    // The previous implementation fell back to 'highfid-cpu' during offline resolution,
    // but normalizeTB303Model must also correctly reject offline-only ids if they aren't fully supported.
    if (resolved === 'gpu-highfid' && !detectWebGpuAvailable()) {
      resolved = 'stock-open303';
    }

    if (options?.reportFallback && requested && resolved !== requested) {
      reportTB303ModelFallback(requested, resolved, 'catalogued but not shipped/supported', options.subsystem);
    }
    return resolved;
  }
  const resolved = engine303 === 'jc303' ? 'jc303' : 'stock-open303';
  if (options?.reportFallback && requested && resolved !== requested) {
    reportTB303ModelFallback(requested, resolved, 'unknown id', options.subsystem);
  }
  return resolved;
}

/**
 * Map a (possibly offline-only) model to one safe for AudioWorklet routing.
 * Offline high-fid voices → stock-open303 so realtime latency is unchanged.
 */
export function resolveRealtimeTB303Model(
  model303?: string,
  engine303?: string,
  options?: { reportFallback?: boolean; subsystem?: string },
): TB303ModelId {
  const normalized = normalizeTB303Model(model303, engine303);
  const info = getTB303Model(normalized);
  if (info?.offlineOnly) {
    const resolved: TB303ModelId = 'stock-open303';
    if (options?.reportFallback !== false) {
      reportTB303ModelFallback(
        normalized,
        resolved,
        'offline-only high-fid voice (realtime uses stock)',
        options?.subsystem ?? 'tb303-realtime',
      );
    }
    return resolved;
  }
  return normalized;
}

export type HighFidOfflineEngine = 'gpu-highfid' | 'highfid-cpu' | 'stock-open303';

export interface HighFidModelSelection {
  /** User / song requested id (after normalize). */
  requested: TB303ModelId;
  /** Id to persist in SynthParams.model303. */
  persisted: TB303ModelId;
  /** Id for AudioWorklet (never offline-only). */
  realtime: TB303ModelId;
  /** Effective offline render engine after capability checks. */
  offlineEngine: HighFidOfflineEngine;
  /** Why offlineEngine differs from a GPU request (null if no degradation). */
  fallbackReason: string | null;
  gpuAvailable: boolean;
}

function detectWebGpuAvailable(): boolean {
  try {
    return typeof navigator !== 'undefined' && !!(navigator as Navigator & { gpu?: unknown }).gpu;
  } catch {
    return false;
  }
}

/**
 * Central factory for high-fid / general model selection + fallback.
 *
 * Choosing `gpu-highfid` without WebGPU → offline path uses `highfid-cpu`
 * (persisted id stays `gpu-highfid` so songs round-trip). Realtime always
 * uses stock for offline-only voices.
 */
export function resolveHighFidModelSelection(
  model303?: string,
  engine303?: string,
  options?: {
    gpuAvailable?: boolean;
    report?: boolean;
    subsystem?: string;
  },
): HighFidModelSelection {
  const requested = normalizeTB303Model(model303, engine303);
  const gpuAvailable = options?.gpuAvailable ?? detectWebGpuAvailable();
  const realtime = resolveRealtimeTB303Model(requested, engine303, {
    reportFallback: false,
    subsystem: options?.subsystem,
  });

  let offlineEngine: HighFidOfflineEngine = 'stock-open303';
  let fallbackReason: string | null = null;

  if (requested === 'gpu-highfid') {
    if (gpuAvailable) {
      offlineEngine = 'gpu-highfid';
    } else {
      offlineEngine = 'highfid-cpu';
      fallbackReason = 'WebGPU unavailable — using High-Fidelity CPU for offline render';
    }
  } else if (requested === 'highfid-cpu') {
    offlineEngine = 'highfid-cpu';
  }
  // Non-highfid models: offlineEngine stays stock-open303 as a sentinel;
  // OfflineRenderer still uses the persisted model id for open303/jc303 paths.

  const selection: HighFidModelSelection = {
    requested,
    persisted: requested,
    realtime,
    offlineEngine,
    fallbackReason,
    gpuAvailable,
  };

  if (options?.report !== false) {
    try {
      engineTelemetry.recordHighFidSelection({
        requested: selection.requested,
        activeOffline: selection.offlineEngine,
        realtime: selection.realtime,
        gpuAvailable: selection.gpuAvailable,
        fallbackReason: selection.fallbackReason,
      });
      if (selection.fallbackReason) {
        engineDegradationStore.reportHighFidFallback({
          requested: selection.requested,
          active: selection.offlineEngine,
          reason: selection.fallbackReason,
          gpuAvailable: selection.gpuAvailable,
        });
        reportTB303ModelFallback(
          selection.requested,
          selection.offlineEngine === 'highfid-cpu' ? 'highfid-cpu' : selection.realtime,
          selection.fallbackReason,
          options?.subsystem ?? 'gpu-highfid',
        );
      } else if (selection.requested === 'gpu-highfid' || selection.requested === 'highfid-cpu') {
        engineDegradationStore.resolve('gpu-highfid-selection');
      }
    } catch {
      /* telemetry optional */
    }
  }

  return selection;
}
