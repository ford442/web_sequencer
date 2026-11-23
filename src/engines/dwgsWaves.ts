/**
 * The waves of the `dwgs-*` oscillator family (#1666): what each `dwgs-<wave>`
 * id plays, in kernel order.
 *
 * DWGS is Korg's Digital Waveform Generator System (DW-6000 / DW-8000):
 * single-cycle waveforms built by additive synthesis — a recipe of harmonic
 * amplitudes per wave. Hyphon's panel for it (public/osc/dwgs.webp) offers the
 * four sources SAW / SQR / NOISE / DIGITAL WAVEFORM; the digital waveforms are
 * the fourteen recipes between them. Every recipe lives in
 * dwgs-audio/src/lib.rs (`recipe`) and is original to Hyphon — the names say
 * what each one is shaped after, not which ROM it came from.
 *
 * The array index IS the kernel's wave id (`WAVE_*` in lib.rs), and the ids
 * are persisted in songs: append, never reorder.
 * `src/__tests__/dwgsOscModule.test.ts` holds the length to the kernel's
 * `dwgs_wave_count()`.
 *
 * `fallback` is the basic shape a `dwgs-*` part plays when the DWGS worklet
 * cannot run: the registry walks the one fallback order from `dwgs` with it,
 * and every step is published. No basic shape is a DWGS wave, so it is the
 * nearest harmonic family, not a substitute that sounds the same.
 */

import type { DwgsWaveform } from '../types';
import type { WaveShape } from '../utils/waveformParser';

export interface DwgsWave {
    /** The id after `dwgs-`. */
    readonly suffix: string;
    /** Three-ish letters for the variant buttons. */
    readonly short: string;
    /** What the recipe is shaped after. */
    readonly name: string;
    /** Panel source: the three plain ones, or one of the digital waveforms. */
    readonly source: 'saw' | 'sqr' | 'noise' | 'digital';
    /** Basic shape played if the family has to fall back. */
    readonly fallback: WaveShape;
}

export const DWGS_WAVES = [
    { suffix: 'saw', short: 'SAW', name: 'Sawtooth', source: 'saw', fallback: 'saw' },
    { suffix: 'sqr', short: 'SQR', name: 'Square', source: 'sqr', fallback: 'sqr' },
    { suffix: 'piano', short: 'PNO', name: 'Piano (struck string)', source: 'digital', fallback: 'saw' },
    { suffix: 'epiano', short: 'EP', name: 'Electric piano (tine)', source: 'digital', fallback: 'sin' },
    { suffix: 'clav', short: 'CLV', name: 'Clavinet (narrow pulse)', source: 'digital', fallback: 'sqr' },
    { suffix: 'organ', short: 'ORG', name: 'Organ (drawbars)', source: 'digital', fallback: 'saw' },
    { suffix: 'brass', short: 'BRS', name: 'Brass (formant at 5)', source: 'digital', fallback: 'saw' },
    { suffix: 'reed', short: 'REED', name: 'Reed (odd-heavy, formant at 7)', source: 'digital', fallback: 'sqr' },
    { suffix: 'strings', short: 'STR', name: 'Strings (bowed, two body peaks)', source: 'digital', fallback: 'saw' },
    { suffix: 'guitar', short: 'GTR', name: 'Guitar (plucked)', source: 'digital', fallback: 'tri' },
    { suffix: 'dist', short: 'DIST', name: 'Distortion guitar', source: 'digital', fallback: 'sqr' },
    { suffix: 'bass', short: 'BAS', name: 'Electric bass', source: 'digital', fallback: 'tri' },
    { suffix: 'digibass', short: 'DBS', name: 'Digital bass (resonant 6th)', source: 'digital', fallback: 'sqr' },
    { suffix: 'bell', short: 'BEL', name: 'Bell (sparse partials)', source: 'digital', fallback: 'tri' },
    { suffix: 'vox', short: 'VOX', name: 'Voice ("ah" formants)', source: 'digital', fallback: 'saw' },
    { suffix: 'sine', short: 'SIN', name: 'Sine', source: 'digital', fallback: 'sin' },
    { suffix: 'noise', short: 'NSE', name: 'Noise (keyboard-tracking)', source: 'noise', fallback: 'saw' },
] as const satisfies readonly DwgsWave[];

export type DwgsWaveSuffix = (typeof DWGS_WAVES)[number]['suffix'];

/** Every `dwgs-*` waveform id, in kernel order. */
export const DWGS_WAVEFORMS: readonly DwgsWaveform[] = DWGS_WAVES.map((w) => `dwgs-${w.suffix}` as const);

const BY_SUFFIX = new Map<string, number>(DWGS_WAVES.map((w, i) => [w.suffix, i]));

/** Kernel wave id for a suffix, or -1 when it is not a DWGS wave. */
export function dwgsWaveIndex(suffix: string | undefined): number {
    return suffix === undefined ? -1 : BY_SUFFIX.get(suffix) ?? -1;
}

/** The wave a `dwgs-*` id names, or null. */
export function dwgsWaveForWaveform(waveform: string): DwgsWave | null {
    if (!waveform.startsWith('dwgs-')) return null;
    const i = dwgsWaveIndex(waveform.slice(5));
    return i >= 0 ? DWGS_WAVES[i] : null;
}

/** Kernel wave for a basic shape, when a DWGS voice is started without a wave. */
export function dwgsWaveForShape(shape: WaveShape): number {
    switch (shape) {
        case 'sqr': return dwgsWaveIndex('sqr');
        case 'sin': return dwgsWaveIndex('sine');
        // No DWGS triangle: the plucked guitar falls as 1/k^2, as a triangle does.
        case 'tri': return dwgsWaveIndex('guitar');
        default: return dwgsWaveIndex('saw');
    }
}
