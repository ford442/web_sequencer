// The Pyodide filter, offline (#1676).
//
// Same idea as the WebGPU filter's bounce (`OfflineGpuFilter`): a bounce has no "next
// note" and can wait, so a part that selects the Pyodide filter is rendered by
// `generate_filtered_note()` at the note's exact pitch with the filter applied to every
// harmonic, and the render *is* the filtered note — the caller skips its biquad. The
// runtime is asked for if it has not loaded (a bounce is allowed to wait for it).
//
// Like the live path it plays the part's basic shape whichever oscillator engine the part
// names, and anything Python cannot do returns null with the reason reported once, so the
// caller renders as it always did (native filter).

import type { SynthParams } from '@/types';
import type { ParsedWaveform } from '@/utils/waveformParser';
import { engineEntry } from '@/engines/backends/engineCatalog';
import { gpuFilterSpec } from '@/engines/backends/gpuFilter';
import { pyodideFilterRefusal } from '@/engines/backends/pyodideFilter';
import { FILTER_SOURCE_LABELS, filterSourceIssueId, resolveFilterType } from '@/engines/backends/filterSource';
import { PYODIDE_OSC_TYPE, pyodideSamplesToFloat32, type PyodideLike, type PyodideSamplesProxy } from '@/utils/pyodideBuffers';
import { requestPythonEngine } from '@/pyodide/pythonEngineStore';
import { logFilterSourceFallback } from '@/utils/engineTelemetry';

/** Reasons already reported this session: a bounce renders per hit, so say each once. */
const reported = new Set<string>();

function fallback(reason: string): null {
    if (!reported.has(reason)) {
        reported.add(reason);
        logFilterSourceFallback(
            FILTER_SOURCE_LABELS.pyodide,
            FILTER_SOURCE_LABELS.native,
            `${reason} (offline render)`,
            filterSourceIssueId('pyodide'),
        );
    }
    return null;
}

/** Test seam: forget which reasons were already reported. */
export function resetOfflinePyodideFilterReportsForTests(): void {
    reported.clear();
}

/**
 * The note rendered and filtered in Python, or null when the part does not use the
 * Pyodide filter (silently) or cannot (reported once, and the caller uses its native filter).
 */
export async function renderPyodideFilteredNote(opts: {
    params: Pick<SynthParams, 'filterSource' | 'filterType' | 'filterCutoff' | 'filterResonance'>;
    parsed: ParsedWaveform;
    /** The note's exact pitch in Hz, after the part's pitch offset. */
    frequency: number;
    duration: number;
    sampleRate: number;
    /** The runtime if the caller has one; otherwise it is requested (and awaited). */
    pyodide?: PyodideLike | null;
    /** Test seam: how to get a runtime when `pyodide` is absent. */
    loadRuntime?: () => Promise<PyodideLike | null>;
    /** The note's filter moves while it plays (#1384); a baked table holds one setting. */
    hasFilterCurve?: boolean;
}): Promise<Float32Array | null> {
    const { params, parsed, frequency, duration, sampleRate } = opts;
    if (params.filterSource !== 'pyodide') return null;
    // 303 / Prophecy / Macro own their filters and never reach this render.
    if (engineEntry(parsed.engine).kind === 'native-worklet') return null;

    const refusal = pyodideFilterRefusal(parsed);
    if (refusal) return fallback(refusal);
    if (opts.hasFilterCurve) return fallback("the note's filter moves while it plays, and a baked table holds one setting");
    if (!Number.isFinite(frequency) || frequency <= 0 || frequency >= sampleRate / 2) {
        return fallback('the pitch is at or above Nyquist, so there is nothing to render');
    }

    const load = opts.loadRuntime ?? (() => requestPythonEngine('pyodide-filter-bounce'));
    const pyodide = opts.pyodide ?? (await load());
    if (!pyodide) return fallback('the Python runtime is unavailable');

    const spec = gpuFilterSpec(
        resolveFilterType(params.filterType),
        params.filterCutoff,
        params.filterResonance,
        sampleRate,
    );
    try {
        pyodide.globals.get('set_sample_rate')(sampleRate);
        const proxy = pyodide.globals.get('generate_filtered_note')(
            frequency, duration, PYODIDE_OSC_TYPE[parsed.shape], spec.type, spec.cutoff, spec.q,
        ) as PyodideSamplesProxy;
        const samples = pyodideSamplesToFloat32(proxy);
        if (!samples) return fallback('the Python render returned no samples');
        if (!samples.every(Number.isFinite)) return fallback('the Python render came back with non-finite samples');
        return samples;
    } catch (e) {
        return fallback(`the Python render threw: ${e instanceof Error ? (e.message.split('\n').filter(Boolean).pop() ?? e.message) : String(e)}`);
    }
}
