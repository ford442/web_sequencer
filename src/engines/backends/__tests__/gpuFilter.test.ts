// The WebGPU filter's pure half (#1675): the f64 mirror of what the kernel's
// coefficient and synthesis passes compute, the cache grid, the note bank plan
// and what the GPU can render. The kernel itself is held to this mirror in
// WebGpuOscillator.test.ts (shader text / uniform layout) and, on a real
// adapter, by tools/measure_gpu_filter.mjs.

import { describe, expect, it } from 'vitest';
import {
    BANK_MIDI_HIGH,
    BANK_MIDI_LOW,
    BANK_NOTE_COUNT,
    CUTOFF_STEPS_PER_OCTAVE,
    GPU_FILTER_CUTOFF_MIN,
    GPU_FILTER_Q_MAX,
    filterResponse,
    gpuFilterRefusal,
    gpuFilterSpec,
    harmonicCoefficient,
    nearestBankNote,
    planFilteredBank,
    quantizeGpuFilter,
    referenceWaveform,
    seriesTerm,
    type GpuFilterSpec,
} from '../gpuFilter';
import { kernelResonance, maxFilterCutoff } from '../filterSource';
import { planWavetableBands } from '../wavetableBands';
import { midiToHz } from '../../../utils/math';
import { parseWaveform, type WaveShape } from '../../../utils/waveformParser';
import type { FilterType } from '../../../types/synth';

const SR = 48000;

/** The Audio EQ Cookbook biquad, written out independently of the closed form under test. */
function cookbook(type: FilterType, fc: number, q: number, sr: number) {
    const w0 = (2 * Math.PI * fc) / sr;
    const cos = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * q);
    let b: [number, number, number];
    if (type === 'lp') b = [(1 - cos) / 2, 1 - cos, (1 - cos) / 2];
    else if (type === 'hp') b = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
    else b = [alpha, 0, -alpha];
    const a0 = 1 + alpha;
    return { b: b.map((v) => v / a0) as [number, number, number], a: [(-2 * cos) / a0, (1 - alpha) / a0] as [number, number] };
}

/** |H| and arg H of the cookbook biquad at `hz`, from its coefficients (f64, so no cancellation trouble). */
function cookbookResponse(type: FilterType, fc: number, q: number, hz: number, sr: number) {
    const { b, a } = cookbook(type, fc, q, sr);
    const w = (2 * Math.PI * hz) / sr;
    const e1 = { re: Math.cos(w), im: -Math.sin(w) };
    const e2 = { re: Math.cos(2 * w), im: -Math.sin(2 * w) };
    const num = { re: b[0] + b[1] * e1.re + b[2] * e2.re, im: b[1] * e1.im + b[2] * e2.im };
    const den = { re: 1 + a[0] * e1.re + a[1] * e2.re, im: a[0] * e1.im + a[1] * e2.im };
    const d = den.re * den.re + den.im * den.im;
    return { re: (num.re * den.re + num.im * den.im) / d, im: (num.im * den.re - num.re * den.im) / d };
}

/** Run the cookbook biquad (direct form I, f64) over `x`. */
function runBiquad(type: FilterType, fc: number, q: number, sr: number, x: Float64Array): Float64Array {
    const { b, a } = cookbook(type, fc, q, sr);
    const y = new Float64Array(x.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let n = 0; n < x.length; n++) {
        const v = b[0] * x[n] + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
        x2 = x1; x1 = x[n]; y2 = y1; y1 = v;
        y[n] = v;
    }
    return y;
}

