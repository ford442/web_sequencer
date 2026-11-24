/**
 * The WebGPU filter, as pure math (#1675).
 *
 * A GPU cannot be an audio-graph stage: `navigator.gpu` does not exist in an
 * `AudioWorkletGlobalScope`, and a `mapAsync` readback is asynchronous and
 * jittery (BUILD_NOTES `#wgsl-gpu`). So the WebGPU filter is not a streaming
 * IIR. It is the filter's *steady state*, evaluated per harmonic inside the
 * additive kernel that already renders the `wgsl-*` tables:
 *
 *     table[n] = Σ_h  a_h · |H(h·f0)| · sin( 2π (h·n·inc + φ_h) + arg H(h·f0) )
 *
 * `H` is the RBJ resonant biquad's complex response at the harmonic's audible
 * frequency `h·f0`, so a periodic table filtered this way is *exactly* what the
 * biquad would settle to after its transient (and, being linear, it adds no
 * partials, so a band-limited series stays band-limited). The kernel evaluates
 * `H` in f32 on the GPU; this module is the f64 mirror the tests hold it to,
 * plus the policy the note path needs around it: what a filter is called in a
 * cache, which pitches a bank serves, and which waveforms the GPU can render.
 *
 * Why the response is closed-form here and not a transfer function in `z`:
 * the cookbook biquads are the bilinear transform of the analog prototype
 * `1/(s²+s/Q+1)` (and its BP/HP siblings) prewarped at the cutoff, so at
 * `z = e^{jω}` the response is the prototype at `s = jΩ` with
 * `Ω = tan(ω/2) / tan(ω₀/2)`. That form has no cancellation near DC, which is
 * where `1 + a1 z⁻¹ + a2 z⁻²` loses all its f32 digits at a 20 Hz cutoff.
 */

import type { FilterType } from '../../types/synth';
import type { ParsedWaveform, WaveShape } from '../../utils/waveformParser';
import { midiToHz } from '../../utils/math';
import { DWGS_WAVES } from '../dwgsWaves';
import { kernelResonance, maxFilterCutoff } from './filterSource';
import { selectWavetableBand, type WavetableBand } from './wavetableBands';

/** One resonant filter: the response, the cutoff in Hz and the *linear* RBJ Q. */
export interface GpuFilterSpec {
    type: FilterType;
    cutoff: number;
    q: number;
}

/** Cutoff floor — the other kernels' clamp. */
export const GPU_FILTER_CUTOFF_MIN = 20;
/** Q range the kernel accepts (`0.1` is the other kernels' floor; 1000 keeps `1/Q` off zero). */
export const GPU_FILTER_Q_MIN = 0.1;
export const GPU_FILTER_Q_MAX = 1000;

/** The knob values a voice has, as the spec the kernel takes (same clamps as every other filter source). */
export function gpuFilterSpec(
    type: FilterType,
    cutoff: number,
    knobResonance: number,
    sampleRate: number,
): GpuFilterSpec {
    const hz = Number.isFinite(cutoff) ? cutoff : maxFilterCutoff(sampleRate);
    return {
        type,
        cutoff: Math.max(GPU_FILTER_CUTOFF_MIN, Math.min(maxFilterCutoff(sampleRate), hz)),
        q: Math.max(GPU_FILTER_Q_MIN, Math.min(GPU_FILTER_Q_MAX, kernelResonance(type, knobResonance))),
    };
}

// ── Cache keys ───────────────────────────────────────────────────────────────

/** Cutoff grid: 1/24 octave, so a cutoff is at most 1.5 % from the one asked for. */
export const CUTOFF_STEPS_PER_OCTAVE = 24;
/** Q grid: 1/8 octave, so Q is at most 4.5 % (0.4 dB) from the one asked for. */
export const Q_STEPS_PER_OCTAVE = 8;

export interface QuantizedGpuFilter {
    /** The filter a bank is actually baked for: on the grid, so a sweep reuses banks. */
    spec: GpuFilterSpec;
    /** Stable cache key for `spec` (and the sample rate). */
    key: string;
}

/**
 * Snap a filter onto the cache grid. A bank costs a dispatch and a ~2 MB
 * readback, and a knob sweep asks for a new cutoff every frame; on the grid
 * the same bank serves every request inside one cell, and the sound is
 * within a cutoff step nobody can hear (1/24 octave ≈ 3 cents of cutoff).
 */
