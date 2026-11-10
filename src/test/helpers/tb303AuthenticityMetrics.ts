/**
 * TB-303 Phase-0 / Phase-5 authenticity metrics (TypeScript port of scripts/303_spectrogram.py).
 *
 * Used by Vitest spectrogram-diff gates against committed baselines in
 * docs/audio-engine/303-baseline/. Thresholds mirror 303-authenticity-gaps.md.
 */

/** Provisional gates for highfid-cpu / gpu-highfid vs reference (Phases 2–5). */
export const TB303_AUTHENTICITY_THRESHOLDS = {
  /** Primary squelch / accent grit band — mean absolute error (dB). */
  band2k4kErrorDb: 3,
  /** Feedback-HP / body band — mean absolute error (dB). */
  band200800ErrorDb: 4,
  /** Level-normalized broadband RMS error (dB). */
  rmsErrorDb: 1.5,
  /** Envelope peak timing drift on accented steps (ms). */
  accentPeakTimingDriftMs: 2,
  /** Spectrogram MSE (dB²) full-band vs soft oracle — highfid soft budget. */
  spectrogramMseFullDb2: 2200,
} as const;

export interface WavMono {
  samples: Float32Array;
  sampleRate: number;
}

export interface Tb303LevelMetrics {
  sampleRate: number;
  numSamples: number;
  durationS: number;
  rms: number;
  rmsDbfs: number;
  peak: number;
  peakDbfs: number;
  band2k4kDbfs: number;
  band200800Dbfs: number;
  band4k8kDbfs: number;
}

export interface Tb303VsReferenceMetrics {
  reference: string;
  rmsErrorDbUnmatched: number;
  band2k4kErrorDb: number;
  band200800ErrorDb: number;
  band4k8kErrorDb: number;
  accentPeakTimingDriftMs: number[];
  accentPeakTimingDriftMsAbsMax: number | null;
}

export interface SpectrogramBandMse {
  band200800: number;
  band2k4k: number;
  band4k8k: number;
  full: number;
}

const CANONICAL_STEP_SEC = 0.152;

function db(x: number): number {
  return x > 0 ? 20 * Math.log10(x) : Number.NEGATIVE_INFINITY;
}

/** Parse mono PCM WAV (16- or 24-bit LE) into float32 [-1, 1]. */
export function readWavMonoFromBuffer(buf: Buffer | Uint8Array): WavMono {
  const view = buf instanceof Buffer ? buf : Buffer.from(buf);
  if (view.subarray(0, 4).toString('ascii') !== 'RIFF') {
    throw new Error('Not a RIFF WAV');
  }
  if (view.subarray(8, 12).toString('ascii') !== 'WAVE') {
    throw new Error('Not a WAVE file');
  }

  let offset = 12;
  let sampleRate = 48000;
  let bitsPerSample = 16;
  let numChannels = 1;
  let dataOffset = 0;
  let dataSize = 0;

  while (offset + 8 <= view.length) {
    const chunkId = view.subarray(offset, offset + 4).toString('ascii');
    const chunkSize = view.readUInt32LE(offset + 4);
    const chunkData = offset + 8;
    if (chunkId === 'fmt ') {
      numChannels = view.readUInt16LE(chunkData + 2);
      sampleRate = view.readUInt32LE(chunkData + 4);
      bitsPerSample = view.readUInt16LE(chunkData + 14);
    } else if (chunkId === 'data') {
      dataOffset = chunkData;
      dataSize = chunkSize;
      break;
    }
    offset = chunkData + chunkSize + (chunkSize % 2);
  }

  if (!dataSize) {
    throw new Error('WAV missing data chunk');
  }

  const bytesPerSample = bitsPerSample / 8;
  const frameCount = Math.floor(dataSize / (bytesPerSample * numChannels));
  const samples = new Float32Array(frameCount);

  if (bitsPerSample === 16) {
    for (let i = 0; i < frameCount; i++) {
      const frameOff = dataOffset + i * bytesPerSample * numChannels;
      const v = view.readInt16LE(frameOff);
      samples[i] = v / 32768;
    }
  } else if (bitsPerSample === 24) {
    for (let i = 0; i < frameCount; i++) {
      const frameOff = dataOffset + i * bytesPerSample * numChannels;
      let val = view[frameOff] | (view[frameOff + 1] << 8) | (view[frameOff + 2] << 16);
      if (val & 0x800000) val -= 0x1000000;
      samples[i] = val / 8388608;
    }
  } else {
    throw new Error(`Unsupported bits per sample: ${bitsPerSample}`);
  }

  return { samples, sampleRate };
}