describe('filterResponse', () => {
    const TYPES: FilterType[] = ['lp', 'bp', 'hp'];

    it.each(TYPES)('%s: equals the cookbook biquad\'s response at every probe (the bilinear identity)', (type) => {
        for (const fc of [20, 90, 440, 1800, 7200, 19000]) {
            for (const q of [0.1, 0.707, 2, 12, 80]) {
                for (const hz of [10, 55, 220, 880, 3520, 9000, 15000, 23000]) {
                    const ours = filterResponse({ type, cutoff: fc, q }, hz, SR);
                    const ref = cookbookResponse(type, fc, q, hz, SR);
                    const scale = Math.max(1e-9, Math.hypot(ref.re, ref.im));
                    // The two forms agree to f64 rounding of the cookbook's cancelling denominator.
                    expect(Math.hypot(ours.re - ref.re, ours.im - ref.im) / scale).toBeLessThan(1e-6);
                }
            }
        }
    });

    it('has the textbook landmarks: 0 dB passband, -3 dB at a flat cutoff, Q at a resonant cutoff', () => {
        const flat = Math.SQRT1_2;
        const mag = (spec: GpuFilterSpec, hz: number) => {
            const r = filterResponse(spec, hz, SR);
            return Math.hypot(r.re, r.im);
        };
        const lp = { type: 'lp', cutoff: 1000, q: flat } as const;
        expect(mag(lp, 10)).toBeCloseTo(1, 3);
        expect(mag(lp, 1000)).toBeCloseTo(Math.SQRT1_2, 6);
        expect(mag({ type: 'lp', cutoff: 1000, q: 10 }, 1000)).toBeCloseTo(10, 6);
        // Constant 0 dB peak band pass, like BiquadFilterNode.
        expect(mag({ type: 'bp', cutoff: 1000, q: 8 }, 1000)).toBeCloseTo(1, 6);
        expect(mag({ type: 'hp', cutoff: 1000, q: flat }, 20000)).toBeCloseTo(1, 2);
        // -12 dB / octave well below Nyquist (the bilinear map steepens it as ω → π).
        const low = { type: 'lp', cutoff: 200, q: flat } as const;
        expect(20 * Math.log10(mag(low, 1600) / mag(low, 800))).toBeCloseTo(-12, 0);
    });

    it('stays finite where the closed form is most stressed (20 Hz cutoff, near-Nyquist harmonic, huge Q)', () => {
        for (const type of ['lp', 'bp', 'hp'] as const) {
            for (const spec of [
                { type, cutoff: 20, q: 0.1 },
                { type, cutoff: 20, q: GPU_FILTER_Q_MAX },
                { type, cutoff: maxFilterCutoff(SR), q: GPU_FILTER_Q_MAX },
            ]) {
                for (const hz of [1, 20, 23999, 1e-3]) {
                    const r = filterResponse(spec, hz, SR);
                    expect(Number.isFinite(r.re) && Number.isFinite(r.im)).toBe(true);
                }
            }
        }
    });
});

describe('gpuFilterSpec', () => {
    it('clamps like every other filter source and maps the knob like kernelResonance', () => {
        expect(gpuFilterSpec('lp', 5, 0, SR).cutoff).toBe(GPU_FILTER_CUTOFF_MIN);
        expect(gpuFilterSpec('lp', 1e9, 0, SR).cutoff).toBe(maxFilterCutoff(SR));
        expect(gpuFilterSpec('lp', Number.NaN, 0, SR).cutoff).toBe(maxFilterCutoff(SR));
        expect(gpuFilterSpec('lp', 1000, 12, SR).q).toBeCloseTo(kernelResonance('lp', 12), 12);
        expect(gpuFilterSpec('bp', 1000, 5, SR).q).toBe(5);
        expect(gpuFilterSpec('bp', 1000, -3, SR).q).toBeGreaterThanOrEqual(0.1);
        expect(gpuFilterSpec('lp', 1000, 400, SR).q).toBe(GPU_FILTER_Q_MAX);
    });
});

describe('quantizeGpuFilter', () => {
    it('is idempotent and stays within a cutoff step and a Q step of the request', () => {
        for (const cutoff of [20, 33, 440, 1234.5, 8000, 19000]) {
            for (const q of [0.5, 1, 6, 30]) {
                const asked: GpuFilterSpec = { type: 'lp', cutoff, q };
                const once = quantizeGpuFilter(asked, SR);
                const twice = quantizeGpuFilter(once.spec, SR);
                expect(twice.key).toBe(once.key);
                expect(twice.spec.cutoff).toBeCloseTo(once.spec.cutoff, 9);
                expect(Math.abs(Math.log2(once.spec.cutoff / cutoff))).toBeLessThanOrEqual(0.5 / CUTOFF_STEPS_PER_OCTAVE + 1e-9);
                expect(Math.abs(Math.log2(once.spec.q / q))).toBeLessThanOrEqual(0.5 / 8 + 1e-9);
            }
        }
    });

    it('puts a sweep inside one cell on one key, and different filters on different keys', () => {
        const key = (spec: GpuFilterSpec, sr = SR) => quantizeGpuFilter(spec, sr).key;
        expect(key({ type: 'lp', cutoff: 1000, q: 4 })).toBe(key({ type: 'lp', cutoff: 1003, q: 4.05 }));
        expect(key({ type: 'lp', cutoff: 1000, q: 4 })).not.toBe(key({ type: 'lp', cutoff: 1100, q: 4 }));
        expect(key({ type: 'lp', cutoff: 1000, q: 4 })).not.toBe(key({ type: 'lp', cutoff: 1000, q: 8 }));
        expect(key({ type: 'lp', cutoff: 1000, q: 4 })).not.toBe(key({ type: 'hp', cutoff: 1000, q: 4 }));
        // Tables are rendered for one sample rate.
        expect(key({ type: 'lp', cutoff: 1000, q: 4 })).not.toBe(key({ type: 'lp', cutoff: 1000, q: 4 }, 44100));
    });

    it('never leaves the kernel\'s clamps', () => {
        const lo = quantizeGpuFilter({ type: 'lp', cutoff: 20, q: 0.1 }, SR).spec;
        const hi = quantizeGpuFilter({ type: 'lp', cutoff: maxFilterCutoff(SR), q: GPU_FILTER_Q_MAX }, SR).spec;
        expect(lo.cutoff).toBeGreaterThanOrEqual(GPU_FILTER_CUTOFF_MIN);
        expect(lo.q).toBeGreaterThanOrEqual(0.1);
        expect(hi.cutoff).toBeLessThanOrEqual(maxFilterCutoff(SR));
        expect(hi.q).toBeLessThanOrEqual(GPU_FILTER_Q_MAX);
    });
});

