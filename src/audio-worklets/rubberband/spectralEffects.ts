export interface BandSplitParams {
  outL: Float32Array;
  outR: Float32Array | undefined;
  hasStereo: boolean;
  spectralComp: number;
  grainPanSpread: number;
  grainPanL: readonly number[];
  grainPanR: readonly number[];
  sampleRate: number;
}

/**
 * 3-band (Low/Mid/High) spectral compressor built on a cascaded Chamberlin
 * state-variable crossover.
 *
 * TS oracle / fallback for spectralBands() in emscripten/rubberband_fx.cpp.
 * One split and one compressor per band per sample. History: a second
 * split + compress pass once re-ran through the same filter memory (removed in
 * #1228), and a `spectralCompression` "leveler" stage — a second compressor
 * on the same bands, never registered as an AudioParam — was dropped in #1273.
 * nativeVocalFx.integration.test.ts and spectralEffects.test.ts fail if a
 * second stage comes back.
 */
export class SpectralBandProcessor {
  private lp1 = 0;
  private bp1 = 0;
  private lp2 = 0;
  private bp2 = 0;
  private readonly env: [number, number, number] = [0, 0, 0];

  // Cached constants to prevent per-block Math.sin and Math.exp overhead
  private cachedSampleRate = 0;
  private f1 = 0;
  private f2 = 0;
  private attackCoef = 0;
  private releaseCoef = 0;

  applyBandSplitAndCompression(p: BandSplitParams): void {
    const { outL, outR, hasStereo, spectralComp, grainPanSpread, grainPanL, grainPanR, sampleRate } = p;

    const needSplit = spectralComp > 0 || (grainPanSpread > 0 && hasStereo);
    if (!needSplit) {
      if (hasStereo && outR) outR.set(outL);
      return;
    }

    const fs = sampleRate;

    // Update cached coefficients if sample rate changes (usually only once on init)
    if (fs !== this.cachedSampleRate && fs > 0) {
      this.cachedSampleRate = fs;
      this.f1 = 2 * Math.sin(Math.PI * 300 / fs);
      this.f2 = 2 * Math.sin(Math.PI * 3000 / fs);
      this.attackCoef = Math.exp(-1.0 / (fs * (2.0 / 1000.0)));
      this.releaseCoef = Math.exp(-1.0 / (fs * (50.0 / 1000.0)));
    }

    const q = 0.5;
    const maxGR = 12.0 * spectralComp;
    const threshold = 0.1;
    const ratio = 1.0 + 3.0 * spectralComp;

    // Mathematical simplification to avoid log10 per-sample:
    // grDb = 20 * (1 - 1/ratio) * log10(env/threshold)
    // gain = 10^(-grDb/20) = (env/threshold)^(-slope)
    const slope = 1.0 - 1.0 / ratio;
    const maxEnv = threshold * Math.exp((maxGR / (20 * slope)) * Math.LN10);
    const maxGRMultiplier = Math.exp((-maxGR / 20) * Math.LN10);

    // Pre-calculate constants to convert Math.pow to Math.exp + Math.log
    const invSlope = -slope;
    const invThreshold = 1.0 / threshold;

    let e0 = this.env[0];
    let e1 = this.env[1];
    let e2 = this.env[2];

    let lp1 = this.lp1, bp1 = this.bp1, lp2 = this.lp2, bp2 = this.bp2;
    const f1 = this.f1, f2 = this.f2;
    const attackCoef = this.attackCoef, releaseCoef = this.releaseCoef;
    const envHasThreshold = spectralComp > 0;
    const outL_ref = outL, outR_ref = outR;
    const outRLen = outL.length;
    const hasR = hasStereo && outR_ref;
    const gl0 = grainPanL[0], gl1 = grainPanL[1], gl2 = grainPanL[2];
    const gr0 = grainPanR[0], gr1 = grainPanR[1], gr2 = grainPanR[2];

    for (let i = 0; i < outRLen; i++) {
      const x = outL_ref[i];
      lp1 += f1 * bp1;
      const hp1 = x - lp1 - q * bp1;
      bp1 += f1 * hp1;
      lp2 += f2 * bp2;
      const hp2 = hp1 - lp2 - q * bp2;
      bp2 += f2 * hp2;

      let low = lp1;
      let mid = lp2;
      let high = hp2;
      if (envHasThreshold) {
        // Inline compress for low
        const absLow = Math.abs(low);
        e0 = absLow > e0 ? attackCoef * e0 + (1 - attackCoef) * absLow : releaseCoef * e0 + (1 - releaseCoef) * absLow;
        if (e0 > threshold) {
          low *= e0 >= maxEnv ? maxGRMultiplier : Math.exp(invSlope * Math.log(e0 * invThreshold));
        }

        // Inline compress for mid
        const absMid = Math.abs(mid);
        e1 = absMid > e1 ? attackCoef * e1 + (1 - attackCoef) * absMid : releaseCoef * e1 + (1 - releaseCoef) * absMid;
        if (e1 > threshold) {
          mid *= e1 >= maxEnv ? maxGRMultiplier : Math.exp(invSlope * Math.log(e1 * invThreshold));
        }

        // Inline compress for high
        const absHigh = Math.abs(high);
        e2 = absHigh > e2 ? attackCoef * e2 + (1 - attackCoef) * absHigh : releaseCoef * e2 + (1 - releaseCoef) * absHigh;
        if (e2 > threshold) {
          high *= e2 >= maxEnv ? maxGRMultiplier : Math.exp(invSlope * Math.log(e2 * invThreshold));
        }
      }

      if (hasR) {
        outL_ref[i] = low * gl0 + mid * gl1 + high * gl2;
        outR_ref![i] = low * gr0 + mid * gr1 + high * gr2;
      } else {
        outL_ref[i] = low + mid + high;
      }
    }

    this.env[0] = e0;
    this.env[1] = e1;
    this.env[2] = e2;
    this.lp1 = lp1; this.bp1 = bp1; this.lp2 = lp2; this.bp2 = bp2;
  }
}
