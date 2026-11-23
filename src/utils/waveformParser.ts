import type { Waveform } from '../types';
import { DWGS_WAVES, dwgsWaveIndex } from '../engines/dwgsWaves';

/**
 * Oscillator engine families (#1294).
 *
 * There is exactly one id per *live* rendering path. An id only exists here if
 * `ENGINE_CATALOG` (src/engines/backends/engineCatalog.ts) can name the code
 * that renders it — either a registered `OscillatorBackend` or a native
 * AudioWorklet. `oscillatorEngineContract.test.ts` fails the build if the two
 * drift apart, so a family can never fall through to `OscillatorNode`
 * undocumented.
 *
 * `rust` is back (#1664) as what #1294 said it would have to be to return: a
 * live AudioWorklet voice running the no_std SIMD kernel in `rust-audio/`, not
 * a main-thread `Float32Array` looped through a buffer source.
 *
 * `cpp` exists for the first time (#1665). Before it, the selector offered it
 * and it silently played the JS oscillator; now it is a live AudioWorklet voice
 * running the C++ windowed-sinc BLEP kernel (emscripten/cpp_osc.cpp) from its
 * own standalone module, public/cpp_osc.wasm.
 *
 * `dwgs` is new (#1666): Korg's Digital Waveform Generator System as a live
 * AudioWorklet voice — harmonic-recipe waves rendered additively by a Rust
 * kernel (dwgs-audio/, public/dwgs_osc.wasm). Its suffix names a wave, not a
 * shape: `parseWaveform` reports it as `variant` and maps `shape` to the basic
 * shape the family falls back to (DWGS_WAVES[i].fallback).
 *
 * Deliberately absent:
 *   - `wasm`  — dead alias, no waveform prefix ever produced it.
 */
export type OscEngineId = 'js' | 'wav' | 'wgsl' | 'pyodide' | 'wam' | 'rust' | 'cpp' | 'dwgs' | '303' | 'prophecy' | 'macro';
export type WaveShape = 'saw' | 'sqr' | 'tri' | 'sin';

const ENGINE_MAP: Record<string, OscEngineId> = {
    wav: 'wav',
    pyodide: 'pyodide',
    wgsl: 'wgsl',
    wam: 'wam',
    rust: 'rust',
    cpp: 'cpp',
    // dwgs-<wave>: the suffix names a DWGS wave (DWGS_WAVES), not a shape.
    dwgs: 'dwgs',
    '303': '303',
    prophecy: 'prophecy',
    // macro-<model>: the suffix names a model (MACRO_ENGINES), not a shape.
    macro: 'macro',
};

const SHAPE_ALIASES: Record<string, WaveShape> = {
    saw: 'saw',
    sawtooth: 'saw',
    sqr: 'sqr',
    square: 'sqr',
    tri: 'tri',
    triangle: 'tri',
    sin: 'sin',
    sine: 'sin',
    // Prophecy's pulse carrier is a square family member for shape consumers.
    pulse: 'sqr',
};

/**
 * Waveform ids that were selectable in an older build and are still present in
 * saved songs / presets. They are rewritten to a family that actually runs,
 * once, at parse time — `parseWaveform` reports the rewrite through
 * `legacyFrom` so the substitution reaches the HUD and telemetry instead of
 * being applied behind the user's back.
 *
 * `cpp-rand` never made a sound of its own (there was no C++ oscillator at all
 * when it was offered) and the kernel has no noise shape; it maps to the C++
 * saw, which is why the substitution must be visible.
 *
 * `rust-saw` / `rust-sqr` (#1664) and `cpp-saw/sqr/tri/sin` (#1665) are no
 * longer here: those families are live, so old songs play on the kernel their
 * prefix names.
 */
export const LEGACY_WAVEFORM_ALIASES: Record<string, Waveform> = {
    'cpp-rand': 'cpp-saw',
};

/**
 * Rewrite a retired waveform id onto a live one. Safe to call on any string —
 * unknown/current ids are returned unchanged.
 */
export function normalizeWaveform(w: string): Waveform {
    return LEGACY_WAVEFORM_ALIASES[w] ?? (w as Waveform);
}

export interface ParsedWaveform {
    engine: OscEngineId;
    shape: WaveShape;
    /**
     * For families whose suffix names a timbre rather than a basic shape
     * (`dwgs`): that suffix. `shape` is then the basic shape a fallback plays.
     */
    variant?: string;
    /** Set when the requested id was retired and rewritten (see aliases above). */
    legacyFrom?: string;
}

export function parseWaveform(w: string): ParsedWaveform {
    const legacy = LEGACY_WAVEFORM_ALIASES[w];
    const id: string = legacy ?? w;
    const legacyFrom = legacy ? w : undefined;

    if (id === 'sawtooth' || id === 'square' || id === 'triangle' || id === 'sine') {
        return { engine: 'js', shape: SHAPE_ALIASES[id], legacyFrom };
    }
    const dash = id.indexOf('-');
    if (dash > 0) {
        const prefix = id.slice(0, dash);
        const suffix = id.slice(dash + 1);
        const engine = ENGINE_MAP[prefix] ?? 'js';
        if (engine === 'dwgs') {
            // An unknown DWGS wave plays the DWGS saw (the kernel's default).
            const wave = DWGS_WAVES[dwgsWaveIndex(suffix)] ?? DWGS_WAVES[0];
            return { engine, shape: wave.fallback, variant: wave.suffix, legacyFrom };
        }
        const shape = SHAPE_ALIASES[suffix] ?? 'saw';
        return { engine, shape, legacyFrom };
    }
    return { engine: 'js', shape: 'saw', legacyFrom };
}

export const shapeToOscillatorType = (s: WaveShape): OscillatorType =>
    s === 'saw' ? 'sawtooth' : s === 'sqr' ? 'square' : s === 'tri' ? 'triangle' : 'sine';