describe('the series', () => {
    it('is the naive shape it replaces, level and sign (saw 2p-1, tri 2|2p-1|-1, sine)', () => {
        const L = 512;
        const cps = 1 / L;
        const wave = (shape: WaveShape, harmonics: number) =>
            referenceWaveform({ shape, cyclesPerSample: cps, maxHarmonic: harmonics, f0: 100, sampleRate: SR, spec: null, length: L });
        const saw = wave('saw', 200);
        const tri = wave('tri', 199);
        const sin = wave('sin', 3);
        for (const n of [64, 128, 200, 300, 400]) {
            const p = n / L;
            expect(saw[n]).toBeCloseTo(2 * p - 1, 1);
            expect(tri[n]).toBeCloseTo(2 * Math.abs(2 * p - 1) - 1, 2);
            expect(sin[n]).toBeCloseTo(Math.sin(2 * Math.PI * p), 12);
        }
        // Square: +1 for the first half cycle, -1 for the second (away from the edges).
        const sqr = wave('sqr', 199);
        expect(sqr[L / 4]).toBeCloseTo(1, 1);
        expect(sqr[(3 * L) / 4]).toBeCloseTo(-1, 1);
    });

    it('has no even harmonics for square and triangle, and one for the sine', () => {
        for (const shape of ['sqr', 'tri'] as const) {
            for (const h of [2, 4, 10]) expect(seriesTerm(shape, h).amp).toBe(0);
            expect(seriesTerm(shape, 3).amp).not.toBe(0);
        }
        expect(seriesTerm('sin', 1).amp).toBe(1);
        expect(seriesTerm('sin', 2).amp).toBe(0);
        expect(seriesTerm('tri', 1).cosine).toBe(true);
    });

    it('an absent filter is the identity: gain is the series amplitude, phase 0 (¼ cycle for the cosine series)', () => {
        const saw = harmonicCoefficient('saw', 3, 220, SR, null);
        expect(saw.gain).toBeCloseTo(-2 / (Math.PI * 3), 12);
        expect(saw.cycles).toBe(0);
        expect(harmonicCoefficient('tri', 1, 220, SR, null).cycles).toBeCloseTo(0.25, 12);
    });

    it('drops a harmonic that would be at Nyquist instead of dividing by tan(π/2)', () => {
        const spec: GpuFilterSpec = { type: 'lp', cutoff: 1000, q: 2 };
        expect(harmonicCoefficient('saw', 2, 12000, SR, spec).gain).toBe(0);
        expect(harmonicCoefficient('saw', 2, 11000, SR, spec).gain).not.toBe(0);
    });
});

