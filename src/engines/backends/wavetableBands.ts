/**
 * Band plan for the `wgsl-*` pre-rendered wavetables (#1668).
 *
 * The WebGPU backend used to render one naive 2 s table per shape at C4 and
 * resample it with `playbackRate` for every pitch. That table aliased (naive
 * saw/square edges, and every harmonic above Nyquist once a note was pitched
 * up), and it clicked on every wrap (2 s at 261.63 Hz is 523.26 cycles).
 *
 * Now each shape gets one table per octave band, rendered additively on the
 * GPU with only the harmonics that stay under Nyquist anywhere in that band:
 *
 *   - A table holds a whole number of cycles in `WAVETABLE_LENGTH` samples, so
 *     it loops without a seam.
 *   - `WAVETABLE_LENGTH` is a power of two, so the 32-bit fixed-point phase
 *     increment `cycles * 2^32 / length` is an exact integer: the shader's
 *     phase never drifts and sample `length` is exactly sample 0 again.
 *   - `baseFrequency` is `cycles * sampleRate / length` exactly, so
 *     `playbackRate = f / baseFrequency` is in tune without correction.
 *   - Band `i` serves `[base_i, base_{i+1})`. It holds harmonics up to
 *     `nyquist / base_{i+1}`, so the highest one stays under Nyquist even at
 *     the top of the band. The last band is a pure sine and serves everything
 *     above it.
 *
 * Pure and synchronous: the shader (`WebGpuOscillator`) and the note path
 * (`WebGpuBackend.renderLoop`) both read the same plan.
 */

import type { WaveShape } from '../../utils/waveformParser';

/** Samples per table. Power of two: keeps the phase increment an exact integer. */
export const WAVETABLE_LENGTH = 4096;

/** Nominal base of the lowest band (A0). Bands are octaves above it. */
export const WAVETABLE_LOWEST_HZ = 27.5;

/**
 * Most harmonics a single sample sums. At 48 kHz the lowest band needs ~410;
 * the cap bounds a GPU invocation for an offline `generate` of a very low note
 * (the harmonics it drops are above 20 kHz for any fundamental over ~20 Hz).
 */
export const MAX_HARMONICS = 1024;

/** Shape → index in the shader's `switch`. Keep in step with the WGSL. */
export const SHAPE_INDEX: Readonly<Record<WaveShape, number>> = {
    saw: 0,
    sqr: 1,
    tri: 2,
    sin: 3,
};

export interface WavetableBand {
    /** Whole cycles in one `WAVETABLE_LENGTH`-sample table. */
    cycles: number;
    /** Pitch of the table at `playbackRate` 1.0, in Hz (exact). */
    baseFrequency: number;
    /** Highest harmonic number rendered (odd shapes use the odd ones ≤ this). */
    maxHarmonic: number;
    /** 32-bit fixed-point phase increment per sample: `cycles * 2^32 / length`. */
    phaseIncrement: number;
}

/**
 * The octave bands for `sampleRate`. Deterministic: the shader render and
 * `selectWavetableBand` must agree, so both call this with the same arguments.
 */
export function planWavetableBands(sampleRate: number, length: number = WAVETABLE_LENGTH): WavetableBand[] {
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) return [];
    if (!Number.isInteger(length) || length < 2 || (length & (length - 1)) !== 0) {
        throw new Error(`wavetable length must be a power of two, got ${length}`);
    }
    const nyquist = sampleRate / 2;

    // Whole-cycle counts for each nominal octave, deduplicated (at high sample
    // rates the lowest octaves can round to the same count).
    const cycles: number[] = [];
    for (let nominal = WAVETABLE_LOWEST_HZ; nominal < nyquist; nominal *= 2) {
        const c = Math.max(1, Math.round((nominal * length) / sampleRate));
        if (c >= length / 2) break;
        if (cycles.length === 0 || c > cycles[cycles.length - 1]) cycles.push(c);
    }

    const bands: WavetableBand[] = [];
    for (let i = 0; i < cycles.length; i++) {
        const baseFrequency = (cycles[i] * sampleRate) / length;
        // The band tops out at the next band's base; the last one has no top,
        // so it must be a sine.
        const top = i + 1 < cycles.length ? (cycles[i + 1] * sampleRate) / length : Number.POSITIVE_INFINITY;
        const maxHarmonic = Math.min(MAX_HARMONICS, Math.max(1, Math.floor(nyquist / top)));
        bands.push({
            cycles: cycles[i],
            baseFrequency,
            maxHarmonic,
            phaseIncrement: fixedPointIncrement(cycles[i], length),
        });
        // Every band above a sine band would also be a sine: this one covers them.
        if (maxHarmonic === 1) break;
    }
    // Defensive: the loop above always ends on a sine band, but if `cycles`
    // ran out first, the last band still has to be safe at any pitch.
    const last = bands[bands.length - 1];
    if (last && last.maxHarmonic !== 1) last.maxHarmonic = 1;
    return bands;
}

/** The band that serves `frequency`: the highest whose base is at or below it. */
export function selectWavetableBand(bands: readonly WavetableBand[], frequency: number): number {
    if (bands.length === 0) return -1;
    if (!Number.isFinite(frequency)) return 0;
    let index = 0;
    for (let i = 1; i < bands.length; i++) {
        if (bands[i].baseFrequency <= frequency) index = i;
        else break;
    }
    return index;
}

/** `cycles * 2^32 / length` — exact because `length` is a power of two. */
function fixedPointIncrement(cycles: number, length: number): number {
    return ((cycles * 2 ** 32) / length) >>> 0;
}

/**
 * Fixed-point phase increment for an arbitrary pitch (offline `generate`), or
 * null when the pitch is not renderable (non-finite, ≤ 0, or at/above Nyquist).
 */
export function phaseIncrementFor(frequency: number, sampleRate: number): number | null {
    if (!Number.isFinite(frequency) || !Number.isFinite(sampleRate) || frequency <= 0 || sampleRate <= 0) {
        return null;
    }
    if (frequency >= sampleRate / 2) return null;
    return Math.round((frequency / sampleRate) * 2 ** 32) >>> 0;
}

/** Highest harmonic under Nyquist for a fixed pitch, capped at `MAX_HARMONICS`. */
export function maxHarmonicFor(frequency: number, sampleRate: number): number {
    if (!(frequency > 0) || !(sampleRate > 0)) return 0;
    return Math.min(MAX_HARMONICS, Math.floor(sampleRate / 2 / frequency));
}
