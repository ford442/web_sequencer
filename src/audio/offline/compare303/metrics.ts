/**
 * Comparison metrics for the 303 voice harness (#1543).
 *
 * Everything is mono Float32 at one shared sample rate. A signal is analysed
 * once (`analyzeSignal`: STFT, third-octave bands, envelope), then any two
 * analyses can be compared (`comparePair`):
 *
 *  - **Null test**: after aligning the two renders within a few ms and scaling
 *    one by the least-squares gain, `nullDb` is the residual energy relative
 *    to the reference. 0 dB means nothing in common, -inf is the same signal,
 *    -20 dB is a residual a tenth of the signal's amplitude. `corr` is the
 *    normalized correlation at that lag (`nullDb = 10 log10(1 - corr^2)`).
 *  - **Spectral difference**: both signals are level-matched (mean power over
 *    the frames each sounds in, so a drone and a gated voice are matched while
 *    sounding, not by whole-file RMS), then the
 *    third-octave band powers are compared in dB. `lsdDb` is the per-frame
 *    RMS difference averaged over the frames both voices sound in (how far the
 *    timbre is from the reference as it evolves); `avgSpectrumLsdDb` is the same
 *    for the long-term average spectrum (how far the overall tone is).
 *  - **Centroid** and **envelope** agreement: mean spectral centroid, and the
 *    correlation of the 10 ms RMS envelopes (do the notes decay the same way).
 */

export const FFT_SIZE = 2048;
export const HOP_SIZE = 512;
const ENVELOPE_MS = 10;
/** Frames quieter than this many dB below the signal's loudest frame are not "active". */
const ACTIVE_FLOOR_DB = -55;
/** Third-octave band centres, 80 Hz .. 12.7 kHz (31.5 * 2^(k/3), k = 4..26). */
export const BAND_CENTERS_HZ: readonly number[] = Array.from(
  { length: 23 },
  (_, i) => 31.5 * Math.pow(2, (i + 4) / 3),
);

/** In-place radix-2 FFT of `re` / `im` (length must be a power of two). */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

export interface SignalAnalysis {
  sampleRate: number;
  length: number;
  rms: number;
  peak: number;
  /** Mean power per band over the active frames (linear). */
  bandPower: Float64Array;
  /** Band power per frame, `frames * BAND_CENTERS_HZ.length`. */
  frameBands: Float32Array;
  frameCount: number;
  /** Spectral centroid per frame (Hz); 0 for silent frames. */
  frameCentroid: Float32Array;
  /** Frame is loud enough to count. */
  active: Uint8Array;
  /** Mean centroid over the active frames (Hz). */
  centroidHz: number;
  /** Mean total band power over the active frames: the level while the voice sounds. */
  activePower: number;
  /** 10 ms RMS envelope. */
  envelope: Float64Array;
  /**
   * Gate range: dB between the loud (95th percentile) and quiet (5th percentile)
   * 10 ms envelope. A voice that closes its amp between notes has a large range;
   * a voice that drones (nothing gates the oscillator) stays near 0-20 dB.
   */
  envRangeDb: number;
  /** Too quiet to compare (RMS below `SILENT_RMS`). */
  silent: boolean;
}

/** -120 dBFS: envelope floor for the gate range (exact digital zeros would otherwise read as 180 dB). */
const ENV_FLOOR = 1e-6;

/** -80 dBFS: below this a render is treated as silent, and its metrics are not computed. */
export const SILENT_RMS = 1e-4;

function bandEdges(sampleRate: number): Array<[number, number]> {
  const binHz = sampleRate / FFT_SIZE;
  return BAND_CENTERS_HZ.map((c) => {
    const lo = Math.ceil((c / Math.pow(2, 1 / 6)) / binHz);
    const hi = Math.max(lo + 1, Math.ceil((c * Math.pow(2, 1 / 6)) / binHz));
    return [lo, Math.min(hi, FFT_SIZE / 2)];
  });
}

