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
    const maxEnv = threshold * Math.pow(10, maxGR / (20 * slope));
    const maxGRMultiplier = Math.pow(10, -maxGR / 20);

    for (let i = 0; i < outL.length; i++) {
      const x = outL[i];
      this.lp1 += this.f1 * this.bp1;
      const hp1 = x - this.lp1 - q * this.bp1;
      this.bp1 += this.f1 * hp1;
      this.lp2 += this.f2 * this.bp2;
      const hp2 = hp1 - this.lp2 - q * this.bp2;
      this.bp2 += this.f2 * hp2;

      let low = this.lp1;
      let mid = this.lp2;
      let high = hp2;
      if (spectralComp > 0) {
        low = this.compress(low, 0, this.attackCoef, this.releaseCoef, threshold, slope, maxEnv, maxGRMultiplier);
        mid = this.compress(mid, 1, this.attackCoef, this.releaseCoef, threshold, slope, maxEnv, maxGRMultiplier);
        high = this.compress(high, 2, this.attackCoef, this.releaseCoef, threshold, slope, maxEnv, maxGRMultiplier);
      }

      if (hasStereo && outR) {
        outL[i] = low * grainPanL[0] + mid * grainPanL[1] + high * grainPanL[2];
        outR[i] = low * grainPanR[0] + mid * grainPanR[1] + high * grainPanR[2];
      } else {
        outL[i] = low + mid + high;
      }
    }
  }

  private compress(
    band: number, b: 0 | 1 | 2,
    attackCoef: number, releaseCoef: number, threshold: number, slope: number, maxEnv: number, maxGRMultiplier: number,
  ): number {
    const env = this.env;
    const absIn = Math.abs(band);
    if (absIn > env[b]) {
      env[b] = attackCoef * env[b] + (1 - attackCoef) * absIn;
    } else {
      env[b] = releaseCoef * env[b] + (1 - releaseCoef) * absIn;
    }
    if (env[b] <= threshold) return band;
    if (env[b] >= maxEnv) return band * maxGRMultiplier;
    return band * Math.pow(env[b] / threshold, -slope);
  }
}
