/**
 * Contract shared by the "DWGS filter" worklet (`dwgs-filter-processor.ts`) and
 * its main-thread bridge (`src/engines/DwgsFilter.ts`), #1674.
 *
 * The DSP is the `dflt_*` half of dwgs-audio/src/lib.rs — a resonant LP / BP /
 * HP 4-pole ladder with saturated feedback, modelled on the analog 24 dB/oct
 * filter the DW-6000 / DW-8000 put after their digital waves — in the *same*
 * `public/dwgs_osc.wasm` the `dwgs-*` oscillator runs from (one build, one
 * artifact, one release gate). A filter node is just another instance of that
 * module that never calls `dwgs_init` / `dwgs_render`: one per synth voice that
 * selected `filterSource: 'dwgs'`, whatever oscillator engine feeds it.
 *
 * Unlike the WASM OSC, Rust and C++ filters (which share one response), this
 * one is meant to sound different: 24 dB/oct slopes, a ladder's resonance, and
 * soft saturation in the loop.
 *
 * Imported on both sides of the port: types, constants and pure functions only.
 */

import { DWGS_OSC_ABI_VERSION } from './dwgsOsc';
import {
    clampFilterTypeId,
    filterSettingsChanged,
    type WamFilterSettings,
} from './wamFilter';

export { clampFilterTypeId, filterSettingsChanged };

export const DWGS_FILTER_PROCESSOR = 'dwgs-filter-processor';

/** The module's ABI version: the filter shares `dwgs_osc.wasm` with the oscillator (tools/check_dwgs_osc_module.mjs). */
export const DWGS_FILTER_ABI_VERSION = DWGS_OSC_ABI_VERSION;

/** Restated, not imported from `src/types/synth.ts` (DOM-typed graph; see dwgsOsc.ts). */
export type DwgsFilterType = 'lp' | 'bp' | 'hp';

/** Kernel response ids (`FILTER_*` in dwgs-audio/src/lib.rs) — the same numbering as the other kernels. */
export const DWGS_FILTER_TYPE_ID: Record<DwgsFilterType, number> = { lp: 0, bp: 1, hp: 2 };

/** The `dwgsOsc.requiredFilter` exports of emscripten/wasm_export_manifest.json, plus what the worklet needs of the oscillator half. */
export interface DwgsFilterExports {
    memory: WebAssembly.Memory;
    dwgs_abi_version(): number;
    dwgs_max_frames(): number;
    dflt_buf_ptr(): number;
    dflt_configure(sampleRate: number, cutoff: number, resonance: number, type: number): number;
    dflt_reset(): void;
    dflt_process(frames: number): number;
}

/** `dwgsOsc.requiredFilter` in emscripten/wasm_export_manifest.json. */
export const DWGS_FILTER_REQUIRED_EXPORTS = [
    'dflt_buf_ptr',
    'dflt_configure',
    'dflt_reset',
    'dflt_process',
] as const satisfies readonly (keyof DwgsFilterExports)[];

/** Exports the worklet calls besides the filter's own (module identity + capacity). */
const DWGS_FILTER_SHARED_EXPORTS = ['dwgs_abi_version', 'dwgs_max_frames'] as const;

/** AudioParams of the node (`parameterDescriptors`), all k-rate. Same names as the other filter stages. */
export const DWGS_FILTER_PARAMS = {
    /** Hz. */
    cutoff: 'cutoff',
    /** Q (1/√2 = no resonance; the ladder's feedback rises above it). */
    resonance: 'resonance',
    /** `DWGS_FILTER_TYPE_ID`. */
    type: 'type',
} as const;

export interface DwgsFilterProcessorOptions {
    module: WebAssembly.Module;
}

export type DwgsFilterOutMessage =
    | { type: 'ready'; maxFrames: number }
    | { type: 'error'; reason: string };

export type DwgsFilterInMessage = { type: 'dispose' };

export function hasDwgsFilterApi(exports: unknown): exports is DwgsFilterExports {
    if (!exports || typeof exports !== 'object') return false;
    const x = exports as Record<string, unknown>;
    return x.memory instanceof WebAssembly.Memory
        && [...DWGS_FILTER_SHARED_EXPORTS, ...DWGS_FILTER_REQUIRED_EXPORTS]
            .every((name) => typeof x[name] === 'function');
}

/**
 * Instantiate `module` (no imports) as a filter: check the ABI, but do NOT
 * `dwgs_init` — a filter never renders, so it never evaluates the recipes.
 * Throws with a reason the caller reports.
 */
export function instantiateDwgsFilter(module: WebAssembly.Module): DwgsFilterExports {
    const exports = new WebAssembly.Instance(module, {}).exports;
    if (!hasDwgsFilterApi(exports)) throw new Error('dwgs_osc.wasm is missing dflt_* exports');
    const abi = exports.dwgs_abi_version();
    if (abi !== DWGS_FILTER_ABI_VERSION) {
        throw new Error(`dwgs_osc.wasm ABI ${abi}, worklet expects ${DWGS_FILTER_ABI_VERSION}`);
    }
    return exports;
}

export type DwgsFilterSettings = WamFilterSettings;