export function analyzeSignal(signal: Float32Array, sampleRate: number): SignalAnalysis {
  const n = signal.length;
  let sumSq = 0;
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const v = signal[i];
    sumSq += v * v;
    const a = Math.abs(v);
    if (a > peak) peak = a;
  }

  const window = new Float64Array(FFT_SIZE);
  let windowPower = 0;
  for (let i = 0; i < FFT_SIZE; i++) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FFT_SIZE);
    windowPower += window[i] * window[i];
  }

  const frameCount = n >= FFT_SIZE ? Math.floor((n - FFT_SIZE) / HOP_SIZE) + 1 : 0;
  const bands = bandEdges(sampleRate);
  const nb = bands.length;
  const frameBands = new Float32Array(frameCount * nb);
  const frameCentroid = new Float32Array(frameCount);
  const frameEnergy = new Float64Array(frameCount);
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  const binHz = sampleRate / FFT_SIZE;

  for (let f = 0; f < frameCount; f++) {
    const start = f * HOP_SIZE;
    for (let i = 0; i < FFT_SIZE; i++) {
      re[i] = signal[start + i] * window[i];
      im[i] = 0;
    }
    fft(re, im);
    let total = 0;
    let weighted = 0;
    for (let k = 1; k < FFT_SIZE / 2; k++) {
      const p = (re[k] * re[k] + im[k] * im[k]) / windowPower;
      total += p;
      weighted += p * k * binHz;
    }
    frameEnergy[f] = total;
    frameCentroid[f] = total > 0 ? weighted / total : 0;
    for (let b = 0; b < nb; b++) {
      let p = 0;
      for (let k = bands[b][0]; k < bands[b][1]; k++) {
        p += (re[k] * re[k] + im[k] * im[k]) / windowPower;
      }
      frameBands[f * nb + b] = p;
    }
  }

  let maxEnergy = 0;
  for (let f = 0; f < frameCount; f++) maxEnergy = Math.max(maxEnergy, frameEnergy[f]);
  const floor = maxEnergy * Math.pow(10, ACTIVE_FLOOR_DB / 10);
  const active = new Uint8Array(frameCount);
  const bandPower = new Float64Array(nb);
  let activeCount = 0;
  let centroidSum = 0;
  let activeEnergySum = 0;
  for (let f = 0; f < frameCount; f++) {
    if (maxEnergy > 0 && frameEnergy[f] >= floor) {
      active[f] = 1;
      activeCount++;
      centroidSum += frameCentroid[f];
      activeEnergySum += frameEnergy[f];
      for (let b = 0; b < nb; b++) bandPower[b] += frameBands[f * nb + b];
    }
  }
  if (activeCount > 0) for (let b = 0; b < nb; b++) bandPower[b] /= activeCount;

  const envLen = Math.max(1, Math.round((sampleRate * ENVELOPE_MS) / 1000));
  const envelope = new Float64Array(Math.floor(n / envLen));
  for (let e = 0; e < envelope.length; e++) {
    let s = 0;
    for (let i = e * envLen; i < (e + 1) * envLen; i++) s += signal[i] * signal[i];
    envelope[e] = Math.sqrt(s / envLen);
  }

  const sortedEnv = Float64Array.from(envelope).sort();
  const pct = (q: number): number => (sortedEnv.length ? sortedEnv[Math.min(sortedEnv.length - 1, Math.floor(q * sortedEnv.length))] : 0);
  const rmsAll = Math.sqrt(sumSq / Math.max(1, n));

  return {
    sampleRate,
    length: n,
    rms: rmsAll,
    silent: rmsAll < SILENT_RMS,
    envRangeDb: 20 * Math.log10(Math.max(pct(0.95), ENV_FLOOR) / Math.max(pct(0.05), ENV_FLOOR)),
    peak,
    bandPower,
    frameBands,
    frameCount,
    frameCentroid,
    active,
    centroidHz: activeCount > 0 ? centroidSum / activeCount : 0,
    activePower: activeCount > 0 ? activeEnergySum / activeCount : 0,
    envelope,
  };
}

export const toDb = (power: number, floor = 1e-20): number => 10 * Math.log10(Math.max(power, floor));

/**
 * Lag (samples) at which `b` best lines up with `a`: `a[n] ~ g * b[n + lag]`.
 * Searched within +/- `maxLag` over the first `searchFrames` samples.
 */
export function bestLag(a: Float32Array, b: Float32Array, maxLag: number, searchFrames: number): number {
  const n = Math.min(a.length, b.length, searchFrames);
  let best = 0;
  let bestScore = -Infinity;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let dot = 0;
    let eb = 0;
    const from = Math.max(0, -lag);
    const to = Math.min(n, b.length - lag);
    for (let i = from; i < to; i++) {
      const bv = b[i + lag];
      dot += a[i] * bv;
      eb += bv * bv;
    }
    const score = eb > 0 ? dot / Math.sqrt(eb) : -Infinity;
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  return best;
}

export interface NullTest {
  lagSamples: number;
  /** Least-squares gain applied to the compared signal. */
  gain: number;
  corr: number;
  /** Residual energy relative to the reference energy, dB (<= 0 for the optimal gain). */
  nullDb: number;
}

export function nullTest(ref: Float32Array, sig: Float32Array, maxLag: number, searchFrames: number): NullTest {
  const lagSamples = bestLag(ref, sig, maxLag, searchFrames);
  const from = Math.max(0, -lagSamples);
  const to = Math.min(ref.length, sig.length - lagSamples);
  let dot = 0;
  let ea = 0;
  let eb = 0;
  for (let i = from; i < to; i++) {
    const a = ref[i];
    const b = sig[i + lagSamples];
    dot += a * b;
    ea += a * a;
    eb += b * b;
  }
  if (ea <= 0 || eb <= 0) return { lagSamples, gain: 0, corr: 0, nullDb: 0 };
  const gain = dot / eb;
  const corr = dot / Math.sqrt(ea * eb);
  let resid = 0;
  for (let i = from; i < to; i++) {
    const r = ref[i] - gain * sig[i + lagSamples];
    resid += r * r;
  }
  return { lagSamples, gain, corr, nullDb: toDb(resid / ea, 1e-12) };
}

