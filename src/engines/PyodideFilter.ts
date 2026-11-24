// The Pyodide filter as a `Voice` filter source (#1676).
//
// Python cannot be a stage after an oscillator (no CPython in an
// AudioWorkletGlobalScope), so this is a *table* filter like the WebGPU one
// (`WebGpuFilter`): SciPy renders the note's shape with the resonant filter
// applied to every harmonic, and the voice loops the table. Unlike the GPU, a
// Pyodide call is synchronous and a table is a few thousand samples, so there is
// no bank and no warm-up of a render: `lookup()` renders on a miss (a millisecond
// or two) and caches the table per (shape, nearest note, filter cell).
//
// The one thing that is not synchronous is the runtime itself, which loads on
// demand (`requestPythonEngine`) and can take seconds. Until it is `ready` a note
// plays through the native filter — the same RBJ response — and says `loading`,
// which `Voice` logs as a warm-up rather than raising a degradation. A load that
// failed is `unavailable`, and is reported.

import { engineTelemetry } from '../utils/engineTelemetry';
import { getPythonRuntime } from '../pyodide/pythonEngineStore';
import { PYODIDE_OSC_TYPE, pyodideSamplesToFloat32, type PyodideLike, type PyodideSamplesProxy } from '../utils/pyodideBuffers';
import type { WaveShape } from '../utils/waveformParser';
import type { LoopRender } from './backends/OscillatorBackend';
import { quantizeGpuFilter, type GpuFilterSpec } from './backends/gpuFilter';
import { PYODIDE_FILTER_RANGE, planPyodideTable } from './backends/pyodideFilter';

export type PyodideLookup =
    /** A loop table for the note, already filtered. */
    | { kind: 'ready'; render: LoopRender }
    /** The Python runtime is still loading; use the native filter for this note (same response). */
    | { kind: 'loading' }
    /** Python cannot serve this note at all. */
    | { kind: 'unavailable'; reason: string };

/** What `PyodideFilter` needs to see of the runtime. */
export interface PythonRuntimeView {
    status: 'not-requested' | 'loading' | 'ready' | 'failed';
    pyodide: PyodideLike | null;
    reason: string | null;
}

/** The Python entry point for a one-shot, shared with the offline render. */
export function renderFilteredTable(
    pyodide: PyodideLike,
    sampleRate: number,
    shape: WaveShape,
    plan: { cycles: number; length: number; f0: number },
    spec: GpuFilterSpec,
): Float32Array | null {
    pyodide.globals.get('set_sample_rate')(sampleRate);
    const proxy = pyodide.globals.get('generate_filtered_table')(
        PYODIDE_OSC_TYPE[shape], plan.cycles, plan.length, plan.f0, spec.type, spec.cutoff, spec.q,
    ) as PyodideSamplesProxy;
    return pyodideSamplesToFloat32(proxy);
}

export class PyodideFilter {
    /** Tables kept, least recently used out first (a table is 8-12 KB). */
    static readonly MAX_TABLES = 256;
    /** After a failed render, how long before the same table is tried again. */
    static readonly RETRY_AFTER_MS = 2000;

    /** Insertion order is recency order: the first key is the next to evict. */
    private readonly tables = new Map<string, LoopRender>();
    private readonly failures = new Map<string, { reason: string; at: number }>();

    private readonly runtime: () => PythonRuntimeView;
    private readonly now: () => number;

    constructor(runtime: () => PythonRuntimeView = getPythonRuntime, now: () => number = () => Date.now()) {
        this.runtime = runtime;
        this.now = now;
    }

    /** Why the Pyodide filter cannot run at all right now, or null (also null while loading: that is a wait, not a failure). */
    unavailableReason(): string | null {
        const r = this.runtime();
        return r.status === 'failed' ? `the Python runtime failed to load${r.reason ? ` (${r.reason})` : ''}` : null;
    }

    /** The table for a note of `frequency` filtered by `spec`. Never waits. */
    lookup(ctx: BaseAudioContext, shape: WaveShape, spec: GpuFilterSpec, frequency: number): PyodideLookup {
        const reason = this.unavailableReason();
        if (reason) return { kind: 'unavailable', reason };
        const runtime = this.runtime();
        if (runtime.status !== 'ready' || !runtime.pyodide) return { kind: 'loading' };

        const sampleRate = ctx.sampleRate;
        const plan = planPyodideTable(frequency, sampleRate);
        if (!plan) {
            return { kind: 'unavailable', reason: `the pitch is outside the Pyodide filter's range (${PYODIDE_FILTER_RANGE})` };
        }

        const { spec: onGrid, key: gridKey } = quantizeGpuFilter(spec, sampleRate);
        const key = `${shape}|${plan.midi}|${gridKey}`;

        const cached = this.tables.get(key);
        if (cached) {
            // Most recently used goes last.
            this.tables.delete(key);
            this.tables.set(key, cached);
            return { kind: 'ready', render: cached };
        }
        const failure = this.failures.get(key);
        if (failure && this.now() - failure.at < PyodideFilter.RETRY_AFTER_MS) {
            return { kind: 'unavailable', reason: failure.reason };
        }

        const t0 = typeof performance !== 'undefined' ? performance.now() : this.now();
        let samples: Float32Array | null;
        try {
            samples = renderFilteredTable(runtime.pyodide, sampleRate, shape, plan, onGrid);
        } catch (e) {
            return this.fail(key, `the Python render threw: ${e instanceof Error ? e.message.split('\n').filter(Boolean).pop() ?? e.message : String(e)}`);
        }
        if (!samples) return this.fail(key, 'the Python render returned no samples');
        // A table that is not finite would be looped into the speakers.
        if (!samples.every(Number.isFinite)) return this.fail(key, 'the Python render came back with non-finite samples');

        const buffer = ctx.createBuffer(1, samples.length, sampleRate);
        buffer.getChannelData(0).set(samples);
        const render: LoopRender = { buffer, baseFrequency: plan.baseFrequency };
        this.failures.delete(key);
        this.tables.set(key, render);
        while (this.tables.size > PyodideFilter.MAX_TABLES) {
            const oldest = this.tables.keys().next().value;
            if (oldest === undefined) break;
            this.tables.delete(oldest);
        }
        try {
            engineTelemetry.recordLatency('pyodide-filter-table', (typeof performance !== 'undefined' ? performance.now() : this.now()) - t0);
        } catch {
            /* telemetry is best-effort */
        }
        return { kind: 'ready', render };
    }

    get tableCount(): number {
        return this.tables.size;
    }

    /** Forget every table (they hold the old context's sample rate). */
    dispose(): void {
        this.tables.clear();
        this.failures.clear();
    }

    private fail(key: string, reason: string): PyodideLookup {
        this.failures.set(key, { reason, at: this.now() });
        return { kind: 'unavailable', reason };
    }
}
