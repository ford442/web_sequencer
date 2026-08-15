import type { AlignmentResult } from "../rubberband/PhonemeAligner";
import type { FormantShifter } from "../rubberband/FormantShifter";
import type { PhonemeAligner } from "../rubberband/PhonemeAligner";
import type { PhonemeBufferPool } from "../../services/PhonemeBufferPool";
import type { PitchCache, SingingVoiceConfig } from "./constants";

/** Cross-mixin method signatures used between singing-voice modules. */
export interface SingingVoiceMixinMethods {
  process(
    audio: Float32Array,
    startSample?: number,
    endSample?: number,
    reverse?: boolean,
  ): Promise<void>;
  setPitch(ratio: number, time?: number): void;
  setPitchAtTime(ratio: number, time: number): void;
  glidePitchTo(targetRatio: number, startTime: number, glideTime: number, currentRatio: number, curve?: 'linear' | 'exponential'): void;
  setTimeRatio(timeRatio: number, time?: number): void;
  linearRampToPitch(ratio: number, time: number): void;
  exponentialRampToPitch(ratio: number, time: number): void;
  loadBuffer(audio: Float32Array): void;
  play(
    startSample?: number,
    endSample?: number,
    pitch?: number,
    reverse?: boolean,
  ): void;
  getNearestBasePitch(
    targetMidiNote: number,
    tuning?: import("../../utils/musicTheory").ScaleDefinition | null,
  ): keyof PitchCache;
  trigger(opts: import("./playback").SingingVoiceTriggerOptions): void;
  setFormantGlide(
    startSemitones: number,
    endSemitones: number,
    startTime: number,
    duration: number,
  ): void;
  setFormantShift(
    semitones: number,
    time?: number,
    rampTime?: number,
  ): void;
  setWindowShape(shape: number, time?: number): void;
  setCustomGrainEnvelope(shape: number[] | undefined): void;
}

/**
 * Internal host interface shared by singing-voice mixin modules.
 * SingingVoice implements this with protected fields.
 */
export interface SingingVoiceHost extends SingingVoiceMixinMethods {
  audioContext: AudioContext;
  workletNode: AudioWorkletNode | null;
  config: SingingVoiceConfig;
  processorLatency: number;
  pitchCache: PitchCache;
  rootNote: number;
  coarseTune: number;
  fineTune: number;
  pitchAttack: number;
  pitchDecay: number;
  pitchAmount: number;
  currentAttack: number;
  currentDecay: number;
  phonemeAligner: PhonemeAligner | null;
  formantShifter: FormantShifter | null;
  lastAlignment: AlignmentResult | null;
  bufferPool: PhonemeBufferPool | null;
  outputDestinations: Set<AudioNode>;
  isActive: boolean;
  currentPitch: number | null;
}
