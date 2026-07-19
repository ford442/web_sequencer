import {
  type ScaleDefinition,
  applyMicrotonalTuning,
} from "../../utils/musicTheory";
import {
  PITCH_RATIO_LIMITS,
  REFERENCE_FREQUENCIES,
  type PitchCache,
} from "./constants";
import { midiToFreq } from "./pitchUtils";
import type { SingingVoiceHost } from "./host";

export const PitchControlMixin = {
  /**
   * Set pitch envelope amount.
   * @param amount Amount in semitones (-24 to 24)
   * @param time Optional time to apply the change (default: now)
   */
  setPitchAmount(this: SingingVoiceHost, amount: number, time?: number): void {
    this.pitchAmount = amount;
    if (this.workletNode) {
      this.workletNode.parameters
        .get("pitchAmount")
        ?.setValueAtTime(
          this.pitchAmount,
          time || this.audioContext.currentTime,
        );
    }
  },

  /**
   * Get the current pitch envelope amount.
   * @returns Amount in semitones
   */
  getPitchAmount(this: SingingVoiceHost): number {
    return this.pitchAmount;
  },

  /**
   * Set the pitch scale ratio.
   * @param ratio Pitch multiplier (e.g., 2.0 = one octave up, 0.5 = one octave down)
   * @param time Optional time to apply the change (default: now)
   */
  setPitch(this: SingingVoiceHost, ratio: number, time?: number): void {
    if (this.workletNode) {
      const t = time || this.audioContext.currentTime;
      const param = this.workletNode.parameters.get("pitchScale")!;
      param.cancelScheduledValues(t);
      param.setValueAtTime(ratio, t);
    }
  },

  /**
   * Linearly ramp the pitch scale ratio to the given target.
   * @param ratio Target pitch multiplier
   * @param time Time to reach the target ratio
   */
  linearRampToPitch(
    this: SingingVoiceHost,
    ratio: number,
    time: number,
  ): void {
    if (this.workletNode) {
      this.workletNode.parameters
        .get("pitchScale")!
        .linearRampToValueAtTime(ratio, time);
    }
  },

  /**
   * Exponentially ramp the pitch scale ratio to the given target.
   * @param ratio Target pitch multiplier
   * @param time Time to reach the target ratio
   */
  exponentialRampToPitch(
    this: SingingVoiceHost,
    ratio: number,
    time: number,
  ): void {
    if (this.workletNode) {
      this.workletNode.parameters
        .get("pitchScale")!
        .exponentialRampToValueAtTime(ratio, time);
    }
  },

  /**
   * Linearly ramp the pitch from current value to the target MIDI note.
   */
  linearRampPitchFromMidi(
    this: SingingVoiceHost,
    targetMidiNote: number,
    baseMidiNote?: number,
    time?: number,
    coarseTune?: number,
    fineTune?: number,
    tuning?: ScaleDefinition | null,
  ): void {
    const effectiveBaseNote = baseMidiNote ?? this.rootNote;
    const effectiveCoarse = coarseTune ?? this.coarseTune;
    const effectiveFine = fineTune ?? this.fineTune;

    targetMidiNote = applyMicrotonalTuning(targetMidiNote, tuning);

    const totalSemitoneOffset = effectiveCoarse + effectiveFine / 100;

    const adjustedTargetMidi = targetMidiNote + totalSemitoneOffset;

    const targetFreq = midiToFreq(adjustedTargetMidi);
    const baseFreq = midiToFreq(effectiveBaseNote);

    let pitchRatio = targetFreq / baseFreq;
    pitchRatio = Math.max(
      PITCH_RATIO_LIMITS.MIN,
      Math.min(PITCH_RATIO_LIMITS.MAX, pitchRatio),
    );

    this.linearRampToPitch(pitchRatio, time || this.audioContext.currentTime);
  },

  /**
   * Exponentially ramp the pitch from current value to the target MIDI note.
   */
  exponentialRampPitchFromMidi(
    this: SingingVoiceHost,
    targetMidiNote: number,
    baseMidiNote?: number,
    time?: number,
    coarseTune?: number,
    fineTune?: number,
    tuning?: ScaleDefinition | null,
  ): void {
    const effectiveBaseNote = baseMidiNote ?? this.rootNote;
    const effectiveCoarse = coarseTune ?? this.coarseTune;
    const effectiveFine = fineTune ?? this.fineTune;

    targetMidiNote = applyMicrotonalTuning(targetMidiNote, tuning);

    const totalSemitoneOffset = effectiveCoarse + effectiveFine / 100;

    const adjustedTargetMidi = targetMidiNote + totalSemitoneOffset;

    const targetFreq = midiToFreq(adjustedTargetMidi);
    const baseFreq = midiToFreq(effectiveBaseNote);

    let pitchRatio = targetFreq / baseFreq;
    pitchRatio = Math.max(
      PITCH_RATIO_LIMITS.MIN,
      Math.min(PITCH_RATIO_LIMITS.MAX, pitchRatio),
    );

    this.exponentialRampToPitch(
      pitchRatio,
      time || this.audioContext.currentTime,
    );
  },

  /**
   * Set pitch from MIDI note number relative to base note.
   * Uses stored rootNote, coarseTune, and fineTune values.
   *
   * @param targetMidiNote Target MIDI note for pitch shifting (can include fractional cents)
   * @param baseMidiNote Base MIDI note (default: uses stored rootNote) - the root note of the sample
   * @param time Optional time to apply the change (default: now)
   * @param coarseTune Optional coarse tuning override (-24 to +24), uses stored if not provided
   * @param fineTune Optional fine tuning override (-50 to +50), uses stored if not provided
   */
  setPitchFromMidi(
    this: SingingVoiceHost,
    targetMidiNote: number,
    baseMidiNote?: number,
    time?: number,
    coarseTune?: number,
    fineTune?: number,
    tuning?: ScaleDefinition | null,
  ): void {
    // Use stored values as defaults
    const effectiveBaseNote = baseMidiNote ?? this.rootNote;
    const effectiveCoarse = coarseTune ?? this.coarseTune;
    const effectiveFine = fineTune ?? this.fineTune;

    targetMidiNote = applyMicrotonalTuning(targetMidiNote, tuning);

    // Apply coarse and fine tuning offsets
    const totalSemitoneOffset = effectiveCoarse + effectiveFine / 100;
    const adjustedTargetMidi = targetMidiNote + totalSemitoneOffset;

    const targetFreq = midiToFreq(adjustedTargetMidi);
    const baseFreq = midiToFreq(effectiveBaseNote);

    // Calculate pitch ratio, clamped to optimal range for best quality
    let pitchRatio = targetFreq / baseFreq;
    pitchRatio = Math.max(
      PITCH_RATIO_LIMITS.MIN,
      Math.min(PITCH_RATIO_LIMITS.MAX, pitchRatio),
    );

    this.setPitch(pitchRatio, time);
  },

  /**
   * Get the nearest base pitch level for a target frequency.
   * Used for multi-resolution pitch caching (Section 2).
   * * @param targetMidiNote Target MIDI note number
   * @returns The cache key ('low', 'mid', or 'high') for the nearest base pitch
   */
  getNearestBasePitch(
    this: SingingVoiceHost,
    targetMidiNote: number,
    tuning?: ScaleDefinition | null,
  ): keyof PitchCache {
    targetMidiNote = applyMicrotonalTuning(targetMidiNote, tuning);
    const freq = midiToFreq(targetMidiNote);
    if (freq < 200) return "low";
    if (freq < 400) return "mid";
    return "high";
  },

  /**
   * Get the reference frequency for a cache level.
   * @param level The pitch cache level
   * @returns Frequency in Hz
   */
  getReferenceFrequency(
    this: SingingVoiceHost,
    level: keyof PitchCache,
  ): number {
    return REFERENCE_FREQUENCIES[level];
  },

  /**
   * Set cached audio for a specific pitch level.
   * Call this with pre-rendered TTS audio at different reference pitches.
   * * @param level The pitch cache level ('low', 'mid', 'high')
   * @param audio Float32Array of audio samples rendered at the reference pitch
   */
  setCachedAudio(
    this: SingingVoiceHost,
    level: keyof PitchCache,
    audio: Float32Array,
  ): void {
    this.pitchCache[level] = audio;
  },

  /**
   * Get cached audio for a specific pitch level.
   * @param level The pitch cache level
   * @returns Cached audio or null if not available
   */
  getCachedAudio(
    this: SingingVoiceHost,
    level: keyof PitchCache,
  ): Float32Array | null {
    return this.pitchCache[level];
  },

  /**
   * Process audio with optimal pitch shifting using cached base pitches.
   * Automatically selects the nearest cached base pitch to minimize artifacts.
   * * @param targetMidiNote Target MIDI note for pitch shifting
   * @returns true if processing succeeded, false if no cached audio available
   */
  processWithOptimalPitch(
    this: SingingVoiceHost,
    targetMidiNote: number,
    tuning?: ScaleDefinition | null,
  ): boolean {
    targetMidiNote = applyMicrotonalTuning(targetMidiNote, tuning);
    const cacheLevel = this.getNearestBasePitch(targetMidiNote);
    const cachedAudio = this.pitchCache[cacheLevel];

    if (!cachedAudio) {
      console.warn(
        `No cached audio for level '${cacheLevel}'. Please render TTS first.`,
      );
      return false;
    }

    // Calculate pitch shift from the cached base to the target
    const baseFreq = REFERENCE_FREQUENCIES[cacheLevel];
    const targetFreq = midiToFreq(targetMidiNote);
    const pitchRatio = Math.max(
      PITCH_RATIO_LIMITS.MIN,
      Math.min(PITCH_RATIO_LIMITS.MAX, targetFreq / baseFreq),
    );

    this.setPitch(pitchRatio);
    this.process(cachedAudio);

    return true;
  },

  /**
   * Set the time stretch ratio.
   * @param timeRatio Time multiplier (e.g., 2.0 = twice as long, 0.5 = half as long)
   * @param time Optional time to apply the change (default: now)
   */
  setTimeRatio(
    this: SingingVoiceHost,
    timeRatio: number,
    time?: number,
  ): void {
    if (this.workletNode) {
      this.workletNode.parameters
        .get("timeRatio")!
        .setValueAtTime(timeRatio, time || this.audioContext.currentTime);
    }
  },

  /**
   * Set the root note for sample playback.
   * This is the base MIDI note where the sample plays at its original pitch.
   * @param midiNote Root MIDI note (24-108)
   */
  setRootNote(this: SingingVoiceHost, midiNote: number): void {
    this.rootNote = Math.max(24, Math.min(108, midiNote));
  },

  /**
   * Get the current root note.
   * @returns Current root MIDI note
   */
  getRootNote(this: SingingVoiceHost): number {
    return this.rootNote;
  },

  /**
   * Set coarse tuning in semitones.
   * @param semitones Coarse tuning (-24 to +24 semitones)
   */
  setCoarseTune(this: SingingVoiceHost, semitones: number): void {
    this.coarseTune = Math.max(-24, Math.min(24, semitones));
  },

  /**
   * Get the current coarse tuning.
   * @returns Coarse tuning in semitones
   */
  getCoarseTune(this: SingingVoiceHost): number {
    return this.coarseTune;
  },

  /**
   * Set fine tuning in cents.
   * @param cents Fine tuning (-50 to +50 cents)
   */
  setFineTune(this: SingingVoiceHost, cents: number): void {
    this.fineTune = Math.max(-50, Math.min(50, cents));
  },

  /**
   * Get the current fine tuning.
   * @returns Fine tuning in cents
   */
  getFineTune(this: SingingVoiceHost): number {
    return this.fineTune;
  },

  /**
   * Set pitch envelope attack time.
   * @param attack Attack time (0-1, mapped to 0-2 seconds)
   * @param time Optional time to apply the change (default: now)
   */
  setPitchAttack(
    this: SingingVoiceHost,
    attack: number,
    time?: number,
  ): void {
    this.pitchAttack = Math.max(0, Math.min(1, attack));
    // Map 0-1 to 0-2 seconds for the worklet
    const attackSeconds = this.pitchAttack * 2;
    if (this.workletNode) {
      this.workletNode.parameters
        .get("pitchAttack")
        ?.setValueAtTime(attackSeconds, time || this.audioContext.currentTime);
    }
  },

  /**
   * Get the current pitch envelope attack time.
   * @returns Attack time (0-1)
   */
  getPitchAttack(this: SingingVoiceHost): number {
    return this.pitchAttack;
  },

  /**
   * Set pitch envelope decay time.
   * @param decay Decay time (0-1, mapped to 0-2 seconds)
   * @param time Optional time to apply the change (default: now)
   */
  setPitchDecay(this: SingingVoiceHost, decay: number, time?: number): void {
    this.pitchDecay = Math.max(0, Math.min(1, decay));
    // Map 0-1 to 0-2 seconds for the worklet
    const decaySeconds = this.pitchDecay * 2;
    if (this.workletNode) {
      this.workletNode.parameters
        .get("pitchDecay")
        ?.setValueAtTime(decaySeconds, time || this.audioContext.currentTime);
    }
  },

  /**
   * Get the current pitch envelope decay time.
   * @returns Decay time (0-1)
   */
  getPitchDecay(this: SingingVoiceHost): number {
    return this.pitchDecay;
  },

  /**
   * Calculate total pitch offset including root note, coarse and fine tuning.
   * This combines all pitch parameters into a single semitone offset.
   * @param targetMidiNote The target MIDI note being played
   * @returns Total semitone offset from the base pitch
   */
  calculatePitchOffset(
    this: SingingVoiceHost,
    targetMidiNote: number,
    tuning?: ScaleDefinition | null,
  ): number {
    targetMidiNote = applyMicrotonalTuning(targetMidiNote, tuning);
    // Calculate: (target - root) + coarse + fine/100
    const baseOffset = targetMidiNote - this.rootNote;
    const tuningOffset = this.coarseTune + this.fineTune / 100;
    return baseOffset + tuningOffset;
  },
};
