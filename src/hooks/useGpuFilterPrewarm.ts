import { useEffect } from 'react';
import type { SynthParams } from '../types';
import { parseWaveform } from '../utils/waveformParser';
import { engineEntry } from '../engines/backends/engineCatalog';
import { gpuFilterRefusal, gpuFilterSpec } from '../engines/backends/gpuFilter';
import { resolveFilterType } from '../engines/backends/filterSource';
import { getGpuFilter } from '../engines/filterStages';

/** How long a filter knob must hold still before its bank is baked. */
export const GPU_FILTER_PREWARM_DEBOUNCE_MS = 120;

type PrewarmSynth = Pick<SynthParams, 'waveform' | 'filterSource' | 'filterType' | 'filterCutoff' | 'filterResonance'>;

/**
 * Bake the WebGPU filter's bank for a synth's current settings, if it uses the
 * WebGPU filter and the GPU can serve its wave (#1675). A bank is the part's shape
 * filtered for every MIDI note, and the first note after a knob moves would
 * otherwise find it missing and play through the native filter (the same response,
 * so it is not a click or a hole, just not the GPU path). Returns whether a bake
 * was requested.
 */
export function prewarmGpuFilter(ctx: BaseAudioContext | null | undefined, synth: PrewarmSynth): boolean {
    if (!ctx || synth.filterSource !== 'webgpu') return false;
    const gpu = getGpuFilter();
    if (!gpu || gpu.unavailableReason()) return false;
    const parsed = parseWaveform(synth.waveform);
    if (engineEntry(parsed.engine).kind === 'native-worklet' || gpuFilterRefusal(parsed) !== null) return false;
    const spec = gpuFilterSpec(
        resolveFilterType(synth.filterType),
        synth.filterCutoff,
        synth.filterResonance,
        ctx.sampleRate,
    );
    void gpu.warm(ctx, parsed.shape, spec);
    return true;
}

/**
 * Prewarm while the synth's filter settings change, debounced so a knob drag asks
 * once it settles (the cache is on a 1/24-octave grid, so a drag inside one cell
 * costs nothing).
 */
export function useGpuFilterPrewarm(ctx: BaseAudioContext | null | undefined, synth: PrewarmSynth): void {
    const { waveform, filterSource, filterType, filterCutoff, filterResonance } = synth;
    useEffect(() => {
        if (!ctx || filterSource !== 'webgpu') return undefined;
        const timer = setTimeout(() => {
            prewarmGpuFilter(ctx, { waveform, filterSource, filterType, filterCutoff, filterResonance });
        }, GPU_FILTER_PREWARM_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [ctx, waveform, filterSource, filterType, filterCutoff, filterResonance]);
}
