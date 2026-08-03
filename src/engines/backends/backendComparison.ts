/**
 * Offline backend comparison harness (#1034).
 *
 * Renders the same `GenerateRequest` through several `OscillatorBackend`s and
 * compares level + spectral band energy, reusing the 303 authenticity metric
 * primitives so the two harnesses stay consistent.
 *
 * Purpose is regression detection, not perceptual grading: a backend that
 * quietly starts producing a different wave family, half the level, or silence
 * shows up as a band/RMS delta far outside the tolerance.
 */

import { bandRmsDb, levelMatch, metricsFor } from '../../utils/tb303AuthenticityMetrics';
import type { GenerateRequest, OscillatorBackend, OscillatorBackendId } from './OscillatorBackend';

/** Bands compared across backends (Hz). Chosen to separate wave families. */
export const COMPARISON_BANDS: ReadonlyArray<{ name: string; lo: number; hi: number }> = [
    { name: 'fundamental', lo: 100, hi: 400 },
    { name: 'low-harmonics', lo: 400, hi: 2000 },
    { name: 'high-harmonics', lo: 2000, hi: 8000 },
];

/** Default tolerances — generous enough for legitimate implementation spread. */
export const COMPARISON_TOLERANCES = {
    /** Level-matched broadband RMS delta (dB). */
    rmsDb: 3,
    /** Per-band energy delta after level matching (dB). */
    bandDb: 6,
    /** Even-vs-odd harmonic balance delta (dB). See `evenOddRatioDb`. */
    evenOddDb: 6,
};

/** Harmonics inspected by the even/odd balance metric. */
const EVEN_HARMONICS = [2, 4, 6, 8];
const ODD_HARMONICS = [3, 5, 7, 9];

/**
 * Even-vs-odd harmonic balance in dB.
 *
 * Broad-band energy alone cannot separate a saw from a square — both roll off
 * at ~1/n — but a square has essentially no even harmonics while a saw has
 * them at full strength. This ratio is therefore the metric that catches a
 * backend quietly switching wave family, which is the failure this harness
 * exists to detect. Needs the fundamental, so it is only computed when the
 * caller knows it (as `compareBackends` does, from the request).
 */
export function evenOddRatioDb(samples: Float32Array, sampleRate: number, f0: number): number {
    if (f0 <= 0) return 0;
    const win = analysisWindow(samples);
    const halfWidth = f0 * 0.25;

    const energy = (harmonics: number[]): number => {
        let sum = 0;
        for (const h of harmonics) {
            const centre = f0 * h;
            if (centre + halfWidth >= sampleRate / 2) continue;
            const db = bandRmsDb(win, sampleRate, centre - halfWidth, centre + halfWidth);
            if (Number.isFinite(db)) sum += Math.pow(10, db / 10);
        }
        return sum;
    };

    const even = energy(EVEN_HARMONICS);
    const odd = energy(ODD_HARMONICS);
    // Floor both sides so an absent family yields a large but finite ratio.
    const floor = 1e-12;
    return 10 * Math.log10((even + floor) / (odd + floor));
}

export interface BackendRenderMetrics {
    backendId: OscillatorBackendId;
    sampleCount: number;
    rms: number;
    rmsDbfs: number;
    peak: number;
    bands: Record<string, number>;
}

export interface BackendComparison {
    reference: OscillatorBackendId;
    candidate: OscillatorBackendId;
    rmsErrorDb: number;
    bandErrorDb: Record<string, number>;
    /** Even/odd harmonic balance delta (dB); null when no fundamental was given. */
    evenOddErrorDb: number | null;
    /** Largest band error — the single number to gate on. */
    worstBandErrorDb: number;
    withinTolerance: boolean;
}

export interface BackendComparisonReport {
    request: GenerateRequest;
    metrics: BackendRenderMetrics[];
    comparisons: BackendComparison[];
    /** Backends that could not render the request at all. */
    unavailable: Array<{ backendId: OscillatorBackendId; reason: string }>;
}

function peakOf(samples: Float32Array): number {
    let p = 0;
    for (let i = 0; i < samples.length; i++) {
        const v = Math.abs(samples[i]);
        if (v > p) p = v;
    }
    return p;
}

/**
 * The shared rFFT is radix-2, so spectral analysis runs on the largest
 * power-of-two prefix of the render. Level metrics use the full buffer.
 */
export function analysisWindow(samples: Float32Array): Float32Array {
    if (samples.length < 2) return samples;
    const pow2 = 1 << Math.floor(Math.log2(samples.length));
    return pow2 === samples.length ? samples : samples.subarray(0, pow2);
}

