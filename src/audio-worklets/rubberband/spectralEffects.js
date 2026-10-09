"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpectralBandProcessor = void 0;
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
class SpectralBandProcessor {
    lp1 = 0;
    bp1 = 0;
    lp2 = 0;
    bp2 = 0;
    env = [0, 0, 0];
    // Cached constants to prevent per-block Math.sin and Math.exp overhead
    cachedSampleRate = 0;
    f1 = 0;
    f2 = 0;
    attackCoef = 0;
    releaseCoef = 0;
    applyBandSplitAndCompression(p) {
        const { outL, outR, hasStereo, spectralComp, grainPanSpread, grainPanL, grainPanR, sampleRate } = p;
        const needSplit = spectralComp > 0 || (grainPanSpread > 0 && hasStereo);
        if (!needSplit) {
            if (hasStereo && outR)
                outR.set(outL);
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
                low = this.compress(low, 0, this.attackCoef, this.releaseCoef, threshold, ratio, maxGR);
                mid = this.compress(mid, 1, this.attackCoef, this.releaseCoef, threshold, ratio, maxGR);
                high = this.compress(high, 2, this.attackCoef, this.releaseCoef, threshold, ratio, maxGR);
            }
            if (hasStereo && outR) {
                outL[i] = low * grainPanL[0] + mid * grainPanL[1] + high * grainPanL[2];
                outR[i] = low * grainPanR[0] + mid * grainPanR[1] + high * grainPanR[2];
            }
            else {
                outL[i] = low + mid + high;
            }
        }
    }
    compress(band, b, attackCoef, releaseCoef, threshold, ratio, maxGR) {
        const env = this.env;
        const absIn = Math.abs(band);
        if (absIn > env[b]) {
            env[b] = attackCoef * env[b] + (1 - attackCoef) * absIn;
        }
        else {
            env[b] = releaseCoef * env[b] + (1 - releaseCoef) * absIn;
        }
        if (env[b] <= threshold)
            return band;
        const over = 20 * Math.log10(env[b]) - 20 * Math.log10(threshold);
        const grDb = Math.min(over * (1.0 - 1.0 / ratio), maxGR);
        return band * Math.pow(10, -grDb / 20);
    }
}
exports.SpectralBandProcessor = SpectralBandProcessor;
