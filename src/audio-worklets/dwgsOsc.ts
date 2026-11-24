/**
 * Contract shared by the `dwgs-*` oscillator worklet (`dwgs-osc-processor.ts`)
 * and its main-thread bridge (`src/engines/DwgsOscillator.ts`), #1666.
 *
 * Imported on both sides of the port, so it holds only types, constants and
 * pure functions — nothing that touches `window` or the worklet global scope.
 * The gate helpers are the Rust OSC's (`./rustOsc`): every worklet oscillator
 * walks an a-rate gate the same way. The wave table (names, fallbacks) is
 * main-thread data, `src/engines/dwgsWaves.ts`; the worklet only needs ids.
 */

export { gateOpenAt, gateRunEnd } from './rustOsc';

export const DWGS_OSC_PROCESSOR = 'dwgs-osc-processor';

/** Must equal `ABI_VERSION` in dwgs-audio/src/lib.rs (tools/check_dwgs_osc_module.mjs). */
export const DWGS_OSC_ABI_VERSION = 2;

/** Must equal `WAVE_COUNT` in dwgs-audio/src/lib.rs and `DWGS_WAVES.length`. */
export const DWGS_OSC_WAVE_COUNT = 17;

/** The `dwgsOsc.required` exports of emscripten/wasm_export_manifest.json. */
export interface DwgsOscExports {
    memory: WebAssembly.Memory;
    dwgs_abi_version(): number;
    dwgs_max_frames(): number;
    dwgs_wave_count(): number;
    dwgs_freq_ptr(): number;
    dwgs_out_ptr(): number;
    dwgs_init(sampleRate: number): number;
    dwgs_reset(phase: number): void;
    dwgs_render(wave: number, frames: number, perSampleFreq: number): number;
}

export const DWGS_OSC_REQUIRED_EXPORTS = [
    'dwgs_abi_version',
    'dwgs_max_frames',
    'dwgs_wave_count',
    'dwgs_freq_ptr',
    'dwgs_out_ptr',
    'dwgs_init',
    'dwgs_reset',
    'dwgs_render',
] as const satisfies readonly (keyof DwgsOscExports)[];

/** AudioParams of the node (`parameterDescriptors`). */
export const DWGS_OSC_PARAMS = {
    /** Hz, a-rate: slides and pitch automation are scheduled here. */
    frequency: 'frequency',
    /** Kernel wave id (index into DWGS_WAVES), k-rate. */
    wave: 'wave',
    /** ≥ 0.5 = open, a-rate so note starts are sample accurate. */
    gate: 'gate',
} as const;

export interface DwgsOscProcessorOptions {
    module: WebAssembly.Module;
}

export type DwgsOscOutMessage =
    | { type: 'ready'; waves: number; maxFrames: number }
    | { type: 'error'; reason: string };

export type DwgsOscInMessage = { type: 'dispose' };

export function hasDwgsOscApi(exports: unknown): exports is DwgsOscExports {
    if (!exports || typeof exports !== 'object') return false;
    const x = exports as Record<string, unknown>;
    return x.memory instanceof WebAssembly.Memory
        && DWGS_OSC_REQUIRED_EXPORTS.every((name) => typeof x[name] === 'function');
}

/** Clamp a k-rate `wave` param value to a kernel wave id. */
export function dwgsWaveId(value: number | undefined): number {
    const v = Math.round(value ?? 0);
    return v >= 0 && v < DWGS_OSC_WAVE_COUNT ? v : 0;
}

/**
 * Instantiate `module` (no imports) and run `dwgs_init`. Shared by the worklet
 * and the offline renderer so both bring a voice up identically. Throws with a
 * reason the caller reports.
 */
export function instantiateDwgsOsc(module: WebAssembly.Module, sampleRate: number): DwgsOscExports {
    const exports = new WebAssembly.Instance(module, {}).exports;
    if (!hasDwgsOscApi(exports)) throw new Error('dwgs_osc.wasm is missing dwgs_* exports');
    const abi = exports.dwgs_abi_version();
    if (abi !== DWGS_OSC_ABI_VERSION) {
        throw new Error(`dwgs_osc.wasm ABI ${abi}, expected ${DWGS_OSC_ABI_VERSION}`);
    }
    const waves = exports.dwgs_wave_count();
    if (waves !== DWGS_OSC_WAVE_COUNT) {
        throw new Error(`dwgs_osc.wasm has ${waves} waves, expected ${DWGS_OSC_WAVE_COUNT}`);
    }
    if (exports.dwgs_init(sampleRate) !== 1) throw new Error(`dwgs_init(${sampleRate}) refused the rate`);
    return exports;
}