export function measureRender(
    backendId: OscillatorBackendId,
    samples: Float32Array,
    sampleRate: number,
): BackendRenderMetrics {
    const win = analysisWindow(samples);
    const level = metricsFor(win, sampleRate);
    const bands: Record<string, number> = {};
    for (const band of COMPARISON_BANDS) {
        bands[band.name] = bandRmsDb(win, sampleRate, band.lo, band.hi);
    }
    return {
        backendId,
        sampleCount: samples.length,
        rms: level.rms,
        rmsDbfs: level.rmsDbfs,
        peak: peakOf(samples),
        bands,
    };
}

/**
 * Compare two renders after level matching, so a backend that is merely
 * quieter is not reported as spectrally wrong.
 */
export function compareRenders(
    reference: { backendId: OscillatorBackendId; samples: Float32Array },
    candidate: { backendId: OscillatorBackendId; samples: Float32Array },
    sampleRate: number,
    tolerances = COMPARISON_TOLERANCES,
    /** Rendered fundamental in Hz; enables the even/odd harmonic check. */
    fundamental?: number,
): BackendComparison {
    const n = Math.min(reference.samples.length, candidate.samples.length);
    const ref = reference.samples.slice(0, n);
    const cand = levelMatch(candidate.samples.slice(0, n), ref);

    const refMetrics = measureRender(reference.backendId, ref, sampleRate);
    const candMetrics = measureRender(candidate.backendId, cand, sampleRate);

    const bandErrorDb: Record<string, number> = {};
    let worstBandErrorDb = 0;
    for (const band of COMPARISON_BANDS) {
        const err = Math.abs(candMetrics.bands[band.name] - refMetrics.bands[band.name]);
        bandErrorDb[band.name] = err;
        if (Number.isFinite(err) && err > worstBandErrorDb) worstBandErrorDb = err;
    }

    const rmsErrorDb = Math.abs(candMetrics.rmsDbfs - refMetrics.rmsDbfs);

    const evenOddErrorDb =
        fundamental && fundamental > 0
            ? Math.abs(
                  evenOddRatioDb(cand, sampleRate, fundamental) -
                      evenOddRatioDb(ref, sampleRate, fundamental),
              )
            : null;

    return {
        reference: reference.backendId,
        candidate: candidate.backendId,
        rmsErrorDb,
        bandErrorDb,
        evenOddErrorDb,
        worstBandErrorDb,
        withinTolerance:
            rmsErrorDb <= tolerances.rmsDb &&
            worstBandErrorDb <= tolerances.bandDb &&
            (evenOddErrorDb === null || evenOddErrorDb <= tolerances.evenOddDb),
    };
}

/**
 * Render `req` through every backend and compare each against the first one
 * that produced samples. Backends that cannot service the request are listed
 * in `unavailable` rather than silently omitted.
 */
export async function compareBackends(
    backends: OscillatorBackend[],
    req: GenerateRequest,
    tolerances = COMPARISON_TOLERANCES,
): Promise<BackendComparisonReport> {
    const rendered: Array<{ backendId: OscillatorBackendId; samples: Float32Array }> = [];
    const unavailable: Array<{ backendId: OscillatorBackendId; reason: string }> = [];

    for (const backend of backends) {
        if (!backend.isSupported || !backend.isReady) {
            unavailable.push({
                backendId: backend.id,
                reason: backend.isSupported ? 'not initialized' : 'unsupported',
            });
            continue;
        }
        if (!backend.supportsShape(req.shape)) {
            unavailable.push({ backendId: backend.id, reason: `cannot render "${req.shape}"` });
            continue;
        }
        try {
            const samples = await backend.generate(req);
            if (samples && samples.length > 0) {
                rendered.push({ backendId: backend.id, samples });
            } else {
                unavailable.push({ backendId: backend.id, reason: 'returned no samples' });
            }
        } catch (e) {
            unavailable.push({
                backendId: backend.id,
                reason: `threw (${e instanceof Error ? e.message : String(e)})`,
            });
        }
    }

    const metrics = rendered.map((r) => measureRender(r.backendId, r.samples, req.sampleRate));
    const comparisons: BackendComparison[] = [];
    if (rendered.length > 1) {
        const ref = rendered[0];
        for (let i = 1; i < rendered.length; i++) {
            comparisons.push(
                compareRenders(ref, rendered[i], req.sampleRate, tolerances, req.frequency),
            );
        }
    }

    return { request: req, metrics, comparisons, unavailable };
}
