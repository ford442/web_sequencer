import type { Waveform } from '../types';

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
 * Deliberately absent:
 *   - `rust`  — `rust-audio/` is a bench crate, not a live voice (it produced a
 *               main-thread `Float32Array` that was looped, duplicating the AS
 *               kernel). Legacy `rust-*` waveforms migrate to `wam-*`.
 *   - `cpp`   — never existed; the selector offered it and it silently played
 *               the JS oscillator. Legacy `cpp-*` waveforms migrate to `wam-*`.
 *   - `wasm`  — dead alias, no waveform prefix ever produced it.
 */
export type OscEngineId = 'js' | 'wav' | 'wgsl' | 'pyodide' | 'wam' | '303' | 'prophecy';
export type WaveShape = 'saw' | 'sqr' | 'tri' | 'sin';

const ENGINE_MAP: Record<string, OscEngineId> = {
    wav: 'wav',
    pyodide: 'pyodide',
    wgsl: 'wgsl',
    wam: 'wam',
    '303': '303',
    prophecy: 'prophecy',
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
 * `cpp-rand` has no equivalent anywhere (there was never a C++ oscillator); it
 * maps to the saw table, which is why the substitution must be visible.
 */
export const LEGACY_WAVEFORM_ALIASES: Record<string, Waveform> = {
    'rust-saw': 'wam-saw',
    'rust-sqr': 'wam-sqr',
    'cpp-sin': 'wam-sin',
    'cpp-saw': 'wam-saw',
    'cpp-sqr': 'wam-sqr',
    'cpp-rand': 'wam-saw',
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
        const shape = SHAPE_ALIASES[suffix] ?? 'saw';
        return { engine, shape, legacyFrom };
    }
    return { engine: 'js', shape: 'saw', legacyFrom };
}

export const shapeToOscillatorType = (s: WaveShape): OscillatorType =>
    s === 'saw' ? 'sawtooth' : s === 'sqr' ? 'square' : s === 'tri' ? 'triangle' : 'sine';