export function quantizeGpuFilter(spec: GpuFilterSpec, sampleRate: number): QuantizedGpuFilter {
    const kc = Math.round(CUTOFF_STEPS_PER_OCTAVE * Math.log2(spec.cutoff));
    const kq = Math.round(Q_STEPS_PER_OCTAVE * Math.log2(spec.q));
    const cutoff = Math.max(
        GPU_FILTER_CUTOFF_MIN,
        Math.min(maxFilterCutoff(sampleRate), 2 ** (kc / CUTOFF_STEPS_PER_OCTAVE)),
    );
    const q = Math.max(GPU_FILTER_Q_MIN, Math.min(GPU_FILTER_Q_MAX, 2 ** (kq / Q_STEPS_PER_OCTAVE)));
    return {
        spec: { type: spec.type, cutoff, q },
        key: `${spec.type}:${kc}:${kq}@${sampleRate}`,
    };
}

// ── The response and the series (f64 mirrors of the WGSL) ────────────────────

export interface Complex {
    re: number;
    im: number;
}

/**
 * The RBJ biquad's complex response at `hz`, exact for the cookbook filters
 * (and so for `BiquadFilterNode`, whose lowpass / highpass `Q` is the dB value
 * `kernelResonance` already converted). BP is the constant-0-dB-peak one.
 */
export function filterResponse(spec: GpuFilterSpec, hz: number, sampleRate: number): Complex {
    const t0 = Math.tan((Math.PI * spec.cutoff) / sampleRate);
    const x = Math.tan((Math.PI * hz) / sampleRate);
    const w = x / t0;
    const dr = 1 - w * w;
    const di = w / spec.q;
    const den = Math.max(dr * dr + di * di, 1e-30);
    // N · conj(D) for N = 1 (LP), j·di (BP), −w² (HP), D = dr + j·di.
    switch (spec.type) {
        case 'bp':
            return { re: (di * di) / den, im: (di * dr) / den };
        case 'hp':
            return { re: (-w * w * dr) / den, im: (w * w * di) / den };
        default:
            return { re: dr / den, im: -di / den };
    }
}

/**
 * Harmonic `h` of a shape as the kernel sums it: an amplitude, and whether it
 * is a cosine series (triangle) rather than a sine one. Same series, signs and
 * levels as the naive shapes they replace (see `WebGpuOscillator`):
 *
 *   saw  −(2/π) sin(hθ)/h          all h
 *   sqr   (4/π) sin(hθ)/h          odd h
 *   tri   (8/π²) cos(hθ)/h²        odd h
 *   sin   sin(θ)                   h = 1
 */
export function seriesTerm(shape: WaveShape, h: number): { amp: number; cosine: boolean } {
    const odd = (h & 1) === 1;
    switch (shape) {
        case 'saw':
            return { amp: -2 / (Math.PI * h), cosine: false };
        case 'sqr':
            return { amp: odd ? 4 / (Math.PI * h) : 0, cosine: false };
        case 'tri':
            return { amp: odd ? 8 / (Math.PI * Math.PI * h * h) : 0, cosine: true };
        default:
            return { amp: h === 1 ? 1 : 0, cosine: false };
    }
}

/** What the kernel's first pass stores per harmonic: `gain · sin(2π(h·phase + cycles))`. */
export interface HarmonicCoefficient {
    gain: number;
    /** Phase offset in cycles, in [0, 1). */
    cycles: number;
}

/**
 * The kernel's coefficient pass, in f64. `f0` is the *audible* fundamental in
 * Hz (the pitch the table sounds at after `playbackRate`, or the note itself
 * for an offline render) — the filter acts on `h·f0`, not on the table's own
 * rate. A null `spec` is "no filter" (the unfiltered tables).
 */
export function harmonicCoefficient(
    shape: WaveShape,
    h: number,
    f0: number,
    sampleRate: number,
    spec: GpuFilterSpec | null,
): HarmonicCoefficient {
    const { amp, cosine } = seriesTerm(shape, h);
    let gain = 0;
    let phi = 0;
    if (amp !== 0) {
        if (!spec) {
            gain = amp;
        } else if ((h * f0) / sampleRate < 0.4999) {
            const r = filterResponse(spec, h * f0, sampleRate);
            gain = amp * Math.hypot(r.re, r.im);
            phi = Math.atan2(r.im, r.re);
        }
        // Σ a|H| cos(θ + φ) = Σ a|H| sin(θ + φ + π/2)
        if (cosine) phi += Math.PI / 2;
    }
    const cycles = phi / (2 * Math.PI);
    return { gain, cycles: cycles - Math.floor(cycles) };
}

