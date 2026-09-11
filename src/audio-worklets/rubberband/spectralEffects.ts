interface ScState {
  lp1: [number, number];
  bp1: [number, number];
  lp2: [number, number];
  bp2: [number, number];
  env: [number, number, number];
}

export interface BandSplitParams {
  outL: Float32Array;
  outR: Float32Array | undefined;
  hasStereo: boolean;
  spectralComp: number;
  spectralCompression: number;
  grainPanSpread: number;
  grainPanL: readonly number[];
  grainPanR: readonly number[];
  sampleRate: number;
}

export interface LegacyCompressorParams {
  outputs: Float32Array[][];
  hasStereo: boolean;
  outL: Float32Array;
  spectralComp: number;
  sampleRate: number;
}

/**
 * 3-band (Low/Mid/High) spectral compressor built on a cascaded Chamberlin
 * state-variable crossover.
 *
 * NOTE: applyBandSplitAndCompression and applyLegacyCompressor both read and
 * write the same crossover filter memory (scState) and are invoked back to
 * back from rubberband-processor.ts's process() when spectralComp > 0. That
 * means the signal is re-split and re-compressed a second time through the
 * same state. This predates this file split — preserved verbatim rather than
 * fixed here.
 */
export class SpectralBandProcessor {
  private scState: ScState = {
    lp1: [0, 0], bp1: [0, 0],
    lp2: [0, 0], bp2: [0, 0],
    env: [0, 0, 0]
  };
  private scLow = [0, 0];
  private scHigh = [0, 0];
  private scEnvLow = [0, 0];
  private scEnvMid = [0, 0];
  private scEnvHigh = [0, 0];
  private scratchBands = new Float32Array(3);

  /** Clears the (otherwise unused) legacy band-hold state on unfreeze. */
  clearLegacyBandState(): void {
    this.scLow.fill(0);
    this.scHigh.fill(0);
  }

  applyBandSplitAndCompression(p: BandSplitParams): void {
    const { outL, outR, hasStereo, spectralComp, spectralCompression, grainPanSpread, grainPanL, grainPanR, sampleRate } = p;

    const needSplit =
      spectralComp > 0 ||
      spectralCompression > 0 ||
      (grainPanSpread > 0 && hasStereo);

    if (needSplit) {
      const fs = sampleRate;
      const f1_c = 2 * Math.sin(Math.PI * 300 / fs);
      const f2_c = 2 * Math.sin(Math.PI * 3000 / fs);
      const q = 0.5;
      const attackCoef = Math.exp(-1.0 / (fs * (2.0 / 1000.0)));
      const releaseCoef = Math.exp(-1.0 / (fs * (50.0 / 1000.0)));
      const maxGR = 12.0 * spectralComp;
      const threshold = 0.1;
      const ratio = 1.0 + 3.0 * spectralComp;
      const channel = 0;

      for (let i = 0; i < outL.length; i++) {
        const x = outL[i];
        this.scState.lp1[channel] += f1_c * this.scState.bp1[channel];
        const hp1 = x - this.scState.lp1[channel] - q * this.scState.bp1[channel];
        this.scState.bp1[channel] += f1_c * hp1;
        let low = this.scState.lp1[channel];
        const rest = hp1;
        this.scState.lp2[channel] += f2_c * this.scState.bp2[channel];
        let high = rest - this.scState.lp2[channel] - q * this.scState.bp2[channel];
        this.scState.bp2[channel] += f2_c * high;
        let mid = this.scState.lp2[channel];
        const bands = [low, mid, high];

        if (spectralComp > 0) {
          for (let b = 0; b < 3; b++) {
            const absIn = Math.abs(bands[b]);
            const env = this.scState.env;
            if (absIn > env[b]) {
              env[b] = attackCoef * env[b] + (1 - attackCoef) * absIn;
            } else {
              env[b] = releaseCoef * env[b] + (1 - releaseCoef) * absIn;
            }
            let gain = 1.0;
            if (env[b] > threshold) {
              const over = 20 * Math.log10(env[b]) - 20 * Math.log10(threshold);
              const grDb = Math.min(over * (1.0 - 1.0 / ratio), maxGR);
              gain = Math.pow(10, -grDb / 20);
            }
            bands[b] *= gain;
          }
        }

        low = bands[0];
        mid = bands[1];
        high = bands[2];

        if (spectralCompression > 0) {
          const attackConst = 1 - Math.exp(-1.0 / (fs * 0.005));
          const releaseConst = 1 - Math.exp(-1.0 / (fs * 0.070));
          const absLow = Math.abs(low);
          const absMid = Math.abs(mid);
          const absHigh = Math.abs(high);
          this.scEnvLow[channel] += (absLow > this.scEnvLow[channel] ? attackConst : releaseConst) * (absLow - this.scEnvLow[channel]);
          this.scEnvMid[channel] += (absMid > this.scEnvMid[channel] ? attackConst : releaseConst) * (absMid - this.scEnvMid[channel]);
          this.scEnvHigh[channel] += (absHigh > this.scEnvHigh[channel] ? attackConst : releaseConst) * (absHigh - this.scEnvHigh[channel]);
          const targetRMS = 0.15;
          const gainLow = Math.max(0.1, Math.min(4.0, 1.0 + spectralCompression * (targetRMS / (this.scEnvLow[channel] + 0.001) - 1.0) * 0.5));
          const gainMid = Math.max(0.1, Math.min(3.0, 1.0 + spectralCompression * (targetRMS / (this.scEnvMid[channel] + 0.001) - 1.0) * 0.7));
          const gainHigh = Math.max(0.1, Math.min(4.0, 1.0 + spectralCompression * (targetRMS / (this.scEnvHigh[channel] + 0.001) - 1.0) * 0.6));
          low = low * (1.0 - spectralCompression) + low * gainLow * spectralCompression;
          mid = mid * (1.0 - spectralCompression) + mid * gainMid * spectralCompression;
          high = high * (1.0 - spectralCompression) + high * gainHigh * spectralCompression;
        }

        if (hasStereo && outR) {
          outL[i] = low * grainPanL[0] + mid * grainPanL[1] + high * grainPanL[2];
          outR[i] = low * grainPanR[0] + mid * grainPanR[1] + high * grainPanR[2];
        } else {
          outL[i] = low + mid + high;
        }
      }
    } else if (hasStereo && outR) {
      outR.set(outL);
    }
  }

}
