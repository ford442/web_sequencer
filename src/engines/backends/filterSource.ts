/**
 * Which filter shapes a voice, and how a host oscillator engine is told (#1663, #1672, #1673, #1674, #1675).
 *
 * A voice's resonant filter has two independent choices:
 *   - `filterType`   low / band / high pass;
 *   - `filterSource` whose DSP runs it: the voice's own `BiquadFilterNode`
 *     (`native`), the AssemblyScript kernel's biquad (`wam`, "WASM OSC"), the
 *     Rust kernel's (`rust`), the C++ kernel's state variable filter (`cpp`) or
 *     the DWGS kernel's 4-pole ladder (`dwgs`, the one that sounds different) or
 *     the GPU's table filter (`webgpu`: the shape rendered with the filter in
 *     every harmonic, because a GPU cannot be a worklet stage).
 *
 * The wasm filters are *stages* after the oscillator, not features of the
 * `wam-*` / `rust-*` / `cpp-*` / `dwgs-*` oscillators — so any host engine (JS, Rust, C++,
 * DWGS, WebGPU, Pyodide, WAV, WASM OSC) can be filtered by any of them. This module is the pure policy
 * half: ids, labels, validation, and the one rule about what a host that bakes
 * a filter into its table must be asked to do. `Voice` owns the graph half.
 */

import type { FilterSource, FilterType, OscillatorType, SynthParams } from '../../types/synth';
import type { LoopRender } from './OscillatorBackend';
import type { FilterPairing } from '../../utils/engineTelemetry/fallbackReporting';

export const FILTER_TYPES: readonly FilterType[] = ['lp', 'bp', 'hp'] as const;
export const FILTER_SOURCES: readonly FilterSource[] = ['native', 'wam', 'rust', 'cpp', 'dwgs', 'webgpu', 'pyodide'] as const;

/** The sources that run in a wasm worklet stage (not the voice's own biquad, and not a table filter). */
export const STAGED_FILTER_SOURCES: readonly Exclude<FilterSource, 'native' | TableFilterSource>[] = ['wam', 'rust', 'cpp', 'dwgs'] as const;

/**
 * The sources that cannot be a stage because their DSP cannot run in an
 * AudioWorklet (a GPU, a Python runtime): they render a *filtered table* ahead of
 * time, and the voice loops it with nothing behind it (#1675, #1676).
 */
export type TableFilterSource = Extract<FilterSource, 'webgpu' | 'pyodide'>;

export function isTableFilterSource(source: FilterSource): source is TableFilterSource {
    return source === 'webgpu' || source === 'pyodide';
}

/** Kernel response ids — `FILTER_LP/BP/HP` in assembly/biquad.ts and rust-audio/src/lib.rs, `kFilter*` in emscripten/cpp_osc.cpp, `FILTER_*` in dwgs-audio/src/lib.rs. */
export const FILTER_TYPE_ID: Record<FilterType, number> = { lp: 0, bp: 1, hp: 2 };

export const FILTER_TYPE_LABELS: Record<FilterType, string> = {
    lp: 'Low pass',
    bp: 'Band pass',
    hp: 'High pass',
};

/**
 * Display labels. `native` is the "JS" filter — the voice's own `BiquadFilterNode`,
 * the terminal fallback that needs no wasm, GPU or Python. `wam` is Hyphon's AssemblyScript kernel — "WASM OSC" in the
 * UI, same as the oscillator (`BACKEND_LABELS.wam`) — NOT Web Audio Modules 2.0.
 * `rust` is the Rust kernel, "Rust" like its oscillator; `cpp` the C++ kernel, "C++"; `dwgs` the DWGS kernel, "DWGS";
 * `webgpu` the GPU, "WebGPU" like its oscillator (`BACKEND_LABELS.webgpu`);
 * `pyodide` the NumPy / SciPy runtime, "Pyodide" like its oscillator (`BACKEND_LABELS.pyodide`).
 */
export const FILTER_SOURCE_LABELS: Record<FilterSource, string> = {
    native: 'JS',
    wam: 'WASM OSC',
    rust: 'Rust',
    cpp: 'C++',
    dwgs: 'DWGS',
    webgpu: 'WebGPU',
    pyodide: 'Pyodide',
};

