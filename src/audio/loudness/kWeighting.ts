/**
 * ITU-R BS.1770-5 K-weighting.
 *
 * Two cascaded biquads: a high-shelf ("head model") followed by an RLB high-pass.
 * The recommendation only tabulates coefficients at 48 kHz; the analog prototype
 * parameters below are the standard ones that reproduce that table exactly at
 * 48 kHz and generalise to any sample rate through the bilinear transform, so
 * meters stay correct at 44.1 / 48 / 96 kHz without hard-coded tables.
 */

/** Direct-form-I biquad with normalised a0 (b0,b1,b2,a1,a2). */
export interface BiquadCoefficients {
    b0: number;
    b1: number;
    b2: number;
    a1: number;
    a2: number;
}

/** High-shelf stage prototype (BS.1770 pre-filter). */
const SHELF_F0 = 1681.974450955533;
const SHELF_G_DB = 3.999843853973347;
const SHELF_Q = 0.7071752369554196;
/** Empirical exponent relating shelf mid-gain to high-gain in the reference design. */
const SHELF_VB_EXPONENT = 0.4996667741545416;

/** RLB high-pass stage prototype. */
const HPF_F0 = 38.13547087602444;
const HPF_Q = 0.5003270373238773;

/** High-shelf stage of the K-weighting filter at `sampleRate`. */
export function shelfCoefficients(sampleRate: number): BiquadCoefficients {
    const k = Math.tan((Math.PI * SHELF_F0) / sampleRate);
    const vh = Math.pow(10, SHELF_G_DB / 20);
    const vb = Math.pow(vh, SHELF_VB_EXPONENT);
    const a0 = 1 + k / SHELF_Q + k * k;
    return {
        b0: (vh + (vb * k) / SHELF_Q + k * k) / a0,
        b1: (2 * (k * k - vh)) / a0,
        b2: (vh - (vb * k) / SHELF_Q + k * k) / a0,
        a1: (2 * (k * k - 1)) / a0,
        a2: (1 - k / SHELF_Q + k * k) / a0,
    };
}

/** RLB high-pass stage of the K-weighting filter at `sampleRate`. */
export function highPassCoefficients(sampleRate: number): BiquadCoefficients {
    const k = Math.tan((Math.PI * HPF_F0) / sampleRate);
    const denom = 1 + k / HPF_Q + k * k;
    return {
        b0: 1,
        b1: -2,
        b2: 1,
        a1: (2 * (k * k - 1)) / denom,
        a2: (1 - k / HPF_Q + k * k) / denom,
    };
}

/**
 * Cascaded K-weighting filter for one channel.
 *
 * State is double precision and lives in fixed fields — no allocation per sample
 * or per render quantum. `reset()` clears the delay lines without reallocating.
 */
export class KWeightingFilter {
    private readonly shelf: BiquadCoefficients;
    private readonly hpf: BiquadCoefficients;

    // Stage 1 (shelf) delay line.
    private x1 = 0;
    private x2 = 0;
    private y1 = 0;
    private y2 = 0;
    // Stage 2 (RLB high-pass) delay line.
    private u1 = 0;
    private u2 = 0;
    private v1 = 0;
    private v2 = 0;

    constructor(sampleRate: number) {
        this.shelf = shelfCoefficients(sampleRate);
        this.hpf = highPassCoefficients(sampleRate);
    }

    reset(): void {
        this.x1 = this.x2 = this.y1 = this.y2 = 0;
        this.u1 = this.u2 = this.v1 = this.v2 = 0;
    }

    /** Filter a single sample. Non-finite input is treated as silence. */
    process(sample: number): number {
        const x0 = Number.isFinite(sample) ? sample : 0;

        const s = this.shelf;
        const y0 = s.b0 * x0 + s.b1 * this.x1 + s.b2 * this.x2 - s.a1 * this.y1 - s.a2 * this.y2;
        if (!Number.isFinite(y0)) {
            this.reset();
            return 0;
        }
        this.x2 = this.x1;
        this.x1 = x0;
        this.y2 = this.y1;
        this.y1 = y0;

        const h = this.hpf;
        const v0 = h.b0 * y0 + h.b1 * this.u1 + h.b2 * this.u2 - h.a1 * this.v1 - h.a2 * this.v2;
        if (!Number.isFinite(v0)) {
            this.reset();
            return 0;
        }
        this.u2 = this.u1;
        this.u1 = y0;
        this.v2 = this.v1;
        this.v1 = v0;

        return v0;
    }
}

/** BS.1770 channel weights, indexed by channel for stereo/mono material. */
export const STEREO_CHANNEL_WEIGHTS: readonly number[] = [1.0, 1.0];
