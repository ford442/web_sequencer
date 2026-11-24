// @mode: bridge
// Main-thread side of the "Rust filter" (#1672).
//
// The DSP is the `rflt_*` half of rust-audio/src/lib.rs — a resonant LP / BP / HP
// RBJ biquad — in public/rust_osc.wasm, run per synth voice by
// src/audio-worklets/rust-filter-processor.ts. It is the same module the `rust-*`
// oscillator runs from, so it is compiled by the one shared loader
// (`loadRustOscModule`: fetch + SIMD validate + compile, once per page) and a
// build that is missing the filter exports fails the release gate, not a note.
//
// Everything else — pooled nodes, readiness probe, fallback reasons — is
// `WasmFilterStage`. The filter is independent of the oscillator: JS, WASM OSC,
// C++, DWGS, WebGPU, Pyodide, WAV and `rust-*` voices can all select it.

import { resolvePublicAsset } from '@/utils/engineTelemetry/publicAsset';
import { RUST_FILTER_PROCESSOR } from '../audio-worklets/rustFilter';
import { RUST_OSC_WASM, loadRustOscModule } from './RustOscillator';
import {
    WasmFilterStage,
    type FilterModuleLoad,
    type FilterStageSpec,
} from './WamFilter';
import { getFilterStage, setFilterStage } from './filterStages';

export const RUST_FILTER_SPEC: FilterStageSpec = {
    source: 'rust',
    processor: RUST_FILTER_PROCESSOR,
    moduleName: RUST_OSC_WASM,
    tag: 'RustFilter',
};

export class RustFilter extends WasmFilterStage {
    constructor(processorUrl: string) {
        super(processorUrl, resolvePublicAsset(RUST_OSC_WASM), RUST_FILTER_SPEC);
    }

    protected override loadModule(): Promise<FilterModuleLoad> {
        return loadRustOscModule();
    }
}

export function setRustFilter(filter: RustFilter | null): void {
    setFilterStage('rust', filter);
}

export function getRustFilter(): WasmFilterStage | null {
    return getFilterStage('rust');
}