/**
 * The kernel's synthesis pass, in f64: `length` samples of the series with the
 * filter applied, phase taken exactly (`n · increment` modulo one cycle, where
 * `increment` is the cycles per sample as the shader's fixed point sees them).
 */
export function referenceWaveform(opts: {
    shape: WaveShape;
    /** Cycles per sample of the *table* (`phaseIncrement / 2^32`). */
    cyclesPerSample: number;
    maxHarmonic: number;
    /** Audible fundamental in Hz. */
    f0: number;
    sampleRate: number;
    spec: GpuFilterSpec | null;
    length: number;
}): Float64Array {
    const { shape, cyclesPerSample, maxHarmonic, f0, sampleRate, spec, length } = opts;
    const coefs: HarmonicCoefficient[] = [];
    for (let h = 1; h <= maxHarmonic; h++) coefs.push(harmonicCoefficient(shape, h, f0, sampleRate, spec));
    const out = new Float64Array(length);
    for (let n = 0; n < length; n++) {
        let sum = 0;
        for (let h = 1; h <= maxHarmonic; h++) {
            const c = coefs[h - 1];
            if (c.gain === 0) continue;
            // (h·n·inc) mod 1, computed without letting n·inc grow large first.
            const cycles = (((h * n * cyclesPerSample) % 1) + c.cycles) % 1;
            sum += c.gain * Math.sin(2 * Math.PI * cycles);
        }
        out[n] = sum;
    }
    return out;
}

// ── The note bank ────────────────────────────────────────────────────────────

/** Lowest / highest MIDI note a bank serves (C0 – G9, the range `wavetableBands.test.ts` covers). */
export const BANK_MIDI_LOW = 12;
export const BANK_MIDI_HIGH = 127;
export const BANK_NOTE_COUNT = BANK_MIDI_HIGH - BANK_MIDI_LOW + 1;

/**
 * The bank note nearest `frequency`, or null when the pitch is outside the
 * bank (or not a number): the voice then uses its native filter instead of a
 * table whose cutoff would be wrong by more than a semitone's worth.
 */
export function nearestBankNote(frequency: number): number | null {
    if (!Number.isFinite(frequency) || frequency <= 0) return null;
    const midi = Math.round(69 + 12 * Math.log2(frequency / 440));
    return midi >= BANK_MIDI_LOW && midi <= BANK_MIDI_HIGH ? midi : null;
}

export interface BankNote {
    midi: number;
    /** The audible fundamental the table's filter response is evaluated at. */
    f0: number;
    /** Index into the band plan: the table's own pitch and harmonic count. */
    band: number;
}

/**
 * One table per MIDI note. Each note's table is filtered for *its* pitch (the
 * response is evaluated at `h · f0`), because a looped table is pitched with
 * `playbackRate` and a cutoff baked in table time would follow the pitch.
 *
 * The band is the one serving the note's *upper* edge (a quarter tone above
 * it), so the table's highest harmonic stays under Nyquist for every pitch
 * the note's table is asked to play (the nearest-note rounding is ± 50 cents).
 */
export function planFilteredBank(bands: readonly WavetableBand[]): BankNote[] {
    const notes: BankNote[] = [];
    if (bands.length === 0) return notes;
    for (let midi = BANK_MIDI_LOW; midi <= BANK_MIDI_HIGH; midi++) {
        const f0 = midiToHz(midi);
        notes.push({ midi, f0, band: selectWavetableBand(bands, f0 * 2 ** (1 / 24)) });
    }
    return notes;
}

// ── What the GPU can render ──────────────────────────────────────────────────

/**
 * Why the GPU filter cannot render `parsed`, or null when it can. It renders
 * the four basic shapes, so any host's `saw` / `sqr` / `tri` / `sin` is
 * filterable (a basic shape is a basic shape on any engine); a DWGS digital
 * wave (piano, bell, …) or noise is not one, and is refused rather than
 * played as a different wave.
 */
export function gpuFilterRefusal(parsed: ParsedWaveform): string | null {
    if (parsed.variant === undefined) return null;
    const wave = DWGS_WAVES.find((w) => w.suffix === parsed.variant);
    if (wave && (wave.source === 'saw' || wave.source === 'sqr' || wave.suffix === 'sine')) return null;
    return `"${parsed.engine}-${parsed.variant}" is not a basic shape the WebGPU filter can render`;
}
