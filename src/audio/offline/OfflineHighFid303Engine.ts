/**
 * Offline High-Fidelity TB-303 engine (Phase-2 / #975) — TypeScript port.
 *
 * Mirrors emscripten/highfid303_wrapper.cpp for the worker path:
 *   diode-ladder (mystran/kunn) + feedback HP + diode shape + PolyBLEP +
 *   coupled accent envelope + oversampling.
 *
 * Engine id: `highfid-cpu` (offline-only).
 */

import type { OversampleFactor } from './OfflineOpen303Engine';
import {
  clampOversample,
  type Offline303Params,
  type Offline303PatternData,
  DEFAULT_OFFLINE_303_PARAMS,
} from './OfflineOpen303Engine';

const TWO_PI = Math.PI * 2;
const SQRT2 = Math.SQRT2;
const ACCENT_VELOCITY_THRESHOLD = 100;
const FEEDBACK_HP_HZ = 150;

function fastTanh(x: number): number {
  const x2 = x * x;
  return (x * (27 + x2)) / (27 + 9 * x2);
}

function clampf(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function diodeShape(x: number): number {
  x = clampf(x, -SQRT2, SQRT2);
  return x - (x * x * x) / 6;
}

function polyBlep(t: number, dt: number): number {
  if (dt <= 0) return 0;
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}

function midiToFreq(midiNote: number): number {
  return 440 * Math.pow(2, (midiNote - 69) / 12);
}

class OnePoleHP {
  private b0 = 1;
  private b1 = 0;
  private a1 = 0;
  private x1 = 0;
  private y1 = 0;

  setCutoff(hz: number, sampleRate: number): void {
    hz = clampf(hz, 1, sampleRate * 0.45);
    const wc = (TWO_PI * hz) / sampleRate;
    const t = Math.tan(wc * 0.5);
    const c = (1 - t) / (1 + t);
    this.a1 = c;
    this.b0 = (1 + c) * 0.5;
    this.b1 = -(1 + c) * 0.5;
  }

  process(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.a1 * this.y1;
    this.x1 = x;
    this.y1 = y;
    return y;
  }

  reset(): void {
    this.x1 = this.y1 = 0;
  }
}

class DiodeLadderFilter {
  private y1 = 0;
  private y2 = 0;
  private y3 = 0;
  private y4 = 0;
  private b0 = 0.5;
  private k = 0;
  private g = 1;
  private sampleRate = 44100;
  private feedbackHp = new OnePoleHP();
  private oscLpY = 0;
  private oscLpCoeff = 0.5;

  setSampleRate(sr: number): void {
    this.sampleRate = sr;
    this.feedbackHp.setCutoff(FEEDBACK_HP_HZ, sr);
  }

  reset(): void {
    this.y1 = this.y2 = this.y3 = this.y4 = 0;
    this.oscLpY = 0;
    this.feedbackHp.reset();
  }

  setCutoffResonance(cutoffHz: number, resonance01: number): void {
    cutoffHz = clampf(cutoffHz, 40, this.sampleRate * 0.45);
    const r = clampf(resonance01, 0, 1);
    const resonanceSkewed = (1 - Math.exp(-3 * r)) / (1 - Math.exp(-3));
    const wc = (TWO_PI * cutoffHz) / this.sampleRate;
    const fx = (wc * 0.7071067811865476) / TWO_PI;

    this.b0 =
      (0.00045522346 + 6.1922189 * fx) /
      (1.0 + 12.358354 * fx + 4.4156345 * (fx * fx));

    const kScale =
      fx *
        (fx *
          (fx * (fx * (fx * (fx + 7198.6997) - 5837.7917) - 476.47308) + 614.95611) +
          213.87126) +
      16.998792;
    this.g = kScale * 0.058823529411764705;
    this.g = (this.g - 1) * resonanceSkewed + 1;
    this.g = this.g * (1 + resonanceSkewed);
    this.k = kScale * resonanceSkewed;

    const lpHz = clampf(cutoffHz * 2.5, 200, this.sampleRate * 0.4);
    const lpWc = (TWO_PI * lpHz) / this.sampleRate;
    this.oscLpCoeff = lpWc / (1 + lpWc);
  }

  process(input: number): number {
    this.oscLpY += this.oscLpCoeff * (input - this.oscLpY);
    input = this.oscLpY;

    const fb = this.feedbackHp.process(this.k * diodeShape(this.y4));
    const y0 = input - fb;
    this.y1 += 2 * this.b0 * (y0 - this.y1 + this.y2);
    this.y2 += this.b0 * (this.y1 - 2 * this.y2 + this.y3);
    this.y3 += this.b0 * (this.y2 - 2 * this.y3 + this.y4);
    this.y4 += this.b0 * (this.y3 - 2 * this.y4);
    this.y1 = clampf(this.y1, -8, 8);
    this.y2 = clampf(this.y2, -8, 8);
    this.y3 = clampf(this.y3, -8, 8);
    this.y4 = clampf(this.y4, -8, 8);
    const out = 2 * this.g * this.y4;
    if (!Number.isFinite(out)) {
      this.reset();
      return 0;
    }
    return out;
  }
};

export const HIGHFID_CPU_MODEL_ID = 'highfid-cpu' as const;

export class OfflineHighFid303Engine {
  private sampleRate: number;
  private oversample: OversampleFactor = 1;
  private params: Offline303Params;
  private filter = new DiodeLadderFilter();

  private phase = 0;
  private currentFreq = 440;
  private targetFreq = 440;
  private slideCoeff = 1;
  private envLevel = 0;
  private envDecayRate = 0.999;
  private accentEnv = 0;
  private accentAttackRate = 0;
  private accentDecayRate = 0;
  private accentAttacking = false;
  private accented = false;
  private gateOpen = false;

  constructor(
    sampleRate = 44100,
    params: Partial<Offline303Params> = {},
  ) {
    this.sampleRate = sampleRate;
    this.params = { ...DEFAULT_OFFLINE_303_PARAMS, ...params };
    this.filter.setSampleRate(this.effectiveSampleRate());
    this.updateRates();
    this.updateFilterCoeffs();
  }

  setOversample(factor: OversampleFactor): void {
    this.oversample = clampOversample(factor);
    this.filter.setSampleRate(this.effectiveSampleRate());
    this.updateRates();
    this.updateFilterCoeffs();
  }

  getOversample(): OversampleFactor {
    return this.oversample;
  }

  setParams(partial: Partial<Offline303Params>): void {
    this.params = { ...this.params, ...partial };
    this.updateRates();
    this.updateFilterCoeffs();
  }

  private effectiveSampleRate(): number {
    return this.sampleRate * this.oversample;
  }

  private updateRates(): void {
    const sr = this.effectiveSampleRate();
    let timeS = 0.05 + this.params.decay * 1.95;
    if (this.accented) timeS *= 0.05 + this.params.accentDecay * 0.95;
    this.envDecayRate = Math.exp(-1 / (sr * timeS));
    this.accentAttackRate = 1 - Math.exp(-1 / (sr * 0.003));
    const accDecS = 0.04 + this.params.accent * 0.08;
    this.accentDecayRate = Math.exp(-1 / (sr * accDecS));
  }

  private updateFilterCoeffs(): void {
    const envBoost =
      this.params.envMod * this.envLevel +
      (this.accented ? this.params.accent * 0.45 * this.accentEnv : 0);
    const total = clampf(this.params.cutoff + envBoost, 0, 1);
    const hz = 200 * Math.pow(4500 / 200, total);
    this.filter.setCutoffResonance(hz, this.params.resonance);
  }

  noteOn(midiNote: number, velocity: number): void {
    const freq = midiToFreq(midiNote);
    this.targetFreq = freq;
    if (this.gateOpen && this.params.slideTime > 0 && this.currentFreq > 0) {
      const slideSeconds = 0.01 + this.params.slideTime * 0.49;
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
    if (this.accented) {
      this.accentEnv = 0;
      this.accentAttacking = true;
    } else {
      this.accentEnv = 0;
      this.accentAttacking = false;
    }
    this.updateRates();
    this.updateFilterCoeffs();
  }

  noteOff(_midiNote?: number): void {
    this.gateOpen = false;
  }

  allNotesOff(): void {
    this.gateOpen = false;
    this.envLevel = 0;
    this.accentEnv = 0;
    this.accentAttacking = false;
    this.currentFreq = this.targetFreq;
    this.slideCoeff = 1;
    this.filter.reset();
  }

  private renderOsc(srEff: number): number {
    const phaseInc = this.currentFreq / srEff;
    this.phase += phaseInc;
    if (this.phase >= 1) this.phase -= 1;

    if (this.params.waveform < 0.5) {
      let osc = 2 * this.phase - 1;
      osc -= polyBlep(this.phase, phaseInc);
      return osc;
    }
    let sq = this.phase < 0.5 ? 1 : -1;
    sq += polyBlep(this.phase, phaseInc);
    let t2 = this.phase + 0.5;
    if (t2 >= 1) t2 -= 1;
    sq -= polyBlep(t2, phaseInc);
    const drive = 1 + this.params.squareDrv * 2.5;
    return fastTanh(sq * drive);
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

    this.envLevel *= this.envDecayRate;
    if (this.envLevel < 1e-6) this.envLevel = 0;

    if (this.accented) {
      if (this.accentAttacking) {
        this.accentEnv += (1 - this.accentEnv) * this.accentAttackRate;
        if (this.accentEnv > 0.995) {
          this.accentEnv = 1;
          this.accentAttacking = false;
        }
      } else {
        this.accentEnv *= this.accentDecayRate;
        if (this.accentEnv < 1e-6) this.accentEnv = 0;
      }
    }

    this.updateFilterCoeffs();
    const osc = this.renderOsc(srEff);
    const filtered = this.filter.process(osc);
    let gain = this.params.volume;
    if (this.accented) gain *= 1 + this.params.accent * 0.35 * this.accentEnv;
    const out = filtered * gain * 0.55;
    if (!Number.isFinite(out)) {
      this.filter.reset();
      return 0;
    }
    return clampf(out, -1.5, 1.5);
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
      for (let s = 0; s < n; s++) acc += this.renderSampleAt(srEff);
      output[i] = acc * invN;
    }
  }
}

export function isHighFidCpuModel(modelId: string): boolean {
  return modelId === HIGHFID_CPU_MODEL_ID || modelId === 'highfid';
}

/** Render a pattern through the highfid-cpu diode-ladder engine. */
export function renderOfflineHighFid303Pattern(
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
  const stepDur = pattern.stepDurationSec ?? (60 / tempo) / 4;

  const engine = new OfflineHighFid303Engine(sampleRate, pattern.params);
  engine.setOversample(oversample);

  const framesPerStep = Math.max(1, Math.round(stepDur * sampleRate));
  const totalFrames = framesPerStep * pattern.steps.length;
  const out = new Float32Array(totalFrames);
  const block = new Float32Array(blockSize);

  let write = 0;
  let prevNote = -1;
  for (const step of pattern.steps) {
    if (!step.slide && prevNote >= 0) engine.noteOff(prevNote);
    const vel = step.velocity ?? (step.accent ? 120 : 90);
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