/** What each source's button says it is. */
export const FILTER_SOURCE_DESCRIPTIONS: Record<FilterSource, string> = {
    native: 'The JS filter: the voice\'s own graph-native Web Audio biquad (LP/BP/HP). Always available — the terminal fallback every other filter source drops back to',
    wam: 'The AssemblyScript kernel\'s resonant filter, applied to this oscillator',
    rust: 'The Rust kernel\'s resonant filter, applied to this oscillator',
    cpp: 'The C++ kernel\'s resonant state variable filter, applied to this oscillator',
    dwgs: 'The DWGS kernel\'s 24 dB/oct ladder filter with saturated resonance (DW-8000 style), applied to this oscillator',
    webgpu: 'The filter rendered on the GPU into a looped table of this part\'s saw / square / triangle / sine, whichever oscillator it names (a GPU cannot run inside the audio thread)',
    pyodide: 'SciPy\'s resonant filter, rendered in Python into a looped table of this part\'s saw / square / triangle / sine, whichever oscillator it names (Python cannot run inside the audio thread)',
};

/**
 * Which filter source is each oscillator family's *own* filter (#1663): the
 * cross-product is "OSC A, filtered by OSC B's filter", so every family is
 * classified here and the contract test fails when a new one is not.
 *
 *   - a `FilterSource` — the family's filter, selectable by every other family;
 *   - `null` — it has none another family can borrow: `pcm` plays recorded
 *     samples, and the 303 / Prophecy / Macro worklets keep their filters
 *     inside their own voices (and never run through `Voice`'s filter stage).
 */
export const OWN_FILTER_SOURCE: Record<OscillatorType, FilterSource | null> = {
    javascript: 'native',
    pcm: null,
    pyodide: 'pyodide',
    webgpu: 'webgpu',
    wam: 'wam',
    rust: 'rust',
    cpp: 'cpp',
    dwgs: 'dwgs',
    open303: null,
    jc303: null,
    prophecy: null,
    macro: null,
};

/** Short response label (the selector's buttons and the HUD). */
export const FILTER_TYPE_SHORT: Record<FilterType, string> = { lp: 'LP', bp: 'BP', hp: 'HP' };

/**
 * Degradation-store id of "this source could not run": one per source, so a
 * voice that is fine on one wasm filter does not resolve another's report.
 */
export function filterSourceIssueId(source: FilterSource): string {
    return `filter-source:${source}`;
}

export const DEFAULT_FILTER_TYPE: FilterType = 'lp';
export const DEFAULT_FILTER_SOURCE: FilterSource = 'native';

const warned = new Set<string>();
function warnOnce(kind: string, value: unknown, fallback: string): void {
    const key = `${kind}:${String(value)}`;
    if (warned.has(key)) return;
    warned.add(key);
    console.warn(`[FilterSource] unknown ${kind} ${JSON.stringify(value)}; using "${fallback}"`);
}

/** `undefined` is the default (an old song); anything else unknown is reported, not hidden. */
export function resolveFilterType(value: unknown): FilterType {
    if (value === undefined || value === null) return DEFAULT_FILTER_TYPE;
    if ((FILTER_TYPES as readonly unknown[]).includes(value)) return value as FilterType;
    warnOnce('filterType', value, DEFAULT_FILTER_TYPE);
    return DEFAULT_FILTER_TYPE;
}

export function resolveFilterSource(value: unknown): FilterSource {
    if (value === undefined || value === null) return DEFAULT_FILTER_SOURCE;
    if ((FILTER_SOURCES as readonly unknown[]).includes(value)) return value as FilterSource;
    warnOnce('filterSource', value, DEFAULT_FILTER_SOURCE);
    return DEFAULT_FILTER_SOURCE;
}

/** Test seam: forget which unknown values were already reported. */
export function resetFilterSourceWarningsForTests(): void {
    warned.clear();
}

/** The `BiquadFilterNode` type that is the same response as the kernel's. */
export function biquadTypeFor(type: FilterType): BiquadFilterType {
    return type === 'bp' ? 'bandpass' : type === 'hp' ? 'highpass' : 'lowpass';
}

