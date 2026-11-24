// @mode: bridge
// Main-thread side of the "C++ filter" (#1673).
//
// The DSP is the `cflt_*` half of emscripten/cpp_osc.cpp — a resonant LP / BP /
// HP trapezoidal state variable filter — in public/cpp_osc.wasm, run per synth
// voice by src/audio-worklets/cpp-filter-processor.ts. It is the same module the
// `cpp-*` oscillator runs from, so it is compiled by the one shared loader
// (`loadCppOscModule`: fetch + compile, once per page) and a build that is
// missing the filter exports fails the release gate, not a note.
//
// Everything else — pooled nodes, readiness probe, fallback reasons — is
// `WasmFilterStage`. The filter is independent of the oscillator: JS, WASM OSC,
// Rust, DWGS, WebGPU, Pyodide, WAV and `cpp-*` voices can all select it.

import { resolvePublicAsset } from '@/utils/engineTelemetry/publicAsset';
import { CPP_FILTER_PROCESSOR } from '../audio-worklets/cppFilter';
import { CPP_OSC_WASM, loadCppOscModule } from './CppOscillator';
import {
    WasmFilterStage,
    type FilterModuleLoad,
    type FilterStageSpec,
} from './WamFilter';
import { getFilterStage, setFilterStage } from './filterStages';

export const CPP_FILTER_SPEC: FilterStageSpec = {
    source: 'cpp',
    processor: CPP_FILTER_PROCESSOR,
    moduleName: CPP_OSC_WASM,
    tag: 'CppFilter',
};

export class CppFilter extends WasmFilterStage {
    constructor(processorUrl: string) {
        super(processorUrl, resolvePublicAsset(CPP_OSC_WASM), CPP_FILTER_SPEC);
    }

    protected override loadModule(): Promise<FilterModuleLoad> {
        return loadCppOscModule();
    }
}

export function setCppFilter(filter: CppFilter | null): void {
    setFilterStage('cpp', filter);
}

export function getCppFilter(): WasmFilterStage | null {
    return getFilterStage('cpp');
}
