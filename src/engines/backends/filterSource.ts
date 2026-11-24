/**
 * Which filter shapes a voice, and how a host oscillator engine is told (#1663, #1672, #1673).
 *
 * A voice's resonant filter has two independent choices:
 *   - `filterType`   low / band / high pass;
 *   - `filterSource` whose DSP runs it: the voice's own `BiquadFilterNode`
 *     (`native`), the AssemblyScript kernel's biquad (`wam`, "WASM OSC"), the
 *     Rust kernel's (`rust`) or the C++ kernel's state variable filter (`cpp`).
 *
 * The wasm filters are *stages* after the oscillator, not features of the
 * `wam-*` / `rust-*` / `cpp-*` oscillators — so any host engine (JS, Rust, C++,
 * DWGS, WebGPU, Pyodide, WAV, WASM OSC) can be filtered by any of them. This module is the pure policy
 * half: ids, labels, validation, and the one rule about what a host that bakes
 * a filter into its table must be asked to do. `Voice` owns the graph half.
 */

import type { FilterSource, FilterType, SynthParams } from '../../types/synth';

export const FILTER_TYPES: readonly FilterType[] = ['lp', 'bp', 'hp'] as const;
export const FILTER_SOURCES: readonly FilterSource[] = ['native', 'wam', 'rust', 'cpp'] as const;

/** The sources that run in a wasm worklet stage (everything but the voice's own biquad). */
export const STAGED_FILTER_SOURCES: readonly Exclude<FilterSource, 'native'>[] = ['wam', 'rust', 'cpp'] as const;

/** Kernel response ids — `FILTER_LP/BP/HP` in assembly/biquad.ts and rust-audio/src/lib.rs, `kFilter*` in emscripten/cpp_osc.cpp. */
export const FILTER_TYPE_ID: Record<FilterType, number> = { lp: 0, bp: 1, hp: 2 };

export const FILTER_TYPE_LABELS: Record<FilterType, string> = {
    lp: 'Low pass',
    bp: 'Band pass',
    hp: 'High pass',
};

/**
 * Display labels. `wam` is Hyphon's AssemblyScript kernel — "WASM OSC" in the
 * UI, same as the oscillator (`BACKEND_LABELS.wam`) — NOT Web Audio Modules 2.0.
 * `rust` is the Rust kernel, "Rust" like its oscillator; `cpp` the C++ kernel, "C++".
 */
export const FILTER_SOURCE_LABELS: Record<FilterSource, string> = {
    native: 'Native',
    wam: 'WASM OSC',
    rust: 'Rust',
    cpp: 'C++',
};

/** What each source's button says it is. */
export const FILTER_SOURCE_DESCRIPTIONS: Record<FilterSource, string> = {
    native: 'The voice\'s own Web Audio biquad filter',
    wam: 'The AssemblyScript kernel\'s resonant filter, applied to this oscillator',
    rust: 'The Rust kernel\'s resonant filter, applied to this oscillator',
    cpp: 'The C++ kernel\'s resonant state variable filter, applied to this oscillator',
};

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
 *   - effective source `wam` / `rust` / `cpp` — the wasm stage after the host does the
 *     filtering, so the host's own filter is opened (`cutoff` at its maximum,
 *     flat Q); filtering twice would square the response.
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
