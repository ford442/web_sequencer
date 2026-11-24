/**
 * Contract shared by the `cpp-*` oscillator worklet (`cpp-osc-processor.ts`)
 * and its main-thread bridge (`src/engines/CppOscillator.ts`), #1665.
 *
 * Imported on both sides of the port, so it holds only types, constants and
 * pure functions — nothing that touches `window` or the worklet global scope.
 * The gate helpers are the Rust OSC's (`./rustOsc`): both processors walk an
 * a-rate gate the same way.
 */

import { CPP_OSC_EXPORTS, type CppOscExports } from '../shared/rt/cppOscExports';

export { gateOpenAt, gateRunEnd } from './rustOsc';
export type { CppOscExports } from '../shared/rt/cppOscExports';

/**
 * The basic wave shapes, spelled as `WaveShape` (src/utils/waveformParser.ts)
 * spells them. Restated rather than imported: that module pulls the app's
 * DOM-typed `types` graph into the worklet project, which has no DOM lib.
 */
export type CppOscShape = 'saw' | 'sqr' | 'tri' | 'sin';

export const CPP_OSC_PROCESSOR = 'cpp-osc-processor';

/** Must equal `kAbiVersion` in emscripten/cpp_osc.cpp (tools/check_cpp_osc_module.mjs). */
export const CPP_OSC_ABI_VERSION = 2;

/** cpp_osc.wasm instance exports: the generated surface plus the reactor's own. */
export interface CppOscInstance extends CppOscExports {
    memory: WebAssembly.Memory;
    /** STANDALONE_WASM reactor entry (static constructors); optional, idempotent. */
    _initialize?: () => void;
}

/** Kernel shape ids (`kShape*` in cpp_osc.cpp) — same numbering as the other kernels. */
export const CPP_OSC_SHAPE_ID: Record<CppOscShape, number> = { saw: 0, sqr: 1, tri: 2, sin: 3 };

/** AudioParams of the node (`parameterDescriptors`). */
export const CPP_OSC_PARAMS = {
    /** Hz, a-rate: slides and pitch automation are scheduled here. */
    frequency: 'frequency',
    /** Kernel shape id, k-rate. */
    shape: 'shape',
    /** ≥ 0.5 = open, a-rate so note starts are sample accurate. */
    gate: 'gate',
} as const;

export interface CppOscProcessorOptions {
    module: WebAssembly.Module;
}

export type CppOscOutMessage =
    | { type: 'ready'; latency: number; maxFrames: number }
    | { type: 'error'; reason: string };

export type CppOscInMessage = { type: 'dispose' };

export function hasCppOscApi(exports: unknown): exports is CppOscInstance {
    if (!exports || typeof exports !== 'object') return false;
    const x = exports as Record<string, unknown>;
    return x.memory instanceof WebAssembly.Memory
        && CPP_OSC_EXPORTS.every((name) => typeof x[name] === 'function');
}

/**
 * Instantiate `module` (no imports), run the reactor initializer and
 * `cosc_init`. Shared by the worklet and the offline renderer so both bring a
 * voice up identically. Throws with a reason the caller reports.
 */
export function instantiateCppOsc(module: WebAssembly.Module, sampleRate: number): CppOscInstance {
    const exports = new WebAssembly.Instance(module, {}).exports;
    if (!hasCppOscApi(exports)) throw new Error('cpp_osc.wasm is missing cosc_* exports');
    exports._initialize?.();
    const abi = exports.cosc_abi_version();
    if (abi !== CPP_OSC_ABI_VERSION) {
        throw new Error(`cpp_osc.wasm ABI ${abi}, expected ${CPP_OSC_ABI_VERSION}`);
    }
    if (exports.cosc_init(sampleRate) !== 1) throw new Error(`cosc_init(${sampleRate}) refused the rate`);
    return exports;
}