/** RMS level (dBFS) in a frequency band via rFFT magnitude energy. */
export function bandRmsDb(
  samples: Float32Array,
  sampleRate: number,
  fLo: number,
  fHi: number,
): number {
  if (samples.length === 0) return Number.NEGATIVE_INFINITY;

  const windowed = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    windowed[i] = samples[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (samples.length - 1)));
  }

  const spec = rfft(windowed);
  const freqs = rfftfreq(windowed.length, sampleRate);
  let power = 0;
  let count = 0;
  for (let i = 0; i < freqs.length; i++) {
    if (freqs[i] >= fLo && freqs[i] < fHi) {
      const re = spec.re[i];
      const im = spec.im[i];
      const mag = Math.sqrt(re * re + im * im);
      power += mag * mag;
      count++;
    }
  }
  if (!count) return Number.NEGATIVE_INFINITY;
  const meanPower = power / count / (windowed.length * windowed.length);
  if (meanPower <= 0) return Number.NEGATIVE_INFINITY;
  return 10 * Math.log10(meanPower * 2);
}

export function metricsFor(samples: Float32Array, sampleRate: number): Tb303LevelMetrics {
  let sumSq = 0;
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    sumSq += s * s;
    const a = Math.abs(s);
    if (a > peak) peak = a;
  }
  const rms = samples.length ? Math.sqrt(sumSq / samples.length) : 0;
  return {
    sampleRate,
    numSamples: samples.length,
    durationS: sampleRate ? samples.length / sampleRate : 0,
    rms,
    rmsDbfs: db(rms),
    peak,
    peakDbfs: db(peak),
    band2k4kDbfs: bandRmsDb(samples, sampleRate, 2000, 4000),
    band200800Dbfs: bandRmsDb(samples, sampleRate, 200, 800),
    band4k8kDbfs: bandRmsDb(samples, sampleRate, 4000, 8000),
  };
}

/** Scale `samples` so broadband RMS matches `ref`. */
export function levelMatch(samples: Float32Array, ref: Float32Array): Float32Array {
  let rmsS = 0;
  let rmsR = 0;
  for (let i = 0; i < samples.length; i++) rmsS += samples[i] * samples[i];
  for (let i = 0; i < ref.length; i++) rmsR += ref[i] * ref[i];
  rmsS = samples.length ? Math.sqrt(rmsS / samples.length) : 0;
  rmsR = ref.length ? Math.sqrt(rmsR / ref.length) : 0;
  if (rmsS <= 0 || rmsR <= 0) return samples.slice();
  const gain = rmsR / rmsS;
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] * gain;
  return out;
}

function envPeakIdx(x: Float32Array, win: number): number {
  if (x.length < win) {
    let maxI = 0;
    let maxV = 0;
    for (let i = 0; i < x.length; i++) {
      const a = Math.abs(x[i]);
      if (a > maxV) {
        maxV = a;
        maxI = i;
      }
    }
    return maxI;
  }
  const env = new Float32Array(x.length);
  const inv = 1 / win;
  for (let i = 0; i < x.length; i++) {
    let sum = 0;
    const lo = Math.max(0, i - win + 1);
    for (let j = lo; j <= i; j++) sum += x[j] * x[j];
    env[i] = Math.sqrt(sum * inv);
  }
  let maxI = 0;
  let maxV = 0;
  for (let i = 0; i < env.length; i++) {
    if (env[i] > maxV) {
      maxV = env[i];
      maxI = i;
    }
  }
  return maxI;
}

