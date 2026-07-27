/**
 * Offline Open303-family soft engine (Phase-1 / #974).
 *
 * Faithful TypeScript port of the open303_wrapper.cpp DSP used by the
 * real-time worklet, with an explicit OVERSAMPLE_FACTOR (1|2|4).
 *
 * Designed for worker / freeze / export paths — never touches AudioWorklet.
 * Each instance owns its filter + envelope state (thread-local); concurrent
 * voices must use separate instances.
 */

export type OversampleFactor = 1 | 2 | 4;

export interface Offline303Params {
  waveform: number;
  cutoff: number;
  resonance: number;
  envMod: number;
  decay: number;
  accent: number;
  volume: number;
  slideTime: number;
  accentDecay: number;
  squareDrv: number;
}

export interface Offline303ModelProfile {
  id: string;
  label: string;
  cutoffBaseHz: number;
  cutoffRangeMul: number;
  resFeedback: number;
  accentFilterBoost: number;
  accentGainBoost: number;
  decayMinS: number;
  decayRangeS: number;
  slideMinS: number;
  slideRangeS: number;
  squareDriveMul: number;
  sawDrive: number;
}

/** Mirrors k303Models open303-family rows in open303_wrapper.cpp. */
export const OFFLINE_303_MODELS: readonly Offline303ModelProfile[] = [
  {
    id: 'stock-open303',
    label: 'Stock Open303',
    cutoffBaseHz: 20,
    cutoffRangeMul: 400,
    resFeedback: 3.9,
    accentFilterBoost: 0.4,
    accentGainBoost: 0.3,
    decayMinS: 0.05,
    decayRangeS: 1.95,
    slideMinS: 0.01,
    slideRangeS: 0.49,
    squareDriveMul: 3.0,
    sawDrive: 0.0,
  },
  {
    id: '1ink303-v1',
    label: '1ink303 v1',
    cutoffBaseHz: 26,
    cutoffRangeMul: 340,
    resFeedback: 4.0,
    accentFilterBoost: 0.35,
    accentGainBoost: 0.38,
    decayMinS: 0.04,
    decayRangeS: 1.6,
    slideMinS: 0.02,
    slideRangeS: 0.6,
    squareDriveMul: 2.4,
    sawDrive: 0.35,
  },
  {
    id: 'experimental-01',
    label: 'Experimental 01',
    cutoffBaseHz: 20,
    cutoffRangeMul: 420,
    resFeedback: 4.15,
    accentFilterBoost: 0.55,
    accentGainBoost: 0.45,
    decayMinS: 0.03,
    decayRangeS: 1.2,
    slideMinS: 0.008,
    slideRangeS: 0.4,
    squareDriveMul: 4.5,
    sawDrive: 0.0,
  },
  {
    id: 'rebirth-338-1.5',
    label: 'ReBirth RB-338 1.5',
    cutoffBaseHz: 22,
    cutoffRangeMul: 380,
    resFeedback: 4.1,
    accentFilterBoost: 0.5,
    accentGainBoost: 0.32,
    decayMinS: 0.04,
    decayRangeS: 1.6,
    slideMinS: 0.02,
    slideRangeS: 0.6,
    squareDriveMul: 3.0,
    sawDrive: 0.2,
  },
  {
    id: 'rebirth-2.0',
    label: 'ReBirth 2.0',
    cutoffBaseHz: 20,
    cutoffRangeMul: 410,
    resFeedback: 3.95,
    accentFilterBoost: 0.6,
    accentGainBoost: 0.42,
    decayMinS: 0.035,
    decayRangeS: 1.4,
    slideMinS: 0.012,
    slideRangeS: 0.5,
    squareDriveMul: 3.4,
    sawDrive: 0.12,
  },
  {
    id: 'mb33-mkii',
    label: 'MB33 mkII',
    cutoffBaseHz: 24,
    cutoffRangeMul: 360,
    resFeedback: 3.85,
    accentFilterBoost: 0.52,
    accentGainBoost: 0.38,
    decayMinS: 0.045,
    decayRangeS: 1.7,
    slideMinS: 0.014,
    slideRangeS: 0.45,
    squareDriveMul: 3.8,
    sawDrive: 0.25,
  },
  {
    id: 'raveolution',
    label: 'Raveolution 309',
    cutoffBaseHz: 18,
    cutoffRangeMul: 440,
    resFeedback: 4.25,
    accentFilterBoost: 0.58,
    accentGainBoost: 0.48,
    decayMinS: 0.028,
    decayRangeS: 1.15,
    slideMinS: 0.006,
    slideRangeS: 0.35,
    squareDriveMul: 4.2,
    sawDrive: 0.08,
  },
] as const;

const ACCENT_VELOCITY_THRESHOLD = 100;
const TWO_PI = Math.PI * 2;

function fastTanh(x: number): number {
  const x2 = x * x;
  return (x * (27 + x2)) / (27 + 9 * x2);
}

function midiToFreq(midiNote: number): number {
  return 440 * Math.pow(2, (midiNote - 69) / 12);
}

