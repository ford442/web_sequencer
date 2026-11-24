// @mode: bridge
// Main-thread side of the "DWGS filter" (#1674).
//
// The DSP is the `dflt_*` half of dwgs-audio/src/lib.rs — a resonant LP / BP /
// HP 4-pole ladder with saturated feedback, the DW-6000 / DW-8000's analog
// 24 dB/oct filter as Hyphon models it — in public/dwgs_osc.wasm, run per synth
// voice by src/audio-worklets/dwgs-filter-processor.ts. It is the same module
// the `dwgs-*` oscillator runs from, so it is compiled by the one shared loader
// (`loadDwgsOscModule`: fetch + compile, once per page) and a build that is
// missing the filter exports fails the release gate, not a note.
//
// Everything else — pooled nodes, readiness probe, fallback reasons — is
// `WasmFilterStage`. The filter is independent of the oscillator: JS, WASM OSC,
// Rust, C++, WebGPU, Pyodide, WAV and `dwgs-*` voices can all select it.

import { resolvePublicAsset } from '@/utils/engineTelemetry/publicAsset';
import { DWGS_FILTER_PROCESSOR } from '../audio-worklets/dwgsFilter';
import { DWGS_OSC_WASM, loadDwgsOscModule } from './DwgsOscillator';
import {
    WasmFilterStage,
    type FilterModuleLoad,
    type FilterStageSpec,
} from './WamFilter';
import { getFilterStage, setFilterStage } from './filterStages';

export const DWGS_FILTER_SPEC: FilterStageSpec = {
    source: 'dwgs',
    processor: DWGS_FILTER_PROCESSOR,
    moduleName: DWGS_OSC_WASM,
    tag: 'DwgsFilter',
};

export class DwgsFilter extends WasmFilterStage {
    constructor(processorUrl: string) {
        super(processorUrl, resolvePublicAsset(DWGS_OSC_WASM), DWGS_FILTER_SPEC);
    }

    protected override loadModule(): Promise<FilterModuleLoad> {
        return loadDwgsOscModule();
    }
}

export function setDwgsFilter(filter: DwgsFilter | null): void {
    setFilterStage('dwgs', filter);
}

export function getDwgsFilter(): WasmFilterStage | null {
    return getFilterStage('dwgs');
}
