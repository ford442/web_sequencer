/**
 * Contract shared by the "C++ filter" worklet (`cpp-filter-processor.ts`) and
 * its main-thread bridge (`src/engines/CppFilter.ts`), #1673.
 *
 * The DSP is the `cflt_*` half of emscripten/cpp_osc.cpp — a resonant LP / BP /
 * HP trapezoidal state variable filter — in the *same* `public/cpp_osc.wasm`
 * the `cpp-*` oscillator runs from (one build, one artifact, one release gate).
 * A filter node is just another instance of that module that never calls
 * `cosc_init` / `cosc_render`: one per synth voice that selected
 * `filterSource: 'cpp'`, whatever oscillator engine feeds it.
 *
 * Imported on both sides of the port: types, constants and pure functions only.
 */

import { CPP_OSC_EXPORTS } from '../shared/rt/cppOscExports';
import { CPP_OSC_ABI_VERSION, type CppOscInstance } from './cppOsc';
import {
    clampFilterTypeId,
    filterSettingsChanged,
    type WamFilterSettings,
} from './wamFilter';

export { clampFilterTypeId, filterSettingsChanged };

export const CPP_FILTER_PROCESSOR = 'cpp-filter-processor';

/** The module's ABI version: the filter shares `cpp_osc.wasm` with the oscillator (tools/check_cpp_osc_module.mjs). */
export const CPP_FILTER_ABI_VERSION = CPP_OSC_ABI_VERSION;

/** Restated, not imported from `src/types/synth.ts` (DOM-typed graph; see cppOsc.ts). */
export type CppFilterType = 'lp' | 'bp' | 'hp';

/** Kernel response ids (`kFilter*` in emscripten/cpp_osc.cpp) — the same numbering as the other kernels. */
export const CPP_FILTER_TYPE_ID: Record<CppFilterType, number> = { lp: 0, bp: 1, hp: 2 };

/** What the filter worklet calls: the `cflt_*` exports plus module identity and capacity. */
export type CppFilterExports = Pick<
    CppOscInstance,
    'memory' | '_initialize' | 'cosc_abi_version' | 'cosc_max_frames'
    | 'cflt_buf_ptr' | 'cflt_configure' | 'cflt_reset' | 'cflt_process'
>;

/** The filter's half of the `cppOsc.required` exports in emscripten/wasm_export_manifest.json. */
export const CPP_FILTER_REQUIRED_EXPORTS = CPP_OSC_EXPORTS.filter(
    (name): name is Extract<typeof name, `cflt_${string}`> => name.startsWith('cflt_'),
);

/** Exports the worklet calls besides the filter's own (module identity + capacity). */
const CPP_FILTER_SHARED_EXPORTS = ['cosc_abi_version', 'cosc_max_frames'] as const;

/** AudioParams of the node (`parameterDescriptors`), all k-rate. Same names as the other filter stages. */
export const CPP_FILTER_PARAMS = {
    /** Hz. */
    cutoff: 'cutoff',
    /** Q. */
    resonance: 'resonance',
    /** `CPP_FILTER_TYPE_ID`. */
    type: 'type',
} as const;

export interface CppFilterProcessorOptions {
    module: WebAssembly.Module;
}

export type CppFilterOutMessage =
    | { type: 'ready'; maxFrames: number }
    | { type: 'error'; reason: string };

export type CppFilterInMessage = { type: 'dispose' };

export function hasCppFilterApi(exports: unknown): exports is CppFilterExports {
    if (!exports || typeof exports !== 'object') return false;
    const x = exports as Record<string, unknown>;
    return x.memory instanceof WebAssembly.Memory
        && [...CPP_FILTER_SHARED_EXPORTS, ...CPP_FILTER_REQUIRED_EXPORTS]
            .every((name) => typeof x[name] === 'function');
}

/**
 * Instantiate `module` (no imports) as a filter: run the reactor initializer and
 * check the ABI, but do NOT `cosc_init` — a filter never renders, so it never
 * builds the oscillator's residual tables. Throws with a reason the caller reports.
 */
export function instantiateCppFilter(module: WebAssembly.Module): CppFilterExports {
    const exports = new WebAssembly.Instance(module, {}).exports;
    if (!hasCppFilterApi(exports)) throw new Error('cpp_osc.wasm is missing cflt_* exports');
    exports._initialize?.();
    const abi = exports.cosc_abi_version();
    if (abi !== CPP_FILTER_ABI_VERSION) {
        throw new Error(`cpp_osc.wasm ABI ${abi}, worklet expects ${CPP_FILTER_ABI_VERSION}`);
    }
    return exports;
}

export type CppFilterSettings = WamFilterSettings;