export function resolveOffline303Model(modelId: string): Offline303ModelProfile {
  const found = OFFLINE_303_MODELS.find((m) => m.id === modelId);
  // jc303 / unknown → stock open303 coefficients for the soft offline path
  return found ?? OFFLINE_303_MODELS[0];
}

export function clampOversample(factor: number | undefined): OversampleFactor {
  if (factor === 2 || factor === 4) return factor;
  return 1;
}

class MoogFilter {
  private s = [0, 0, 0, 0];

  process(input: number, freqHz: number, k: number, sampleRate: number): number {
    const capped = Math.min(freqHz, sampleRate * 0.49);
    const g = (TWO_PI * capped) / sampleRate;
    const gp = g / (1 + g);
    const fb = k * this.s[3];
    const inFb = fastTanh(input - fb);

    const v0 = (inFb - this.s[0]) * gp;
    const y0 = v0 + this.s[0];
    this.s[0] = y0 + v0;
    const v1 = (y0 - this.s[1]) * gp;
    const y1 = v1 + this.s[1];
    this.s[1] = y1 + v1;
    const v2 = (y1 - this.s[2]) * gp;
    const y2 = v2 + this.s[2];
    this.s[2] = y2 + v2;
    const v3 = (y2 - this.s[3]) * gp;
    const y3 = v3 + this.s[3];
    this.s[3] = y3 + v3;
    return y3;
  }

  reset(): void {
    this.s[0] = this.s[1] = this.s[2] = this.s[3] = 0;
  }
}

export const DEFAULT_OFFLINE_303_PARAMS: Offline303Params = {
  waveform: 0,
  cutoff: 0.35,
  resonance: 0.7,
  envMod: 0.55,
  decay: 0.5,
  accent: 0.7,
  volume: 0.8,
  slideTime: 0.33,
  accentDecay: 0.03,
  squareDrv: 0.25,
};

export class OfflineOpen303Engine {
  private sampleRate: number;
  private oversample: OversampleFactor = 1;
  private profile: Offline303ModelProfile;
  private params: Offline303Params;
  private filter = new MoogFilter();

  private phase = 0;
  private currentFreq = 440;
  private targetFreq = 440;
  private slideCoeff = 1;
  private envLevel = 0;
  private envDecayRate = 0.999;
  private gateOpen = false;
  private accented = false;

  constructor(
    sampleRate = 44100,
    modelId = 'stock-open303',
    params: Partial<Offline303Params> = {},
  ) {
    this.sampleRate = sampleRate;
    this.profile = resolveOffline303Model(modelId);
    this.params = { ...DEFAULT_OFFLINE_303_PARAMS, ...params };
    this.updateDecayRate();
  }

  setOversample(factor: OversampleFactor): void {
    this.oversample = clampOversample(factor);
    this.updateDecayRate();
  }

  getOversample(): OversampleFactor {
    return this.oversample;
  }

  setModel(modelId: string): void {
    this.profile = resolveOffline303Model(modelId);
    this.updateDecayRate();
  }

  setParams(partial: Partial<Offline303Params>): void {
    this.params = { ...this.params, ...partial };
    this.updateDecayRate();
  }

  private effectiveSampleRate(): number {
    return this.sampleRate * this.oversample;
  }

  private updateDecayRate(): void {
    let timeS = this.profile.decayMinS + this.params.decay * this.profile.decayRangeS;
    if (this.accented) timeS *= 0.05 + this.params.accentDecay * 0.95;
    this.envDecayRate = Math.exp(-1 / (this.effectiveSampleRate() * timeS));
  }

  noteOn(midiNote: number, velocity: number): void {
    const freq = midiToFreq(midiNote);
    this.targetFreq = freq;

    if (this.gateOpen && this.params.slideTime > 0 && this.currentFreq > 0) {
      const slideSeconds =
        this.profile.slideMinS + this.params.slideTime * this.profile.slideRangeS;
      const ratio = this.targetFreq / this.currentFreq;
      if (ratio > 0 && ratio !== 1) {
        this.slideCoeff = Math.pow(ratio, 1 / (slideSeconds * this.effectiveSampleRate()));
      } else {
        this.slideCoeff = 1;
        this.currentFreq = this.targetFreq;
      }
    } else {
      this.currentFreq = freq;
      this.slideCoeff = 1;
    }

    this.accented = velocity > ACCENT_VELOCITY_THRESHOLD;
    this.gateOpen = true;
    this.envLevel = 1;
    this.updateDecayRate();
  }

  noteOff(_midiNote?: number): void {
    this.gateOpen = false;
  }

  allNotesOff(): void {
    this.gateOpen = false;
    this.envLevel = 0;
    this.currentFreq = this.targetFreq;
    this.slideCoeff = 1;
    this.filter.reset();
  }