describe('a filtered table is the biquad\'s steady state', () => {
    // A 4096-sample loop of `cycles` cycles played at rate 1: its audible fundamental is
    // cycles·sr/4096. Run the cookbook biquad over many periods of the same band-limited
    // series and compare the last period with the table the kernel's passes describe.
    const L = 4096;
    const cases: Array<{ shape: WaveShape; cycles: number; spec: GpuFilterSpec }> = [
        { shape: 'saw', cycles: 17, spec: { type: 'lp', cutoff: 1500, q: 6 } },
        { shape: 'saw', cycles: 17, spec: { type: 'bp', cutoff: 800, q: 4 } },
        { shape: 'sqr', cycles: 9, spec: { type: 'hp', cutoff: 2400, q: 1.8 } },
        { shape: 'tri', cycles: 33, spec: { type: 'lp', cutoff: 300, q: 0.707 } },
        { shape: 'saw', cycles: 5, spec: { type: 'lp', cutoff: 20, q: 0.707 } },
    ];
    it.each(cases)('$shape $spec.type fc=$spec.cutoff Q=$spec.q ($cycles cycles)', ({ shape, cycles, spec }) => {
        const f0 = (cycles * SR) / L;
        const maxHarmonic = Math.floor(SR / 2 / f0 - 1e-9) - 1;
        const cps = cycles / L;
        const opts = { shape, cyclesPerSample: cps, maxHarmonic, f0, sampleRate: SR };

        const dry = referenceWaveform({ ...opts, spec: null, length: L });
        const wet = referenceWaveform({ ...opts, spec, length: L });

        // Settle: feed the dry loop through the biquad for enough periods that the slowest pole is gone.
        const periods = spec.cutoff < 100 ? 600 : 40;
        const x = new Float64Array(L * periods);
        for (let p = 0; p < periods; p++) x.set(dry, p * L);
        const y = runBiquad(spec.type, spec.cutoff, spec.q, SR, x);
        const last = y.subarray(L * (periods - 1));

        let peak = 0;
        let err = 0;
        for (let n = 0; n < L; n++) {
            peak = Math.max(peak, Math.abs(last[n]));
            err = Math.max(err, Math.abs(last[n] - wet[n]));
        }
        expect(peak).toBeGreaterThan(1e-3);
        // Both are f64: the only difference is the biquad having fully settled.
        expect(err / peak).toBeLessThan(1e-6);
    });
});

describe('the note bank', () => {
    it('serves every MIDI note from C0 to G9, one table each', () => {
        const bands = planWavetableBands(SR);
        const plan = planFilteredBank(bands);
        expect(plan).toHaveLength(BANK_NOTE_COUNT);
        expect(plan[0].midi).toBe(BANK_MIDI_LOW);
        expect(plan[plan.length - 1].midi).toBe(BANK_MIDI_HIGH);
        expect(plan.map((n) => n.midi)).toEqual(Array.from({ length: BANK_NOTE_COUNT }, (_, i) => BANK_MIDI_LOW + i));
        expect(planFilteredBank([])).toEqual([]);
    });

    it.each([44100, 48000, 96000])('keeps every harmonic under Nyquist for any pitch a note\'s table plays (%i Hz)', (sr) => {
        const bands = planWavetableBands(sr);
        for (const note of planFilteredBank(bands)) {
            const band = bands[note.band];
            // `nearestBankNote` rounds to ± 50 cents, so a note's table sounds up to a quarter tone above f0 … a semitone-half.
            const upper = note.f0 * 2 ** (1 / 24);
            expect(band.maxHarmonic * upper).toBeLessThanOrEqual(sr / 2 + 1e-6);
        }
    });

    it('picks a band whose base is at or below the note\'s upper edge, so the table is played up, not down', () => {
        const bands = planWavetableBands(SR);
        for (const note of planFilteredBank(bands)) {
            // Below the lowest band (C0 – F#0 at 48 kHz) band 0 plays slower: fewer harmonics, never aliasing.
            if (note.band === 0) continue;
            expect(bands[note.band].baseFrequency).toBeLessThanOrEqual(note.f0 * 2 ** (1 / 24) + 1e-9);
        }
        expect(planFilteredBank(bands)[0].band).toBe(0);
    });

    it('maps a pitch to its nearest bank note, and refuses pitches outside the bank', () => {
        expect(nearestBankNote(440)).toBe(69);
        expect(nearestBankNote(midiToHz(60) * 1.02)).toBe(60);
        expect(nearestBankNote(midiToHz(BANK_MIDI_LOW))).toBe(BANK_MIDI_LOW);
        expect(nearestBankNote(midiToHz(BANK_MIDI_HIGH))).toBe(BANK_MIDI_HIGH);
        expect(nearestBankNote(midiToHz(BANK_MIDI_LOW - 1))).toBeNull();
        expect(nearestBankNote(midiToHz(BANK_MIDI_HIGH + 1))).toBeNull();
        for (const bad of [0, -5, Number.NaN, Infinity]) expect(nearestBankNote(bad)).toBeNull();
    });
});

describe('gpuFilterRefusal', () => {
    it.each([
        'sawtooth', 'square', 'triangle', 'sine',
        'wgsl-saw', 'wav-sqr', 'pyodide-tri', 'wam-sin', 'rust-saw', 'cpp-sqr',
        'dwgs-saw', 'dwgs-sqr', 'dwgs-sine',
    ])('renders %s (a basic shape)', (id) => {
        expect(gpuFilterRefusal(parseWaveform(id))).toBeNull();
    });

    it.each(['dwgs-piano', 'dwgs-bell', 'dwgs-vox', 'dwgs-noise'])('refuses %s, naming it', (id) => {
        const reason = gpuFilterRefusal(parseWaveform(id));
        expect(reason).toContain(id);
        expect(reason).toContain('not a basic shape');
    });
});
