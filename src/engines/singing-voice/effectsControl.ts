import type { SingingVoiceHost } from "./host";

function setWorkletParam(
  host: SingingVoiceHost,
  name: string,
  value: number,
  time?: number,
): void {
  if (host.workletNode) {
    host.workletNode.parameters
      .get(name)
      ?.setValueAtTime(value, time || host.audioContext.currentTime);
  }
}

export const EffectsControlMixin = {
  /**
   * Set vibrato depth percentage.
   * @param percent Vibrato depth (0-100)
   * @param time Optional time to apply the change (default: now)
   */
  setVibratoDepth(
    this: SingingVoiceHost,
    percent: number,
    time?: number,
  ): void {
    setWorkletParam(this, "vibratoDepth", percent / 100, time);
  },

  /**
   * Set vibrato rate in Hz.
   * @param rate Vibrato rate in Hz
   * @param time Optional time to apply the change (default: now)
   */
  setVibratoRate(this: SingingVoiceHost, rate: number, time?: number): void {
    setWorkletParam(this, "vibratoRate", rate, time);
  },

  /**
   * Set gate depth for rhythmic gating effect.
   * @param percent Gate depth (0-100)
   * @param time Optional time to apply the change
   */
  setGateDepth(this: SingingVoiceHost, percent: number, time?: number): void {
    setWorkletParam(this, "gateDepth", percent / 100, time);
  },

  /**
   * Set gate LFO rate in Hz.
   * @param rate Gate rate in Hz
   * @param time Optional time to apply the change
   */
  setGateRate(this: SingingVoiceHost, rate: number, time?: number): void {
    setWorkletParam(this, "gateRate", rate, time);
  },

  /**
   * Set tremolo rate in Hz.
   * @param rate Tremolo rate in Hz
   * @param time Optional time to apply the change (default: now)
   */
  setTremoloRate(this: SingingVoiceHost, rate: number, time?: number): void {
    setWorkletParam(this, "tremoloRate", rate, time);
  },

  /**
   * Set tremolo depth percentage.
   * @param percent Tremolo depth (0-100)
   * @param time Optional time to apply the change (default: now)
   */
  setTremoloDepth(
    this: SingingVoiceHost,
    percent: number,
    time?: number,
  ): void {
    setWorkletParam(this, "tremoloDepth", percent / 100, time);
  },

  /**
   * Set breath intensity.
   * @param intensity Breath intensity (0-1)
   * @param time Optional time to apply the change (default: now)
   */
  setBreathIntensity(
    this: SingingVoiceHost,
    intensity: number,
    time?: number,
  ): void {
    setWorkletParam(this, "breathIntensity", intensity, time);
  },

  /**
   * Set spectral freeze/smear amount.
   * @param amount Freeze amount (0-1)
   * @param time Optional time to apply the change (default: now)
   */
  setFreeze(this: SingingVoiceHost, amount: number, time?: number): void {
    setWorkletParam(this, "freeze", amount, time);
  },

  /**
   * Set spectral freeze LFO rate.
   * @param rate LFO rate in Hz
   * @param time Optional time to apply the change (default: now)
   */
  setFreezeLfoRate(this: SingingVoiceHost, rate: number, time?: number): void {
    setWorkletParam(this, "freezeLfoRate", rate, time);
  },

  /**
   * Set spectral freeze LFO depth.
   * @param depth LFO depth (0-1)
   * @param time Optional time to apply the change (default: now)
   */
  setFreezeLfoDepth(
    this: SingingVoiceHost,
    depth: number,
    time?: number,
  ): void {
    setWorkletParam(this, "freezeLfoDepth", depth, time);
  },

  /**
   * Set envelope follower depth for time stretch modulation.
   * @param depth Depth (-1 to 1)
   * @param time Optional time to apply the change (default: now)
   */
  setTimeStretchEnvDepth(
    this: SingingVoiceHost,
    depth: number,
    time?: number,
  ): void {
    setWorkletParam(this, "timeStretchEnvDepth", depth, time);
  },

  setFreezeEnvDepth(
    this: SingingVoiceHost,
    depth: number,
    time?: number,
  ): void {
    setWorkletParam(this, "freezeEnvDepth", depth, time);
  },

  /**
   * Set envelope follower depth for grain size modulation.
   * @param depth Depth (0-1)
   * @param time Optional time to apply the change (default: now)
   */
  setGrainEnvDepth(
    this: SingingVoiceHost,
    depth: number,
    time?: number,
  ): void {
    setWorkletParam(this, "grainEnvDepth", depth, time);
  },

  /**
   * Set granular position jitter amount.
   * @param amount Jitter amount (0-1)
   * @param time Optional time to apply the change (default: now)
   */
  setGrainJitter(this: SingingVoiceHost, amount: number, time?: number): void {
    setWorkletParam(this, "grainJitter", amount, time);
  },

  /**
   * Set granular pitch envelope depth.
   * @param depth Depth (0-1)
   * @param time Optional time to apply the change (default: now)
   */
  setGrainPitchEnvDepth(
    this: SingingVoiceHost,
    depth: number,
    time?: number,
  ): void {
    setWorkletParam(this, "grainPitchEnvDepth", depth, time);
  },

  /**
   * Set granular pitch quantization interval in semitones.
   * 0 = off, 1 = chromatic, 3 = minor third, 4 = major third,
   * 5 = fourth, 7 = fifth, 12 = octave.
   * @param semitones Interval size in semitones (0-12)
   * @param time Optional time to apply the change (default: now)
   */
  setGrainPitchQuantize(
    this: SingingVoiceHost,
    semitones: number,
    time?: number,
  ): void {
    setWorkletParam(this, "grainPitchQuantize", semitones, time);
  },

  /**
   * Set the granular pitch shift amount.
   * @param semitones The amount to pitch shift in semitones (-24.0 to 24.0)
   * @param time Optional time to apply the change (default: now)
   */
  setGranularPitchShift(
    this: SingingVoiceHost,
    semitones: number,
    time?: number,
  ): void {
    setWorkletParam(this, "granularPitchShift", semitones, time);
  },

  /**
   * Set the trance gate depth.
   * @param amount Gate depth (0.0 - 1.0)
   * @param time Optional time to apply the change (default: now)
   */
  setTranceGate(this: SingingVoiceHost, amount: number, time?: number): void {
    setWorkletParam(this, "tranceGate", amount, time);
  },

  /**
   * Set amplitude envelope attack time.
   * @param attack Attack time in seconds
   * @param time Optional time to apply the change (default: now)
   */
  setAttack(this: SingingVoiceHost, attack: number, time?: number): void {
    this.currentAttack = attack;
    setWorkletParam(this, "attack", attack, time);
  },

  /**
   * Set amplitude envelope decay time.
   * @param decay Decay time in seconds
   * @param time Optional time to apply the change (default: now)
   */
  setDecay(this: SingingVoiceHost, decay: number, time?: number): void {
    this.currentDecay = decay;
    setWorkletParam(this, "decay", decay, time);
  },

  /**
   * Set amplitude envelope sustain level.
   * @param sustain Sustain level (0-1)
   * @param time Optional time to apply the change (default: now)
   */
  setSustain(this: SingingVoiceHost, sustain: number, time?: number): void {
    setWorkletParam(this, "sustain", sustain, time);
  },

  /**
   * Set amplitude envelope release time.
   * @param release Release time in seconds
   * @param time Optional time to apply the change (default: now)
   */
  setRelease(this: SingingVoiceHost, release: number, time?: number): void {
    setWorkletParam(this, "release", release, time);
  },

  /**
   * Trigger release phase of the amplitude envelope.
   * @param time Optional time to trigger the release
   */
  noteOff(this: SingingVoiceHost, time?: number): void {
    if (this.workletNode) {
      this.workletNode.port.postMessage({
        type: "noteOff",
        data: {
          time: time || this.audioContext.currentTime,
        },
      });
    }
    this.isActive = false;
  },

  /**
   * Set bitcrush amount.
   * @param amount Bitcrush amount (0-1)
   * @param time Optional time to apply the change
   */
  setBitcrush(this: SingingVoiceHost, amount: number, time?: number): void {
    setWorkletParam(this, "bitcrush", amount, time);
  },

  /**
   * Set downsample factor.
   * @param factor Downsample factor (1-32)
   * @param time Optional time to apply the change
   */
  setDownsample(this: SingingVoiceHost, factor: number, time?: number): void {
    setWorkletParam(this, "downsample", factor, time);
  },
};
