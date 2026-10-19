/**
 * Phoneme-driven stereo delay for the singing voice (#1359 UI, DSP here).
 *
 * Runs after the vocal FX chain on the stereo output, like the vocoder, so it
 * sounds the same on the native rb_fx backend and the TS fallback. The current
 * phoneme picks the tap: consonants get a short slap thrown to alternating
 * sides, vowels a longer, centred tail. Delay time and pan glide to the new
 * target (~30 ms one-pole) so a phoneme change never steps the read head.
 *
 * - Ring buffers are allocated once in the constructor; process() allocates nothing.
 * - Feedback is scaled below MAX_FEEDBACK and low-passed in the loop (damping).
 * - amount == 0 is a hard bypass: the output is left untouched, bit for bit.
 *   Turning it off ramps the wet out over one block, then bypasses; turning it
 *   back on starts from a cleared line so an old tail never reappears.
 */

/** Longest tap the line must hold, plus headroom for the glide. */
export const PHONEME_DELAY_MAX_SECONDS = 0.5;
/** Feedback knob 1.0 maps here: always decays. */
export const MAX_FEEDBACK = 0.92;

/** Delay targets in seconds, per channel [L, R]. */
export const CONSONANT_DELAY_SECONDS = [0.045, 0.06] as const;
export const VOWEL_DELAY_SECONDS = [0.22, 0.25] as const;
/** Wet pan for consonant slaps (alternates side per phoneme); vowels sit centred. */
export const CONSONANT_PAN = 0.6;

const DAMPING_HZ = 3500;
const GLIDE_SECONDS = 0.03;
const DENORMAL = 1e-20;
/** Writes are clamped here; also turns NaN into silence so one bad sample cannot poison the line. */
const WRITE_LIMIT = 4;

export interface PhonemeDelayContext {
  /** 1 while streaming a note with phoneme data + ratios. Without it the voice is treated as a vowel. */
  hasPhonemeContext: boolean;
  isVowel: number;
  /** -1 = none. */
  phonemeIndex: number;
}

export class PhonemeDelay {
  private readonly sampleRate: number;
  private readonly size: number;
  private readonly mask: number;
  private readonly lines: [Float32Array, Float32Array];
  private writePos = 0;

  // Smoothed state
  private readonly delaySamples = [0, 0];
  private readonly damp = [0, 0];
  private pan = 0;
  private wetGain = 0;
  private active = false;

  private readonly glideCoeff: number;
  private readonly dampCoeff: number;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    const needed = Math.ceil(PHONEME_DELAY_MAX_SECONDS * sampleRate) + 2;
    let size = 1;
    while (size < needed) size <<= 1;
    this.size = size;
    this.mask = size - 1;
    this.lines = [new Float32Array(size), new Float32Array(size)];
    this.glideCoeff = 1 - Math.exp(-1 / (GLIDE_SECONDS * sampleRate));
    this.dampCoeff = 1 - Math.exp((-2 * Math.PI * DAMPING_HZ) / sampleRate);
  }

  /** True while the delay is audible or ramping out (false = bypassed). */
  get isActive(): boolean {
    return this.active;
  }

  /** Current smoothed tap length for a channel, in samples (for tests / telemetry). */
  tapSamples(channel: 0 | 1): number {
    return this.delaySamples[channel];
  }

  process(
    left: Float32Array,
    right: Float32Array | null,
    amount: number,
    feedback: number,
    ctx: PhonemeDelayContext,
  ): void {
    const targetGain = amount > 0 ? Math.min(1, amount) : 0;
    if (targetGain === 0 && !this.active) return;

    const vowel = !ctx.hasPhonemeContext || ctx.isVowel >= 0.5;
    const times = vowel ? VOWEL_DELAY_SECONDS : CONSONANT_DELAY_SECONDS;
    const targetL = times[0] * this.sampleRate;
    const targetR = times[1] * this.sampleRate;
    let targetPan = 0;
    if (!vowel && right) {
      targetPan = ctx.phonemeIndex >= 0 && (ctx.phonemeIndex & 1) === 1 ? CONSONANT_PAN : -CONSONANT_PAN;
    }

    if (!this.active) {
      // Re-entering from bypass: clear the line and start on target, not mid-glide.
      this.lines[0].fill(0);
      this.lines[1].fill(0);
      this.damp[0] = 0;
      this.damp[1] = 0;
      this.delaySamples[0] = targetL;
      this.delaySamples[1] = targetR;
      this.pan = targetPan;
      this.wetGain = 0;
      this.active = true;
    }

    const fb = Math.max(0, Math.min(1, feedback)) * MAX_FEEDBACK;
    const frames = left.length;
    const gainStep = (targetGain - this.wetGain) / frames;
    const glide = this.glideCoeff;
    const dampK = this.dampCoeff;
    const mask = this.mask;
    const maxDelay = this.size - 2;
    const lineL = this.lines[0];
    const lineR = this.lines[1];

    let gain = this.wetGain;
    let dL = this.delaySamples[0];
    let dR = this.delaySamples[1];
    let pan = this.pan;
    let zL = this.damp[0];
    let zR = this.damp[1];
    let w = this.writePos;

    for (let i = 0; i < frames; i++) {
      gain += gainStep;
      dL += (targetL - dL) * glide;
      dR += (targetR - dR) * glide;
      pan += (targetPan - pan) * glide;

      const tapL = readFrac(lineL, w, dL < maxDelay ? dL : maxDelay, mask);
      zL += (tapL - zL) * dampK;
      if (zL > -DENORMAL && zL < DENORMAL) zL = 0;
      lineL[w] = clampWrite(left[i] + zL * fb);

      if (right) {
        const tapR = readFrac(lineR, w, dR < maxDelay ? dR : maxDelay, mask);
        zR += (tapR - zR) * dampK;
        if (zR > -DENORMAL && zR < DENORMAL) zR = 0;
        lineR[w] = clampWrite(right[i] + zR * fb);
        // Balance law: the side the slap is thrown away from fades, the other stays at unity.
        const gL = pan > 0 ? 1 - pan : 1;
        const gR = pan < 0 ? 1 + pan : 1;
        left[i] += gain * gL * tapL;
        right[i] += gain * gR * tapR;
      } else {
        left[i] += gain * tapL;
      }
      w = (w + 1) & mask;
    }

    this.writePos = w;
    this.delaySamples[0] = dL;
    this.delaySamples[1] = dR;
    this.pan = pan;
    this.damp[0] = zL;
    this.damp[1] = zR;
    this.wetGain = targetGain;
    if (targetGain === 0) this.active = false;
  }
}

/** Linear-interpolated read `delay` samples behind the write head. */
function readFrac(line: Float32Array, writePos: number, delay: number, mask: number): number {
  const whole = delay | 0;
  const frac = delay - whole;
  const a = line[(writePos - whole) & mask];
  const b = line[(writePos - whole - 1) & mask];
  return a + (b - a) * frac;
}

function clampWrite(v: number): number {
  if (v > -WRITE_LIMIT && v < WRITE_LIMIT) {
    return v > -DENORMAL && v < DENORMAL ? 0 : v;
  }
  return v >= WRITE_LIMIT ? WRITE_LIMIT : v <= -WRITE_LIMIT ? -WRITE_LIMIT : 0;
}