function pearson(a: Float64Array, b: Float64Array): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    cov += da * db;
    va += da * da;
    vb += db * db;
  }
  return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : 0;
}

/** Power factor that brings `sig` to `ref`'s level over the frames each is sounding in. */
function activeLevelRatio(ref: SignalAnalysis, sig: SignalAnalysis): number {
  return Math.max(ref.activePower, 1e-20) / Math.max(sig.activePower, 1e-20);
}

export interface PairMetrics {
  /** Compared voice's RMS relative to the reference, dB (negative = quieter). */
  levelDb: number;
  peakDeltaDb: number;
  lagSamples: number;
  corr: number;
  nullDb: number;
  /** Mean per-frame RMS band difference (dB) over frames active in both, level-matched. */
  lsdDb: number;
  /** RMS band difference (dB) of the long-term average spectra, level-matched. */
  avgSpectrumLsdDb: number;
  /** Compared minus reference mean spectral centroid, Hz. */
  centroidDeltaHz: number;
  /** Pearson correlation of the 10 ms RMS envelopes. */
  envCorr: number;
  /** Compared minus reference average band level (dB, level-matched), per `BAND_CENTERS_HZ`. */
  bandDiffDb: number[];
  /** Frames active in both signals. */
  commonFrames: number;
}

export interface CompareOptions {
  /** Alignment search range, ms either way (default 5). */
  maxLagMs?: number;
}

export function comparePair(
  ref: Float32Array,
  refAnalysis: SignalAnalysis,
  sig: Float32Array,
  sigAnalysis: SignalAnalysis,
  options: CompareOptions = {},
): PairMetrics {
  const sr = refAnalysis.sampleRate;
  const maxLag = Math.round(((options.maxLagMs ?? 5) / 1000) * sr);
  const nt = nullTest(ref, sig, maxLag, 2 * sr);

  const nb = BAND_CENTERS_HZ.length;
  const refRms = Math.max(refAnalysis.rms, 1e-12);
  const sigRms = Math.max(sigAnalysis.rms, 1e-12);
  // Spectra are compared at equal level *while sounding*, so a voice that drones
  // (never gates) is not scored as louder just because it never goes quiet.
  const levelPower = activeLevelRatio(refAnalysis, sigAnalysis);

  let lsdSum = 0;
  let common = 0;
  const frames = Math.min(refAnalysis.frameCount, sigAnalysis.frameCount);
  for (let f = 0; f < frames; f++) {
    if (!refAnalysis.active[f] || !sigAnalysis.active[f]) continue;
    let sq = 0;
    for (let b = 0; b < nb; b++) {
      const d = toDb(sigAnalysis.frameBands[f * nb + b] * levelPower) - toDb(refAnalysis.frameBands[f * nb + b]);
      sq += d * d;
    }
    lsdSum += Math.sqrt(sq / nb);
    common++;
  }

  const bandDiffDb: number[] = [];
  let avgSq = 0;
  for (let b = 0; b < nb; b++) {
    const d = toDb(sigAnalysis.bandPower[b] * levelPower) - toDb(refAnalysis.bandPower[b]);
    bandDiffDb.push(d);
    avgSq += d * d;
  }

  return {
    levelDb: toDb((sigRms / refRms) ** 2),
    peakDeltaDb: toDb((sigAnalysis.peak / Math.max(refAnalysis.peak, 1e-12)) ** 2),
    lagSamples: nt.lagSamples,
    corr: nt.corr,
    nullDb: nt.nullDb,
    lsdDb: common > 0 ? lsdSum / common : NaN,
    avgSpectrumLsdDb: Math.sqrt(avgSq / nb),
    centroidDeltaHz: sigAnalysis.centroidHz - refAnalysis.centroidHz,
    envCorr: pearson(refAnalysis.envelope, sigAnalysis.envelope),
    bandDiffDb,
    commonFrames: common,
  };
}

/**
 * Per-frame spectral distance between two analyses without a null test:
 * the matrix view the report uses to compare every voice against every other.
 */
export function spectralDistanceDb(a: SignalAnalysis, b: SignalAnalysis): number {
  const nb = BAND_CENTERS_HZ.length;
  const levelPower = activeLevelRatio(a, b);
  const frames = Math.min(a.frameCount, b.frameCount);
  let sum = 0;
  let common = 0;
  for (let f = 0; f < frames; f++) {
    if (!a.active[f] || !b.active[f]) continue;
    let sq = 0;
    for (let i = 0; i < nb; i++) {
      const d = toDb(b.frameBands[f * nb + i] * levelPower) - toDb(a.frameBands[f * nb + i]);
      sq += d * d;
    }
    sum += Math.sqrt(sq / nb);
    common++;
  }
  return common > 0 ? sum / common : NaN;
}