  private renderSampleAt(srEff: number): number {
    if (this.slideCoeff !== 1) {
      this.currentFreq *= this.slideCoeff;
      const reached =
        this.slideCoeff > 1
          ? this.currentFreq >= this.targetFreq
          : this.currentFreq <= this.targetFreq;
      if (reached) {
        this.currentFreq = this.targetFreq;
        this.slideCoeff = 1;
      }
    }

    const phaseInc = this.currentFreq / srEff;
    this.phase += phaseInc;
    if (this.phase >= 1) this.phase -= 1;

    let osc: number;
    if (this.params.waveform < 0.5) {
      osc = 2 * this.phase - 1;
      if (this.profile.sawDrive > 0) {
        osc = fastTanh(osc * (1 + this.profile.sawDrive));
      }
    } else {
      const sq = this.phase < 0.5 ? 1 : -1;
      const drive = 1 + this.params.squareDrv * this.profile.squareDriveMul;
      osc = fastTanh(sq * drive);
    }

    this.envLevel *= this.envDecayRate;
    if (this.envLevel < 1e-6) this.envLevel = 0;

    const accentBoost = this.accented
      ? this.params.accent * this.profile.accentFilterBoost * this.envLevel
      : 0;
    const totalCutoff = Math.min(
      1,
      this.params.cutoff + this.params.envMod * this.envLevel + accentBoost,
    );
    const freqHz =
      this.profile.cutoffBaseHz * Math.pow(this.profile.cutoffRangeMul, totalCutoff);
    const k = this.params.resonance * this.profile.resFeedback;
    const filtered = this.filter.process(osc, freqHz, k, srEff);

    let gain = this.params.volume;
    if (this.accented) {
      gain *= 1 + this.params.accent * this.profile.accentGainBoost;
    }
    return filtered * gain;
  }

  process(output: Float32Array, numFrames = output.length): void {
    const n = this.oversample;
    const srEff = this.sampleRate * n;
    if (n === 1) {
      for (let i = 0; i < numFrames; i++) {
        output[i] = this.renderSampleAt(srEff);
      }
      return;
    }
    const invN = 1 / n;
    for (let i = 0; i < numFrames; i++) {
      let acc = 0;
      for (let s = 0; s < n; s++) {
        acc += this.renderSampleAt(srEff);
      }
      output[i] = acc * invN;
    }
  }
}

export interface Offline303Step {
  /** MIDI note number */
  note: number;
  velocity?: number;
  /** Accent if velocity omitted and accent=true */
  accent?: boolean;
  /** Legato / slide into this step (no note-off first) */
  slide?: boolean;
}

export interface Offline303PatternData {
  steps: Offline303Step[];
  /** Seconds per step (default derived from tempo / 4 for 16th notes) */
  stepDurationSec?: number;
  tempo?: number;
  params?: Partial<Offline303Params>;
}

/**
 * Render a step pattern through a fresh OfflineOpen303Engine instance.
 * Deterministic for a given (modelId, pattern, oversample, sampleRate).
 */
export function renderOffline303Pattern(
  modelId: string,
  pattern: Offline303PatternData,
  options: {
    oversample?: OversampleFactor;
    sampleRate?: number;
    blockSize?: number;
  } = {},
): Float32Array {
  const sampleRate = options.sampleRate ?? 44100;
  const oversample = clampOversample(options.oversample);
  const blockSize = options.blockSize ?? 128;
  const tempo = pattern.tempo ?? 120;
  const stepDur =
    pattern.stepDurationSec ?? (60 / tempo) / 4; // 16th notes

  const engine = new OfflineOpen303Engine(sampleRate, modelId, pattern.params);
  engine.setOversample(oversample);

  const framesPerStep = Math.max(1, Math.round(stepDur * sampleRate));
  const totalFrames = framesPerStep * pattern.steps.length;
  const out = new Float32Array(totalFrames);
  const block = new Float32Array(blockSize);

  let write = 0;
  let prevNote = -1;

  for (const step of pattern.steps) {
    if (!step.slide && prevNote >= 0) {
      engine.noteOff(prevNote);
    }
    const vel =
      step.velocity ??
      (step.accent ? 120 : 90);
    engine.noteOn(step.note, vel);
    prevNote = step.note;

    let remaining = framesPerStep;
    while (remaining > 0) {
      const n = Math.min(blockSize, remaining);
      engine.process(block, n);
      out.set(block.subarray(0, n), write);
      write += n;
      remaining -= n;
    }
  }

  return out;
}

/** Mix mono voice buffers sample-wise (OpenMP analogue on the JS side). */
export function mixVoiceBuffersJs(
  voices: Float32Array[],
  gains?: number[],
): Float32Array {
  if (voices.length === 0) return new Float32Array(0);
  const len = voices[0].length;
  const out = new Float32Array(len);
  for (let v = 0; v < voices.length; v++) {
    const voice = voices[v];
    const g = gains?.[v] ?? 1;
    const n = Math.min(len, voice.length);
    for (let i = 0; i < n; i++) {
      out[i] += voice[i] * g;
    }
  }
  return out;
}

/** True if buffer contains NaN or Infinity. */
export function bufferHasNonFinite(buf: Float32Array): boolean {
  for (let i = 0; i < buf.length; i++) {
    if (!Number.isFinite(buf[i])) return true;
  }
  return false;
}
