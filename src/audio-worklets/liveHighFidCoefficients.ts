/**
 * liveHighFidCoefficients.ts — editable diode-ladder coefficients (Phase L3).
 *
 * Four extra `highfid303_set_param` ids on top of the Open303Param ids the
 * live voice already mirrors. They are implemented identically in
 * emscripten/highfid303_wrapper.cpp (live voice + native gates) and in the TS
 * port OfflineHighFid303Engine (freeze / export worker).
 *
 * The **canonical preset** reproduces the pre-L3 DSP bit for bit, so every
 * spectrogram / RMS gate keeps measuring the same voice. Gates must drive the
 * canonical preset explicitly (or nothing), never values taken from the UI.
 *
 * This file is imported by the AudioWorklet, so it must stay free of DOM and
 * main-thread-only APIs.
 */

export interface HighFidCoefficients {
  /** Pole spread between the four ladder stages (0 = matched transistors). */
  transistorMismatch: number;
  /** Filter-envelope shape (0 = plain exponential, 1 = snappy / concave). */
  decayCurve: number;
  /** Accent envelope → cutoff coupling. */
  accentCoupling: number;
  /** Keyboard follow of the cutoff (0 = none, 1 = full 1 V/oct). */
  filterTracking: number;
}

export type HighFidCoefficientKey = keyof HighFidCoefficients;

/** Stable order — also the slot order of the shared coefficient table. */
export const HIGHFID_COEFFICIENT_KEYS: readonly HighFidCoefficientKey[] = [
  'transistorMismatch',
  'decayCurve',
  'accentCoupling',
  'filterTracking',
];

/**
 * `highfid303_set_param` ids. 0–13 are taken by the Open303Param mirror
 * (HighFidParam in highfid303_wrapper.cpp); keep these two lists in sync.
 */
export const HIGHFID_COEFFICIENT_PARAM_IDS: Readonly<Record<HighFidCoefficientKey, number>> = {
  transistorMismatch: 14,
  decayCurve: 15,
  accentCoupling: 16,
  filterTracking: 17,
};

/**
 * The preset every quality gate uses. `accentCoupling` 0.45 is the constant
 * the diode ladder hard-coded before L3; the other three are "off".
 */
export const CANONICAL_HIGHFID_COEFFICIENTS: Readonly<HighFidCoefficients> = Object.freeze({
  transistorMismatch: 0,
  decayCurve: 0,
  accentCoupling: 0.45,
  filterTracking: 0,
});

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * Coerce a persisted / received blob into a full coefficient set.
 * Missing or non-finite slots take the canonical value; everything is clamped
 * to 0–1. Returns `undefined` for anything that is not an object, so callers
 * can tell "song stored nothing" apart from "song stored the canonical values".
 */
export function normalizeHighFidCoefficients(raw: unknown): HighFidCoefficients | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const source = raw as Partial<Record<HighFidCoefficientKey, unknown>>;
  const out = { ...CANONICAL_HIGHFID_COEFFICIENTS };
  for (const key of HIGHFID_COEFFICIENT_KEYS) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = clamp01(value);
  }
  return out;
}

export function isCanonicalHighFidCoefficients(coeffs: HighFidCoefficients | undefined): boolean {
  if (!coeffs) return true;
  return HIGHFID_COEFFICIENT_KEYS.every((key) => coeffs[key] === CANONICAL_HIGHFID_COEFFICIENTS[key]);
}

export function coefficientsToArray(coeffs: HighFidCoefficients): number[] {
  return HIGHFID_COEFFICIENT_KEYS.map((key) => coeffs[key]);
}

export function coefficientsFromArray(values: ArrayLike<number>): HighFidCoefficients | undefined {
  if (!values || values.length < HIGHFID_COEFFICIENT_KEYS.length) return undefined;
  const raw: Partial<Record<HighFidCoefficientKey, number>> = {};
  HIGHFID_COEFFICIENT_KEYS.forEach((key, i) => { raw[key] = values[i]; });
  return normalizeHighFidCoefficients(raw);
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared coefficient table
// ─────────────────────────────────────────────────────────────────────────────

/** Int32 generation counter, then one Float32 per coefficient. */
const TABLE_GENERATION_BYTES = 4;
export const HIGHFID_COEFFICIENT_TABLE_BYTES =
  TABLE_GENERATION_BYTES + HIGHFID_COEFFICIENT_KEYS.length * 4;

/**
 * A 20-byte SharedArrayBuffer the UI writes and the worklet polls once per
 * block, so a knob morphs the live diode ladder without a message per tick
 * and without reallocating the voice.
 *
 * It is deliberately separate from the hyphon_native heap: the heap is the
 * single imported memory budgeted in wasm_memory_budget.json, and a knob table
 * has no business growing it or living at an address the WASM allocator owns.
 *
 * The writer bumps the generation *after* storing the values; the reader
 * compares generations and only then reads, so a torn read can at worst apply
 * a half-updated set that the next block corrects.
 */
export class HighFidCoefficientTable {
  readonly buffer: SharedArrayBuffer;
  private readonly generation: Int32Array;
  private readonly values: Float32Array;
  private lastSeen = 0;

  constructor(buffer: SharedArrayBuffer) {
    if (buffer.byteLength < HIGHFID_COEFFICIENT_TABLE_BYTES) {
      throw new RangeError('HighFidCoefficientTable buffer too small');
    }
    this.buffer = buffer;
    this.generation = new Int32Array(buffer, 0, 1);
    this.values = new Float32Array(buffer, TABLE_GENERATION_BYTES, HIGHFID_COEFFICIENT_KEYS.length);
  }

  /**
   * Allocate a table, or `null` where SharedArrayBuffer cannot cross into the
   * worklet (no COOP/COEP) — the caller then falls back to `postMessage`.
   */
  static create(): HighFidCoefficientTable | null {
    const g = globalThis as { SharedArrayBuffer?: typeof SharedArrayBuffer; crossOriginIsolated?: boolean };
    if (typeof g.SharedArrayBuffer !== 'function' || g.crossOriginIsolated !== true) return null;
    try {
      return new HighFidCoefficientTable(new SharedArrayBuffer(HIGHFID_COEFFICIENT_TABLE_BYTES));
    } catch {
      return null;
    }
  }

  write(coeffs: HighFidCoefficients): void {
    HIGHFID_COEFFICIENT_KEYS.forEach((key, i) => { this.values[i] = coeffs[key]; });
    Atomics.add(this.generation, 0, 1);
  }

  /** The current values if the writer has published since the last call. */
  readIfChanged(): HighFidCoefficients | null {
    const gen = Atomics.load(this.generation, 0);
    if (gen === this.lastSeen) return null;
    this.lastSeen = gen;
    return coefficientsFromArray(this.values) ?? null;
  }
}
