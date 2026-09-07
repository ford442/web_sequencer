/**
 * liveHighFid303.ts — real-time glue for the diode-ladder high-fid 303
 * (Phase L1 of the post-#972 authenticity work).
 *
 * The same `highfid303_*` C API that powers the offline `highfid-cpu`
 * reference (emscripten/highfid303_wrapper.cpp) is driven here from inside
 * `open303-processor`, at oversample 1 by default, so producers can hear the
 * diode ladder while the sequencer runs instead of only after a freeze.
 *
 * Two rules shape this module:
 *
 *  1. **Stock voices must not pay for it.** The WASM instance is created
 *     lazily, the first time a track actually selects the live high-fid voice.
 *     A session that never touches it allocates nothing and runs the exact
 *     same code path as before (epic #972 principle #1).
 *  2. **It yields rather than glitches.** `LiveHighFidGuard` watches
 *     `process()` wall time against the quantum budget and asks the processor
 *     to fall back to Stock Open303 when the diode ladder cannot keep up, so a
 *     slow machine degrades to a clean stock voice instead of underrunning.
 *
 * The exports are `optional` in emscripten/wasm_export_manifest.json — a build
 * that pruned them simply reports "unsupported" and the caller falls back.
 */

/** Realtime-safe catalog id for the live diode-ladder voice. */
export const LIVE_HIGHFID_MODEL_ID = 'live-highfid';

/** Handle/pointer coercion supplied by the processor (WASM_BIGINT builds). */
export type WasmHandleFn = (h: number | bigint) => number | bigint;

/** Subset of hyphon_native exports the live high-fid voice needs. */
export interface LiveHighFidExports {
  highfid303_create?: () => number | bigint;
  highfid303_destroy?: (h: number | bigint) => void;
  highfid303_init?: (h: number | bigint, sampleRate: number, bufferSize: number) => number;
  highfid303_note_on?: (h: number | bigint, note: number, velocity: number) => void;
  highfid303_note_off?: (h: number | bigint, note: number) => void;
  highfid303_all_notes_off?: (h: number | bigint) => void;
  highfid303_set_param?: (h: number | bigint, paramId: number, value: number) => void;
  highfid303_set_oversample?: (h: number | bigint, factor: number) => void;
  highfid303_process?: (h: number | bigint, outPtr: number | bigint, numFrames: number) => void;
}

/** Oversample factors the C wrapper accepts. Live default is 1. */
export type LiveHighFidOversample = 1 | 2;

export function clampLiveOversample(value: unknown): LiveHighFidOversample {
  return value === 2 ? 2 : 1;
}

/** True when the loaded WASM exposes the full realtime high-fid surface. */
export function supportsLiveHighFid(exports: LiveHighFidExports | null | undefined): boolean {
  if (!exports) return false;
  return (
    typeof exports.highfid303_create === 'function' &&
    typeof exports.highfid303_init === 'function' &&
    typeof exports.highfid303_process === 'function' &&
    typeof exports.highfid303_note_on === 'function' &&
    typeof exports.highfid303_set_param === 'function'
  );
}

/**
 * One live diode-ladder voice. Owns only the WASM instance handle — the output
 * buffer stays owned by the processor and is shared with the other engines.
 */
export class LiveHighFid303Voice {
  private handle: number | bigint = 0;
  private readonly exports: LiveHighFidExports;
  private readonly toHandle: WasmHandleFn;
  private oversample: LiveHighFidOversample = 1;

  constructor(exports: LiveHighFidExports, toHandle: WasmHandleFn) {
    this.exports = exports;
    this.toHandle = toHandle;
  }

  get isReady(): boolean {
    return !this.isInvalid(this.handle);
  }

  get activeOversample(): LiveHighFidOversample {
    return this.oversample;
  }

  private isInvalid(h: number | bigint): boolean {
    return typeof h === 'bigint' ? h <= 0n : !Number.isFinite(h) || h <= 0;
  }

  /** Create + init the WASM instance. Returns false if unavailable/failed. */
  init(sampleRate: number, bufferFrames: number, oversample: LiveHighFidOversample = 1): boolean {
    if (this.isReady) return true;
    if (!supportsLiveHighFid(this.exports)) return false;
    try {
      const handle = this.exports.highfid303_create!();
      if (this.isInvalid(handle)) return false;
      const ok = this.exports.highfid303_init!(this.toHandle(handle), sampleRate, bufferFrames);
      if (ok !== 1) {
        this.exports.highfid303_destroy?.(this.toHandle(handle));
        return false;
      }
      this.handle = handle;
      this.setOversample(oversample);
      return true;
    } catch {
      this.handle = 0;
      return false;
    }
  }

  setOversample(factor: LiveHighFidOversample): void {
    this.oversample = clampLiveOversample(factor);
    if (!this.isReady) return;
    try {
      this.exports.highfid303_set_oversample?.(this.toHandle(this.handle), this.oversample);
    } catch {
      /* leave the previous factor in place */
    }
  }

  setParam(paramId: number, value: number): void {
    if (!this.isReady) return;
    this.exports.highfid303_set_param?.(this.toHandle(this.handle), paramId, value);
  }

  noteOn(note: number, velocity: number): void {
    if (!this.isReady) return;
    this.exports.highfid303_note_on?.(this.toHandle(this.handle), note, velocity);
  }

  noteOff(note: number): void {
    if (!this.isReady) return;
    this.exports.highfid303_note_off?.(this.toHandle(this.handle), note);
  }

