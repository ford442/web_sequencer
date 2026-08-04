/**
 * True-peak (inter-sample peak) estimation per ITU-R BS.1770-5 Annex 2.
 *
 * A polyphase FIR interpolator raises the effective rate to ≥ 192 kHz before
 * peak detection. Linear interpolation is deliberately *not* used: it
 * underestimates inter-sample peaks on high-frequency content by well over the
 * ±0.1 dBTP tolerance we hold ourselves to.
 *
 * The filter is a windowed-sinc low-pass (Blackman-Harris) split into `factor`
 * phases of `TAPS_PER_PHASE` taps each. All buffers are allocated once at
 * construction — `processSample` never allocates.
 */

/** Taps per polyphase branch. 32 × 4 phases = 128 total taps. */
export const TAPS_PER_PHASE = 32;

/** ITU asks for an effective rate of at least 192 kHz. */
const MIN_EFFECTIVE_RATE = 192000;

/** Oversampling factor for a given sample rate (power of two, ≥ 2). */
export function oversamplingFactorFor(sampleRate: number): number {
    let factor = 2;
    while (sampleRate * factor < MIN_EFFECTIVE_RATE && factor < 8) {
        factor *= 2;
    }
    return factor;
}

/** 4-term Blackman-Harris window value at position `n` of `length`. */
function blackmanHarris(n: number, length: number): number {
    const t = (2 * Math.PI * n) / (length - 1);
    return (
        0.35875 -
        0.48829 * Math.cos(t) +
        0.14128 * Math.cos(2 * t) -
        0.01168 * Math.cos(3 * t)
    );
}

function sinc(x: number): number {
    if (x === 0) return 1;
    const px = Math.PI * x;
    return Math.sin(px) / px;
}

/**
 * Build the polyphase coefficient bank for `factor`× interpolation.
 *
 * Returns `factor` branches of `TAPS_PER_PHASE` coefficients, each branch
 * normalised to unit DC gain so a constant input interpolates to itself.
 */
export function buildPolyphaseCoefficients(factor: number): Float32Array[] {
    const total = TAPS_PER_PHASE * factor;
    const prototype = new Float64Array(total);
    const center = (total - 1) / 2;
    const cutoff = 0.5 / factor; // original Nyquist, normalised to the oversampled rate

    for (let n = 0; n < total; n += 1) {
        prototype[n] = 2 * cutoff * sinc(2 * cutoff * (n - center)) * blackmanHarris(n, total);
    }

    const phases: Float32Array[] = [];
    for (let phase = 0; phase < factor; phase += 1) {
        const branch = new Float64Array(TAPS_PER_PHASE);
        let sum = 0;
        for (let tap = 0; tap < TAPS_PER_PHASE; tap += 1) {
            const value = prototype[tap * factor + phase];
            branch[tap] = value;
            sum += value;
        }
        // Normalising each branch independently removes the zero-stuffing gain
        // loss and keeps a DC signal from reading as a false inter-sample peak.
        const scale = sum !== 0 ? 1 / sum : 1;
        const out = new Float32Array(TAPS_PER_PHASE);
        for (let tap = 0; tap < TAPS_PER_PHASE; tap += 1) {
            out[tap] = branch[tap] * scale;
        }
        phases.push(out);
    }
    return phases;
}

/**
 * Single-channel true-peak detector.
 *
 * Feed samples one at a time; `processSample` returns the maximum absolute
 * interpolated magnitude around that sample, which is also accumulated into
 * `peak`.
 */
export class TruePeakDetector {
    readonly factor: number;
    private readonly phases: Float32Array[];
    private readonly history: Float32Array;
    private historyIndex = 0;
    /** Running maximum absolute inter-sample magnitude (linear). */
    peak = 0;

    constructor(sampleRate: number, factor = oversamplingFactorFor(sampleRate)) {
        this.factor = factor;
        this.phases = buildPolyphaseCoefficients(factor);
        this.history = new Float32Array(TAPS_PER_PHASE);
    }

    reset(): void {
        this.history.fill(0);
        this.historyIndex = 0;
        this.peak = 0;
    }

    /** Clear the held peak without disturbing the filter state. */
    resetPeak(): void {
        this.peak = 0;
    }

    /**
     * Push one input sample and return the largest interpolated magnitude it
     * produced. Non-finite input is treated as silence so a stray NaN cannot
     * latch the meter at +Infinity.
     */
    processSample(sample: number): number {
        const x = Number.isFinite(sample) ? sample : 0;
        this.history[this.historyIndex] = x;
        this.historyIndex = (this.historyIndex + 1) % TAPS_PER_PHASE;

        let localPeak = 0;
        for (let phase = 0; phase < this.factor; phase += 1) {
            const taps = this.phases[phase];
            let acc = 0;
            // history[historyIndex] is now the oldest sample; walk forward.
            let idx = this.historyIndex;
            for (let tap = TAPS_PER_PHASE - 1; tap >= 0; tap -= 1) {
                acc += taps[tap] * this.history[idx];
                idx += 1;
                if (idx === TAPS_PER_PHASE) idx = 0;
            }
            const magnitude = acc < 0 ? -acc : acc;
            if (magnitude > localPeak) localPeak = magnitude;
        }
        if (localPeak > this.peak) this.peak = localPeak;
        return localPeak;
    }
}

/** Convert a linear magnitude to dB, mapping 0 to -Infinity. */
export function linearToDb(linear: number): number {
    return linear > 0 ? 20 * Math.log10(linear) : -Infinity;
}

/** Convert dB to a linear magnitude. */
export function dbToLinear(db: number): number {
    return Math.pow(10, db / 20);
}

/**
 * Offline true-peak of an interleaved-by-channel buffer, in dBTP.
 * Used by the export path and by the ISP torture tests.
 */
export function measureTruePeakDbtp(
    channels: readonly Float32Array[],
    sampleRate: number,
    factor?: number,
): number {
    let peak = 0;
    for (const channel of channels) {
        const detector = new TruePeakDetector(sampleRate, factor);
        for (let i = 0; i < channel.length; i += 1) {
            detector.processSample(channel[i]);
        }
        // Flush the FIR tail so the final samples are fully interpolated.
        for (let i = 0; i < TAPS_PER_PHASE; i += 1) {
            detector.processSample(0);
        }
        if (detector.peak > peak) peak = detector.peak;
    }
    return linearToDb(peak);
}
