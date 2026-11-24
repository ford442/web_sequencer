/**
 * Process-wide handles on the wasm filter stages the audio engine built (#1663,
 * #1672), one slot per `FilterSource`, so `Voice` can ask for the one a note
 * selected without a ref threaded through the engine (same pattern as the
 * oscillator registry). `native` has no stage: it is the voice's own
 * `BiquadFilterNode`.
 */

import type { FilterSource } from '../types/synth';
import type { WasmFilterStage } from './WamFilter';

export type StagedFilterSource = Exclude<FilterSource, 'native'>;

const stages = new Map<StagedFilterSource, WasmFilterStage>();

export function setFilterStage(source: StagedFilterSource, stage: WasmFilterStage | null): void {
    if (stage) stages.set(source, stage);
    else stages.delete(source);
}

export function getFilterStage(source: StagedFilterSource): WasmFilterStage | null {
    return stages.get(source) ?? null;
}