  allNotesOff(): void {
    if (!this.isReady) return;
    this.exports.highfid303_all_notes_off?.(this.toHandle(this.handle));
  }

  /** Render `numFrames` into the processor-owned heap buffer at `outPtr`. */
  process(outPtr: number | bigint, numFrames: number): void {
    if (!this.isReady) return;
    this.exports.highfid303_process?.(this.toHandle(this.handle), this.toHandle(outPtr), numFrames);
  }

  destroy(): void {
    if (!this.isReady) return;
    try {
      this.exports.highfid303_destroy?.(this.toHandle(this.handle));
    } catch {
      /* teardown is best-effort */
    }
    this.handle = 0;
  }
}

export interface LiveHighFidGuardOptions {
  /** Share of one quantum the voice may use before it counts as over budget. */
  cpuBudgetPercent?: number;
  /** Consecutive over-budget blocks that trigger the fallback. */
  sustainedBlocks?: number;
  /** Underruns tolerated inside `underrunWindowBlocks` before falling back. */
  underrunLimit?: number;
  underrunWindowBlocks?: number;
  /** Blocks ignored after (re)activation, covering JIT / cache warm-up. */
  warmupBlocks?: number;
}

export interface LiveHighFidGuardVerdict {
  /** Fall back to the stock voice now. */
  degrade: boolean;
  reason: string | null;
  /** Rolling CPU share of the quantum budget (0–100). */
  cpuPercent: number;
  underruns: number;
}

/**
 * CPU-meter / glitch gate for the live high-fid voice.
 *
 * Degrades on either of two signals, both measured on the audio thread:
 *   - sustained CPU: `sustainedBlocks` consecutive blocks above the budget;
 *   - underruns: `underrunLimit` blocks that overran the quantum outright
 *     inside a rolling `underrunWindowBlocks` window.
 *
 * The rolling CPU figure is an EMA so a single scheduling hiccup cannot flip a
 * healthy voice, while a genuinely too-slow machine trips within ~60 ms.
 */
export class LiveHighFidGuard {
  private readonly cpuBudgetPercent: number;
  private readonly sustainedBlocks: number;
  private readonly underrunLimit: number;
  private readonly underrunWindowBlocks: number;
  private readonly warmupBlocks: number;

  private emaPercent = 0;
  private overBudgetRun = 0;
  private blocksSeen = 0;
  private windowBlocks = 0;
  private windowUnderruns = 0;
  private totalUnderruns = 0;
  private tripped = false;

  private static readonly EMA_ALPHA = 0.2;

  constructor(options: LiveHighFidGuardOptions = {}) {
    this.cpuBudgetPercent = options.cpuBudgetPercent ?? 60;
    this.sustainedBlocks = options.sustainedBlocks ?? 24;
    this.underrunLimit = options.underrunLimit ?? 8;
    this.underrunWindowBlocks = options.underrunWindowBlocks ?? 200;
    this.warmupBlocks = options.warmupBlocks ?? 32;
  }

  /** Clear all history — call when the voice is (re)activated. */
  reset(): void {
    this.emaPercent = 0;
    this.overBudgetRun = 0;
    this.blocksSeen = 0;
    this.windowBlocks = 0;
    this.windowUnderruns = 0;
    this.totalUnderruns = 0;
    this.tripped = false;
  }

  get cpuPercent(): number {
    return this.emaPercent;
  }

  get underruns(): number {
    return this.totalUnderruns;
  }

  /** Feed one rendered block. Returns whether the voice must step down. */
  record(processUs: number, quantumUs: number): LiveHighFidGuardVerdict {
    if (!(quantumUs > 0) || !Number.isFinite(processUs)) {
      return { degrade: false, reason: null, cpuPercent: this.emaPercent, underruns: this.totalUnderruns };
    }

    const percent = Math.min(400, (processUs / quantumUs) * 100);
    this.emaPercent =
      this.blocksSeen === 0
        ? percent
        : this.emaPercent + LiveHighFidGuard.EMA_ALPHA * (percent - this.emaPercent);
    this.blocksSeen += 1;

    if (percent >= 100) {
      this.windowUnderruns += 1;
      this.totalUnderruns += 1;
    }
    this.windowBlocks += 1;
    if (this.windowBlocks >= this.underrunWindowBlocks) {
      this.windowBlocks = 0;
      this.windowUnderruns = 0;
    }

    this.overBudgetRun = this.emaPercent >= this.cpuBudgetPercent ? this.overBudgetRun + 1 : 0;

    if (this.tripped || this.blocksSeen <= this.warmupBlocks) {
      return { degrade: false, reason: null, cpuPercent: this.emaPercent, underruns: this.totalUnderruns };
    }

    let reason: string | null = null;
    if (this.windowUnderruns >= this.underrunLimit) {
      reason = `${this.windowUnderruns} audio underruns in ${this.underrunWindowBlocks} blocks`;
    } else if (this.overBudgetRun >= this.sustainedBlocks) {
      reason =
        `live high-fid used ${this.emaPercent.toFixed(0)}% of the quantum budget ` +
        `for ${this.overBudgetRun} blocks (limit ${this.cpuBudgetPercent}%)`;
    }

    if (reason) this.tripped = true;
    return {
      degrade: reason !== null,
      reason,
      cpuPercent: this.emaPercent,
      underruns: this.totalUnderruns,
    };
  }
}
