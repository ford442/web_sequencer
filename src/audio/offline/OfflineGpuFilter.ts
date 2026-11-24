// The WebGPU filter, offline (#1675).
//
// A bounce cannot use the realtime path's bank cache (it has no notion of "the next
// note"), and does not need to: it can simply wait for the GPU. So a part that selects
// the WebGPU filter is rendered by the `wgsl-*` kernel at the note's exact pitch with
// the filter folded into every harmonic, and the render *is* the filtered note — the
// caller skips its biquad. Same sound as the live note: the RBJ response at the
// part's cutoff and resonance, evaluated at the note's own harmonics.
//
// Like the live path it plays the part's basic shape on the GPU whichever oscillator
// engine the part names, and anything the GPU cannot do returns null with the reason
// reported once, so the caller renders as it always did (native filter).

import type { SynthParams } from '@/types';
import type { ParsedWaveform, WaveShape } from '@/utils/waveformParser';
import { engineEntry } from '@/engines/backends/engineCatalog';
import { gpuFilterRefusal, gpuFilterSpec, type GpuFilterSpec } from '@/engines/backends/gpuFilter';
import { FILTER_SOURCE_LABELS, filterSourceIssueId, resolveFilterType } from '@/engines/backends/filterSource';
import { logFilterSourceFallback } from '@/utils/engineTelemetry';

/** The slice of `WebGpuOscillator` a bounce needs. */
export interface GpuFilterRenderer {
    isSupported: boolean;
    generate(
        freq: number,
        dur: number,
        rate: number,
        type: WaveShape,
        filter?: GpuFilterSpec | null,
    ): Float32Array | null | Promise<Float32Array | null>;
}

/** Reasons already reported this session: a bounce renders per hit, so say each once. */
const reported = new Set<string>();

function fallback(reason: string): null {
    if (!reported.has(reason)) {
        reported.add(reason);
        logFilterSourceFallback(
            FILTER_SOURCE_LABELS.webgpu,
            FILTER_SOURCE_LABELS.native,
            `${reason} (offline render)`,
            filterSourceIssueId('webgpu'),
        );
    }
    return null;
}

/** Test seam: forget which reasons were already reported. */
export function resetOfflineGpuFilterReportsForTests(): void {
    reported.clear();
}

/**
 * The note rendered and filtered on the GPU, or null when the part does not use the
 * WebGPU filter (silently) or cannot (reported once, and the caller uses its
 * native filter).
 */
export async function renderGpuFilteredNote(opts: {
    params: Pick<SynthParams, 'filterSource' | 'filterType' | 'filterCutoff' | 'filterResonance'>;
    parsed: ParsedWaveform;
    /** The note's exact pitch in Hz, after the part's pitch offset. */
    frequency: number;
    duration: number;
    sampleRate: number;
    engine: GpuFilterRenderer | null | undefined;
    /** The note's filter moves while it plays (#1384); a baked table holds one setting. */
    hasFilterCurve?: boolean;
}): Promise<Float32Array | null> {
    const { params, parsed, frequency, duration, sampleRate, engine } = opts;
    if (params.filterSource !== 'webgpu') return null;
    // 303 / Prophecy / Macro own their filters and never reach this render.
    if (engineEntry(parsed.engine).kind === 'native-worklet') return null;

    const refusal = gpuFilterRefusal(parsed);
    if (refusal) return fallback(refusal);
    if (opts.hasFilterCurve) return fallback("the note's filter moves while it plays, and a GPU table holds one setting");
    if (!engine || !engine.isSupported) return fallback('WebGPU is unavailable (no adapter, or the device was lost)');

    const spec = gpuFilterSpec(
        resolveFilterType(params.filterType),
        params.filterCutoff,
        params.filterResonance,
        sampleRate,
    );
    try {
        const samples = await engine.generate(frequency, duration, sampleRate, parsed.shape, spec);
        if (!samples) return fallback('the GPU could not render this note (a pitch at or above Nyquist, or the render failed)');
        return samples;
    } catch (e) {
        return fallback(`the GPU render threw: ${e instanceof Error ? e.message : String(e)}`);
    }
}
