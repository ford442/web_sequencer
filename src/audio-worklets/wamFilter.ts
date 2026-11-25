/**
 * Contract shared by the "WASM OSC filter" worklet (`wam-filter-processor.ts`)
 * and its main-thread bridge (`src/engines/WamFilter.ts`), #1663.
 *
 * The DSP is `assembly/biquad.ts` — the very biquad that is baked into a
 * `wam-*` table — compiled on its own as `src/wasm/wamFilter.wasm`
 * (`assembly/wamFilter.ts`) so that one filter can run per synth voice in an
 * AudioWorklet. Imported on both sides of the port: types, constants and pure
 * functions only.
 */

export const WAM_FILTER_PROCESSOR = 'wam-filter-processor';

/** Must equal `ABI_VERSION` in assembly/wamFilter.ts. */
export const WAM_FILTER_ABI_VERSION = 1;

/** Restated, not imported from `src/types/synth.ts` (DOM-typed graph; see rustOsc.ts). */
export type WamFilterType = 'lp' | 'bp' | 'hp';

/** Kernel response ids (`FILTER_*` in assembly/biquad.ts). */
export const WAM_FILTER_TYPE_ID: Record<WamFilterType, number> = { lp: 0, bp: 1, hp: 2 };

/** The exports of assembly/wamFilter.ts. */
export interface WamFilterExports {
    memory: WebAssembly.Memory;
    abiVersion(): number;
    maxFrames(): number;
    inPtr(): number;
    outPtr(): number;
    configure(sampleRate: number, cutoff: number, resonance: number, type: number): number;
    reset(): void;
    process(frames: number): number;
}

export const WAM_FILTER_REQUIRED_EXPORTS = [
    'abiVersion',
    'maxFrames',
    'inPtr',
    'outPtr',
    'configure',
    'reset',
    'process',
] as const satisfies readonly (keyof WamFilterExports)[];

/** AudioParams of the node (`parameterDescriptors`), all k-rate: coefficients update per block. */
export const WAM_FILTER_PARAMS = {
    /** Hz. */
    cutoff: 'cutoff',
    /** Q. */
    resonance: 'resonance',
    /** `WAM_FILTER_TYPE_ID`. */
    type: 'type',
} as const;

export interface WamFilterProcessorOptions {
    module: WebAssembly.Module;
}

export type WamFilterOutMessage =
    // `simd`: kernels that report which path their filter runs (the Rust filter, #1663).
    | { type: 'ready'; maxFrames: number; simd?: boolean }
    | { type: 'error'; reason: string };

export type WamFilterInMessage = { type: 'dispose' };

export function hasWamFilterApi(exports: unknown): exports is WamFilterExports {
    if (!exports || typeof exports !== 'object') return false;
    const x = exports as Record<string, unknown>;
    return x.memory instanceof WebAssembly.Memory
        && WAM_FILTER_REQUIRED_EXPORTS.every((name) => typeof x[name] === 'function');
}

/** The coefficient inputs the kernel was last configured with; `null` before the first block. */
export interface WamFilterSettings {
    cutoff: number;
    resonance: number;
    type: number;
}

/**
 * True when `next` needs a `configure` call. The processor asks this once per
 * block so the trig behind the coefficients runs on a change, not 375 times a
 * second per voice.
 */
export function filterSettingsChanged(prev: WamFilterSettings | null, next: WamFilterSettings): boolean {
    return !prev
        || prev.cutoff !== next.cutoff
        || prev.resonance !== next.resonance
        || prev.type !== next.type;
}

/** `type` param value → kernel id, clamped: an unknown id is a lowpass, never a trap. */
export function clampFilterTypeId(value: number | undefined): number {
    const id = Math.round(value ?? 0);
    return id === 1 || id === 2 ? id : 0;
}
