/**
 * Contract shared by the `rust-*` oscillator worklet (`rust-osc-processor.ts`)
 * and its main-thread bridge (`src/engines/RustOscillator.ts`), #1664.
 *
 * Imported on both sides of the port, so it holds only types, constants and
 * pure functions — nothing that touches `window` or the worklet global scope.
 */

/**
 * The basic wave shapes, spelled as `WaveShape` (src/utils/waveformParser.ts)
 * spells them. Restated rather than imported: that module pulls the app's
 * DOM-typed `types` graph into the worklet project, which has no DOM lib.
 */
export type RustOscShape = 'saw' | 'sqr' | 'tri' | 'sin';

export const RUST_OSC_PROCESSOR = 'rust-osc-processor';

/** Must equal `ABI_VERSION` in rust-audio/src/lib.rs (tools/check_rust_osc_module.mjs). */
export const RUST_OSC_ABI_VERSION = 3;

/** The `rustOsc.required` exports of emscripten/wasm_export_manifest.json. */
export interface RustOscExports {
    memory: WebAssembly.Memory;
    rosc_abi_version(): number;
    rosc_max_frames(): number;
    rosc_simd(): number;
    rosc_freq_ptr(): number;
    rosc_out_ptr(): number;
    rosc_init(sampleRate: number): number;
    rosc_reset(phase: number): void;
    rosc_render(shape: number, frames: number, perSampleFreq: number): number;
    rosc_render_scalar(shape: number, frames: number, perSampleFreq: number): number;
}

export const RUST_OSC_REQUIRED_EXPORTS = [
    'rosc_abi_version',
    'rosc_max_frames',
    'rosc_simd',
    'rosc_freq_ptr',
    'rosc_out_ptr',
    'rosc_init',
    'rosc_reset',
    'rosc_render',
    'rosc_render_scalar',
] as const satisfies readonly (keyof RustOscExports)[];

/** Kernel shape ids (`SHAPE_*` in lib.rs) — same numbering as the AS kernel. */
export const RUST_OSC_SHAPE_ID: Record<RustOscShape, number> = { saw: 0, sqr: 1, tri: 2, sin: 3 };

/** AudioParams of the node (`parameterDescriptors`). */
export const RUST_OSC_PARAMS = {
    /** Hz, a-rate: slides and pitch automation are scheduled here. */
    frequency: 'frequency',
    /** Kernel shape id, k-rate. */
    shape: 'shape',
    /** ≥ 0.5 = open, a-rate so note starts are sample accurate. */
    gate: 'gate',
} as const;

export interface RustOscProcessorOptions {
    module: WebAssembly.Module;
}

export type RustOscOutMessage =
    | { type: 'ready'; simd: boolean; maxFrames: number }
    | { type: 'error'; reason: string };

export type RustOscInMessage = { type: 'dispose' };

export function hasRustOscApi(exports: unknown): exports is RustOscExports {
    if (!exports || typeof exports !== 'object') return false;
    const x = exports as Record<string, unknown>;
    return x.memory instanceof WebAssembly.Memory
        && RUST_OSC_REQUIRED_EXPORTS.every((name) => typeof x[name] === 'function');
}

/** Gate value at frame `i` of an a-rate param (one value when not automated). */
export function gateOpenAt(gate: Float32Array, i: number): boolean {
    return (gate.length > 1 ? gate[i] : gate[0] ?? 0) >= 0.5;
}

/**
 * End (exclusive) of the run of constant gate state that starts at `start`.
 *
 * `gate` is an a-rate param: one value for the whole block when it is not
 * automated, `frames` values otherwise. The processor walks a block run by run
 * with this — no closure, no allocation on the audio thread — and it is pure so
 * it can be tested without a worklet.
 */
export function gateRunEnd(gate: Float32Array, frames: number, start: number): number {
    if (gate.length <= 1) return frames;
    const open = gate[start] >= 0.5;
    let i = start + 1;
    while (i < frames && (gate[i] >= 0.5) === open) i++;
    return i;
}
