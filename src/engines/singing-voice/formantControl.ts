import type { VoiceCharacter } from "../rubberband/FormantShifter";
import type { SingingVoiceHost } from "./host";

export const FormantControlMixin = {
  /**
   * Set custom LFO shape for formant shifting.
   * @param shape Array of normalized values (0.0 to 1.0)
   */
  setFormantLfoShape(
    this: SingingVoiceHost,
    shape: number[] | undefined,
  ): void {
    if (this.formantShifter && this.config.enableFormantShifting) {
      this.formantShifter.setCustomLfoShape(shape);
    }
  },

  /**
   * Set voice character for formant shifting (Section 4).
   *
   * @param character Target voice character
   * @param sourceCharacter Source voice character (default: 'default')
   */
  setVoiceCharacter(
    this: SingingVoiceHost,
    character: VoiceCharacter,
    sourceCharacter: VoiceCharacter = "default",
  ): void {
    if (!this.formantShifter) {
      console.warn(
        "FormantShifter not enabled. Set enableFormantShifting: true in config.",
      );
      return;
    }

    this.formantShifter.createCharacterFilterChain(character, sourceCharacter);
    this.config.voiceCharacter = character;
  },

  /**
   * Get the formant shifter for advanced control.
   * Returns null if formant shifting is not enabled.
   */
  getFormantShifter(this: SingingVoiceHost) {
    return this.formantShifter;
  },

  /**
   * Set formant LFO rate in Hz.
   * @param rate LFO rate in Hz
   * @param time Optional time to apply the change (default: now)
   */
  setFormantLfoRate(
    this: SingingVoiceHost,
    rate: number,
    time?: number,
  ): void {
    if (this.formantShifter && this.config.enableFormantShifting) {
      this.formantShifter.setLfoRate(rate, time);
    }
  },

  /**
   * Set formant LFO depth.
   * @param depth LFO depth (0-1)
   * @param time Optional time to apply the change (default: now)
   */
  setFormantLfoDepth(
    this: SingingVoiceHost,
    depth: number,
    time?: number,
  ): void {
    if (this.formantShifter && this.config.enableFormantShifting) {
      this.formantShifter.setLfoDepth(depth, time);
    }
  },

  /**
   * Set formant shift in semitones.
   * @param semitones Formant shift in semitones (e.g., -12 to 12)
   * @param time Optional time to apply the change (default: now)
   * @param rampTime Optional duration to ramp to the new formant value smoothly
   */
  setFormantShift(
    this: SingingVoiceHost,
    semitones: number,
    time?: number,
    rampTime: number = 0.05,
  ): void {
    if (this.formantShifter && this.config.enableFormantShifting) {
      const shift = {
        f1Shift: semitones,
        f2Shift: semitones,
        f3Shift: semitones,
        f4Shift: semitones,
      };
      this.formantShifter.updateFilterChain(shift, rampTime);
    }
  },

  /**
   * Glide formant shift from a starting value to an end value.
   */
  setFormantGlide(
    this: SingingVoiceHost,
    startSemitones: number,
    endSemitones: number,
    startTime: number,
    duration: number,
  ): void {
    if (this.formantShifter && this.config.enableFormantShifting) {
      // First jump to start without ramping
      const startShift = {
        f1Shift: startSemitones,
        f2Shift: startSemitones,
        f3Shift: startSemitones,
        f4Shift: startSemitones,
      };
      this.formantShifter.updateFilterChain(startShift, 0, startTime);

      // Then ramp to end over duration
      const endShift = {
        f1Shift: endSemitones,
        f2Shift: endSemitones,
        f3Shift: endSemitones,
        f4Shift: endSemitones,
      };
      this.formantShifter.updateFilterChain(endShift, duration, startTime);
    }
  },

  /**
   * Set the amount of formant shift driven by the amplitude envelope follower.
   * @param amount Peak shift amount in semitones (-24 to 24)
   * @param time Optional time to apply the change
   */
  setFormantEnvFollower(
    this: SingingVoiceHost,
    amount: number,
    time?: number,
  ): void {
    if (this.formantShifter && this.config.enableFormantShifting) {
      this.formantShifter.setEnvFollowerDepth(amount, time);
    }
  },

  /**
   * Trigger a formant envelope.
   */
  setFormantEnvelope(
    this: SingingVoiceHost,
    amount: number,
    attack: number,
    decay: number,
    triggerTime: number,
  ) {
    if (this.formantShifter && this.config.enableFormantShifting) {
      this.formantShifter.triggerEnvelope(amount, attack, decay, triggerTime);
    }
  },

  /**
   * Set formant sidechain depth on the voice.
   */
  setFormantSidechainDepth(this: SingingVoiceHost, depth: number): void {
    (this as any).formantSidechainDepth = depth;
  },

  /**
   * Trigger a formant sidechain duck.
   */
  triggerFormantSidechainDuck(
    this: SingingVoiceHost,
    amount: number,
    releaseTime: number,
    triggerTime?: number,
  ) {
    if (this.formantShifter && this.config.enableFormantShifting) {
      this.formantShifter.triggerSidechainDuck(amount, releaseTime, triggerTime);
    }
  },

  /**
   * Set character morphing amount and target.
   * @param amount Morph amount (0 to 1)
   * @param target Target voice character
   * @param rampTime Optional duration to ramp to the new formant value smoothly
   */
  setCharacterMorph(
    this: SingingVoiceHost,
    amount: number,
    target: VoiceCharacter,
    rampTime: number = 0.05,
  ): void {
    if (this.formantShifter && this.config.enableFormantShifting) {
      const shift = this.formantShifter.interpolateCharacters(
        "default",
        target,
        amount,
      );
      this.formantShifter.updateFilterChain(shift, rampTime);
    }
  },
};