/** Level-normalized band errors and accent peak timing drift vs reference. */
export function vsReference(
  samples: Float32Array,
  sampleRate: number,
  ref: Float32Array,
  refSampleRate: number,
): Tb303VsReferenceMetrics {
  if (sampleRate !== refSampleRate) {
    throw new Error(`sample_rate mismatch ${sampleRate} vs ${refSampleRate}`);
  }
  const n = Math.min(samples.length, ref.length);
  const rawA = samples.subarray(0, n);
  const b = ref.subarray(0, n);
  const a = levelMatch(rawA, b);
  const mRaw = metricsFor(rawA, sampleRate);
  const mA = metricsFor(a, sampleRate);
  const mB = metricsFor(b, sampleRate);

  const step = Math.round(CANONICAL_STEP_SEC * sampleRate);
  const win = Math.max(32, Math.floor(sampleRate / 500));
  const accentDriftsMs: number[] = [];
  for (const stepI of [1, 3]) {
    const lo = stepI * step;
    const hi = Math.min(n, (stepI + 1) * step);
    if (hi - lo < 64) continue;
    const da = envPeakIdx(a.subarray(lo, hi), win);
    const dbIdx = envPeakIdx(b.subarray(lo, hi), win);
    accentDriftsMs.push((1000 * (da - dbIdx)) / sampleRate);
  }

  return {
    reference: 'level-matched bands; absolute RMS before match',
    rmsErrorDbUnmatched: mRaw.rmsDbfs - mB.rmsDbfs,
    band2k4kErrorDb: mA.band2k4kDbfs - mB.band2k4kDbfs,
    band200800ErrorDb: mA.band200800Dbfs - mB.band200800Dbfs,
    band4k8kErrorDb: mA.band4k8kDbfs - mB.band4k8kDbfs,
    accentPeakTimingDriftMs: accentDriftsMs,
    accentPeakTimingDriftMsAbsMax: accentDriftsMs.length
      ? Math.max(...accentDriftsMs.map((x) => Math.abs(x)))
      : null,
  };
}

interface RfftResult {
  re: Float32Array;
  im: Float32Array;
}

function rfft(input: Float32Array): RfftResult {
  const n = input.length;
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  for (let i = 0; i < n; i++) re[i] = input[i];
  fftInPlace(re, im);
  const half = Math.floor(n / 2) + 1;
  return { re: re.subarray(0, half), im: im.subarray(0, half) };
}

function rfftfreq(n: number, sampleRate: number): Float32Array {
  const half = Math.floor(n / 2) + 1;
  const out = new Float32Array(half);
  for (let i = 0; i < half; i++) out[i] = (i * sampleRate) / n;
  return out;
}

/** In-place Cooley-Tukey radix-2 FFT (real input). */
function fftInPlace(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  // Bit-reverse permutation
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
    const wlenRe = Math.cos(ang);
    const wlenIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wRe = 1;
      let wIm = 0;
      for (let j = 0; j < len / 2; j++) {
        const uRe = re[i + j];
        const uIm = im[i + j];
        const vRe = re[i + j + len / 2] * wRe - im[i + j + len / 2] * wIm;
        const vIm = re[i + j + len / 2] * wIm + im[i + j + len / 2] * wRe;
        re[i + j] = uRe + vRe;
        im[i + j] = uIm + vIm;
        re[i + j + len / 2] = uRe - vRe;
        im[i + j + len / 2] = uIm - vIm;
        const nextWRe = wRe * wlenRe - wIm * wlenIm;
        wIm = wRe * wlenIm + wIm * wlenRe;
        wRe = nextWRe;
      }
    }
  }
}

export interface SpectrogramMatrix {
  magnitudesDb: Float32Array;
  freqs: Float32Array;
  timeBins: number;
  freqBins: number;
}

/** Short-time magnitude spectrogram (dB scale) aligned with scripts/303_spectrogram.py. */
export function computeSpectrogramDb(
  samples: Float32Array,
  sampleRate: number,
  nperseg = 1024,
): SpectrogramMatrix {
  const seg = Math.min(nperseg, Math.max(256, Math.floor(samples.length / 8)));
  const noverlap = Math.floor(seg / 2);
  const hop = seg - noverlap;
  const timeBins = Math.max(1, Math.floor((samples.length - noverlap) / hop));
  const freqBins = Math.floor(seg / 2) + 1;
  const magnitudesDb = new Float32Array(timeBins * freqBins);
  const freqs = rfftfreq(seg, sampleRate);

  for (let t = 0; t < timeBins; t++) {
    const start = t * hop;
    const frame = new Float32Array(seg);
    for (let i = 0; i < seg; i++) {
      const idx = start + i;
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (seg - 1));
      frame[i] = idx < samples.length ? samples[idx] * w : 0;
    }
    const spec = rfft(frame);
    for (let f = 0; f < freqBins; f++) {
      const mag = Math.sqrt(spec.re[f] * spec.re[f] + spec.im[f] * spec.im[f]) / seg;
      const dbVal = mag > 0 ? 20 * Math.log10(mag) : -120;
      magnitudesDb[t * freqBins + f] = dbVal;
    }
  }

  return { magnitudesDb, freqs, timeBins, freqBins };
}

