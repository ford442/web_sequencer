/**
 * Process-wide handles on the wasm filter stages the audio engine built (#1663,
 * #1672), one slot per `FilterSource`, so `Voice` can ask for the one a note
 * selected without a ref threaded through the engine (same pattern as the
 * oscillator registry). `native` has no stage: it is the voice's own
 * `BiquadFilterNode`.
 */

import type { FilterSource } from '../types/synth';
import type { TableFilterSource } from './backends/filterSource';
import type { WasmFilterStage } from './WamFilter';
import type { WebGpuFilter } from './WebGpuFilter';
import type { PyodideFilter } from './PyodideFilter';

/** The sources that run in an AudioWorklet node: everything but the voice's own biquad and the table filters. */
export type StagedFilterSource = Exclude<FilterSource, 'native' | TableFilterSource>;

const stages = new Map<StagedFilterSource, WasmFilterStage>();

export function setFilterStage(source: StagedFilterSource, stage: WasmFilterStage | null): void {
    if (stage) stages.set(source, stage);
    else stages.delete(source);
}

export function getFilterStage(source: StagedFilterSource): WasmFilterStage | null {
    return stages.get(source) ?? null;
}

/**
 * The WebGPU filter (#1675) is not a node, so it has a slot of its own: a bank
 * cache `Voice` asks for a filtered table, never a stage it wires into the graph.
 */
let gpuFilter: WebGpuFilter | null = null;

export function setGpuFilter(filter: WebGpuFilter | null): void {
    gpuFilter = filter;
}

export function getGpuFilter(): WebGpuFilter | null {
    return gpuFilter;
}

/** The Pyodide filter (#1676) is a table filter like the GPU's: a cache a voice asks, never a node. */
let pyodideFilter: PyodideFilter | null = null;

export function setPyodideFilter(filter: PyodideFilter | null): void {
    pyodideFilter = filter;
}

export function getPyodideFilter(): PyodideFilter | null {
    return pyodideFilter;
}
