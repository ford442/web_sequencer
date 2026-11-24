/**
 * Contract shared by the "Rust filter" worklet (`rust-filter-processor.ts`) and
 * its main-thread bridge (`src/engines/RustFilter.ts`), #1672.
 *
 * The DSP is the `rflt_*` half of rust-audio/src/lib.rs — a resonant LP / BP /
 * HP RBJ biquad — in the *same* `public/rust_osc.wasm` the `rust-*` oscillator
 * runs from (one build, one artifact, one release gate). A filter node is just
 * another instance of that module that never calls `rosc_render`: one per synth
 * voice that selected `filterSource: 'rust'`, whatever oscillator engine feeds it.
 *
 * Imported on both sides of the port: types, constants and pure functions only.
 */

import {
    clampFilterTypeId,
    filterSettingsChanged,
    type WamFilterSettings,
} from './wamFilter';

export { clampFilterTypeId, filterSettingsChanged };

export const RUST_FILTER_PROCESSOR = 'rust-filter-processor';

/** The module's ABI version: the filter shares `rust_osc.wasm` with the oscillator (tools/check_rust_osc_module.mjs). */
export const RUST_FILTER_ABI_VERSION = 2;

/** Restated, not imported from `src/types/synth.ts` (DOM-typed graph; see rustOsc.ts). */
export type RustFilterType = 'lp' | 'bp' | 'hp';

/** Kernel response ids (`FILTER_*` in rust-audio/src/lib.rs) — the same numbering as the AS kernel. */
export const RUST_FILTER_TYPE_ID: Record<RustFilterType, number> = { lp: 0, bp: 1, hp: 2 };

/** The `rustOsc.requiredFilter` exports of emscripten/wasm_export_manifest.json, plus what the worklet needs of the oscillator half. */
export interface RustFilterExports {
    memory: WebAssembly.Memory;
    rosc_abi_version(): number;
    rosc_max_frames(): number;
    rosc_init(sampleRate: number): number;
    rflt_buf_ptr(): number;
    rflt_configure(sampleRate: number, cutoff: number, resonance: number, type: number): number;
    rflt_reset(): void;
    rflt_process(frames: number): number;
}

/** `rustOsc.requiredFilter` in emscripten/wasm_export_manifest.json. */
export const RUST_FILTER_REQUIRED_EXPORTS = [
    'rflt_buf_ptr',
    'rflt_configure',
    'rflt_reset',
    'rflt_process',
] as const satisfies readonly (keyof RustFilterExports)[];

/** Exports the worklet calls besides the filter's own (module identity + capacity). */
const RUST_FILTER_SHARED_EXPORTS = ['rosc_abi_version', 'rosc_max_frames', 'rosc_init'] as const;

/** AudioParams of the node (`parameterDescriptors`), all k-rate: coefficients update per block. Same names as the WASM OSC filter. */
export const RUST_FILTER_PARAMS = {
    /** Hz. */
    cutoff: 'cutoff',
    /** Q. */
    resonance: 'resonance',
    /** `RUST_FILTER_TYPE_ID`. */
    type: 'type',
} as const;

export interface RustFilterProcessorOptions {
    module: WebAssembly.Module;
}

export type RustFilterOutMessage =
    | { type: 'ready'; maxFrames: number }
    | { type: 'error'; reason: string };

export type RustFilterInMessage = { type: 'dispose' };

export function hasRustFilterApi(exports: unknown): exports is RustFilterExports {
    if (!exports || typeof exports !== 'object') return false;
    const x = exports as Record<string, unknown>;
    return x.memory instanceof WebAssembly.Memory
        && [...RUST_FILTER_SHARED_EXPORTS, ...RUST_FILTER_REQUIRED_EXPORTS]
            .every((name) => typeof x[name] === 'function');
}

export type RustFilterSettings = WamFilterSettings;