/**
 * The kernel's Q for the voice's resonance knob, so the same knob sounds the
 * same on either filter source.
 *
 * `BiquadFilterNode` reads `Q` as **dB** for a lowpass / highpass (its RBJ Q is
 * 10^(Q/20)) and as a linear Q for a bandpass; the kernel's biquad takes the
 * linear RBJ Q directly. So the kernel is fed 10^(knob/20) for lp / hp and the
 * knob as is for bp.
 */
export function kernelResonance(type: FilterType, knob: number): number {
    const q = type === 'bp' ? knob : Math.pow(10, knob / 20);
    return Math.max(0.1, Number.isFinite(q) ? q : FLAT_RESONANCE);
}

/** Highest cutoff the kernels accept (`sampleRate / 2.1`), i.e. "open" for a low / band pass. */
export function maxFilterCutoff(sampleRate: number): number {
    return sampleRate / 2.1;
}

/** Q of a flat (Butterworth) response. */
export const FLAT_RESONANCE = Math.SQRT1_2;

/** The filter fields of a `GenerateRequest`. */
export interface HostFilterRequest {
    cutoff: number;
    resonance: number;
    filterType: FilterType;
}

/**
 * What to ask a host engine that bakes a filter into its table (`wam-*`, and
 * `pyodide-*` for a lowpass) to do, given the filter that will actually run
 * on the voice (`effective`).
 *
 * The rule is: the table's own filter and the voice's filter must not both
 * shape the sound unless it is the legacy case.
 *   - effective source `wam` / `rust` / `cpp` / `dwgs` — the wasm stage after the host does the
 *     filtering, so the host's own filter is opened (`cutoff` at its maximum,
 *     flat Q); filtering twice would square the response. (`webgpu` plays its
 *     own table and never asks a host for one; if asked it is opened too.)
 *   - effective `native` + `lp` — unchanged from before this feature: the table
 *     is lowpassed at the voice's cutoff and the `BiquadFilterNode` lowpasses it
 *     again. (Saved songs keep sounding as they did.)
 *   - effective `native` + `bp` / `hp` — the host is opened, because a baked
 *     lowpass at the same cutoff in front of a band/high pass would leave
 *     almost nothing.
 *
 * `effective` is what the voice resolved after availability checks — never the
 * raw request, or a fallen-back voice would get an opened table and a native
 * filter with nothing behind it.
 */
export function hostFilterRequest(
    params: Pick<SynthParams, 'filterCutoff' | 'filterResonance'>,
    effective: { source: FilterSource; type: FilterType },
    sampleRate: number,
): HostFilterRequest {
    const legacyLowpass = effective.source === 'native' && effective.type === 'lp';
    if (!legacyLowpass) {
        return { cutoff: maxFilterCutoff(sampleRate), resonance: FLAT_RESONANCE, filterType: 'lp' };
    }
    return {
        cutoff: Math.max(20, Math.min(maxFilterCutoff(sampleRate), params.filterCutoff)),
        resonance: Math.max(0.1, params.filterResonance),
        filterType: 'lp',
    };
}

/** The filter that will sound for one note, after availability checks (`Voice.planFilter`). */
export interface FilterPlan {
    source: FilterSource;
    type: FilterType;
    /** `webgpu` / `pyodide` only: the note's table, already filtered (the host oscillator is not used). */
    tableLoop?: LoopRender;
    /** The requested table filter is still being made; `source` is the native filter meanwhile (same response). */
    warming?: boolean;
    /** Why the requested source is not the one in `source` (a fallback). */
    fallbackReason?: string;
}

/**
 * One note's cell of the host × filter-source cross-product, as the EngineHUD
 * shows it (#1663): the part's oscillator family (`host`, a display label), the
 * source it asked for, and the plan that actually sounds.
 */
export function filterPairing(host: string, requested: FilterSource, plan: FilterPlan): FilterPairing {
    return {
        host,
        requested: FILTER_SOURCE_LABELS[requested],
        active: FILTER_SOURCE_LABELS[plan.source],
        type: FILTER_TYPE_SHORT[plan.type],
        replacesHost: !!plan.tableLoop,
        warming: plan.warming,
        fallbackReason: plan.fallbackReason,
    };
}
