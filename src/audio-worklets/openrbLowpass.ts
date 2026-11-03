// src/audio-worklets/openrbLowpass.ts
// openrb low-pass — ABI contract for the optional `openrb_lp_*` export group of
// openrb338.wasm (the patch bay's "openrb" low-pass mode).
//
// The filter is ReBirth 2.01's PCF low-pass (bit-exact coefficient table and
// 2-pole filter, extracted from openrb-338 into openrb338/src/pcf_lp.rs, run as
// a static insert by openrb338/src/lowpass.rs). That code is GPL-3.0-only and
// lives only in the opt-in module; this file contains no openrb code, just the
// numbers the module's C ABI speaks. See docs/audio-engine/openrb-lowpass.md.
//
// Worklet-safe: no DOM, no fetch (see src/audio-worklets/tsconfig.json).

/** Revision of the low-pass group. The module reports its own via `openrb_lp_version`. */
export const OPENRB_LP_VERSION = 1;

/** The AudioWorklet processor name (`openrb-lowpass-processor.ts`). */
export const OPENRB_LOWPASS_PROCESSOR = 'openrb-lowpass-processor';

/** Channels one processor filters (one module filter handle each). */
export const OPENRB_LP_MAX_CHANNELS = 2;

/** `openrb_lp_set_param` ids (`openrb338/src/lowpass.rs`, `param`). */
export const OPENRB_LP_PARAM_IDS = {
    /** ReBirth PCF frequency knob, 0..127 (fractional allowed, max 127.75). */
    frequency: 0,
    /** ReBirth PCF resonance knob, 0..127; only 8 rows (`(r * 8) >> 7`). */
    resonance: 1,
    /** Linear gain after the filter; 1 = ReBirth's level (bit-exact). */
    outputGain: 2,
    /** Pole frequency in Hz (resolved to the frequency knob). */
    cutoffHz: 3,
    /** Pole Q (resolved to the nearest resonance row). */
    q: 4,
} as const;

/** The export names the group requires, besides `memory`. */
export const OPENRB_LP_REQUIRED_EXPORTS = [
    'openrb_lp_version',
    'openrb_lp_create',
    'openrb_lp_destroy',
    'openrb_lp_set_param',
    'openrb_lp_reset',
    'openrb_lp_buffer',
    'openrb_lp_process',
    'openrb_lp_is_bit_exact',
] as const;

export interface OpenrbLowpassExports {
    memory: WebAssembly.Memory;
    openrb_lp_version(): number;
    /** A filter for a host at `sampleRate` Hz; 0 on failure. */
    openrb_lp_create(sampleRate: number): number;
    openrb_lp_destroy(handle: number): void;
    openrb_lp_set_param(handle: number, paramId: number, value: number): void;
    openrb_lp_reset(handle: number): void;
    /** In-place mono f32 buffer (pointer, use `>>> 0`). Moves only if a later call asks for more. */
    openrb_lp_buffer(handle: number, maxFrames: number): number;
    /** Filter the first `frames` samples of the buffer in place. */
    openrb_lp_process(handle: number, frames: number): void;
    /** 1 when the output is ReBirth's sample for sample (host at 44.1 kHz). */
    openrb_lp_is_bit_exact(handle: number): number;
}

/** True when `exports` carries the low-pass group at the revision this host speaks. */
export function supportsOpenrbLowpass(exports: unknown): exports is OpenrbLowpassExports {
    if (typeof exports !== 'object' || exports === null) return false;
    const x = exports as Record<string, unknown>;
    if (!(x.memory instanceof WebAssembly.Memory)) return false;
    if (OPENRB_LP_REQUIRED_EXPORTS.some((name) => typeof x[name] !== 'function')) return false;
    return (x.openrb_lp_version as () => number)() === OPENRB_LP_VERSION;
}

/** Messages the main thread sends the processor. */
export type OpenrbLowpassInMessage =
    | { type: 'module'; module: WebAssembly.Module }
    | { type: 'set'; cutoffHz?: number; q?: number; outputGain?: number };

/** Messages the processor sends back. */
export type OpenrbLowpassOutMessage =
    | { type: 'ready'; bitExact: boolean }
    | { type: 'unavailable'; reason: string };

/** Initial state, in `processorOptions`. */
export interface OpenrbLowpassProcessorOptions {
    cutoffHz?: number;
    q?: number;
    outputGain?: number;
}