function bandMseFromSpectrogram(
  a: SpectrogramMatrix,
  b: SpectrogramMatrix,
  fLo: number,
  fHi: number,
): number {
  const { magnitudesDb: ma, freqs, timeBins, freqBins } = a;
  const mb = b.magnitudesDb;
  let sum = 0;
  let count = 0;
  for (let f = 0; f < freqBins; f++) {
    if (freqs[f] < fLo || freqs[f] >= fHi) continue;
    for (let t = 0; t < timeBins; t++) {
      const i = t * freqBins + f;
      const d = ma[i] - mb[i];
      sum += d * d;
      count++;
    }
  }
  return count ? sum / count : 0;
}

/**
 * Mean squared error of level-matched spectrograms (dB domain) per band vs reference.
 * Primary Phase-5 diff metric when jc303 soft-oracle 2–4 kHz band is near-silent.
 */
export function spectrogramMsePerBand(
  samples: Float32Array,
  sampleRate: number,
  ref: Float32Array,
): SpectrogramBandMse {
  const n = Math.min(samples.length, ref.length);
  const a = levelMatch(samples.subarray(0, n), ref.subarray(0, n));
  const b = ref.subarray(0, n);
  const specA = computeSpectrogramDb(a, sampleRate);
  const specB = computeSpectrogramDb(b, sampleRate);
  const band200800 = bandMseFromSpectrogram(specA, specB, 200, 800);
  const band2k4k = bandMseFromSpectrogram(specA, specB, 2000, 4000);
  const band4k8k = bandMseFromSpectrogram(specA, specB, 4000, 8000);
  const full = bandMseFromSpectrogram(specA, specB, 0, sampleRate / 2);
  return { band200800, band2k4k, band4k8k, full };
}

export function bufferHasFinitePeak(samples: Float32Array): boolean {
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i];
    if (!Number.isFinite(v)) return false;
  }
  return true;
}

/** Assert high-fid engine meets safety + partial authenticity gates (see gaps doc). */
export function evaluateHighFidGates(
  vsRef: Tb303VsReferenceMetrics,
  specMse: SpectrogramBandMse,
): { passed: string[]; failed: string[] } {
  const passed: string[] = [];
  const failed: string[] = [];
  const t = TB303_AUTHENTICITY_THRESHOLDS;

  if (Math.abs(vsRef.rmsErrorDbUnmatched) < t.rmsErrorDb) {
    passed.push('rms');
  } else {
    failed.push(`rms ${Math.abs(vsRef.rmsErrorDbUnmatched).toFixed(2)} dB > ${t.rmsErrorDb}`);
  }

  if (Math.abs(vsRef.band200800ErrorDb) < t.band200800ErrorDb) {
    passed.push('band200800');
  } else {
    failed.push(
      `band200800 ${Math.abs(vsRef.band200800ErrorDb).toFixed(2)} dB > ${t.band200800ErrorDb}`,
    );
  }

  if (
    vsRef.accentPeakTimingDriftMsAbsMax !== null &&
    vsRef.accentPeakTimingDriftMsAbsMax < t.accentPeakTimingDriftMs
  ) {
    passed.push('accentTiming');
  } else {
    failed.push(
      `accentTiming ${vsRef.accentPeakTimingDriftMsAbsMax?.toFixed(2) ?? 'n/a'} ms > ${t.accentPeakTimingDriftMs}`,
    );
  }

  if (specMse.full < t.spectrogramMseFullDb2) {
    passed.push('spectrogramMse');
  } else {
    failed.push(`spectrogramMse ${specMse.full.toFixed(4)}`);
  }

  return { passed, failed };
}
