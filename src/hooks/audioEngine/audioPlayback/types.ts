import type { MutableRefObject } from "react";
import type {
  AudioEngine,
  DrumSound,
  ExpressionLedTarget,
  SynthParams,
} from "../../../types";
import type { ScaleDefinition } from "../../../utils/musicTheory";
import { Harmonizer } from "../../../engines/Harmonizer";
import { Open303Manager } from "../../../engines/Open303Manager";
import { ProphecyManager } from "../../../engines/ProphecyManager";
import type { VoiceManager } from "../../../engines/VoiceManager";
import { SingingVoiceManager } from "../../../engines/SingingVoiceManager";
import { DrumKitEngine } from "../../../engines/DrumKitEngine";

export type SynthTrack = "partA" | "partB" | "bass2";

export const SYNTH_TRACK_TO_LED: Record<SynthTrack, ExpressionLedTarget> = {
  partA: "synthA",
  partB: "synthB",
  bass2: "bass2",
};

export const DRUM_SOUND_TO_LED: Record<DrumSound, ExpressionLedTarget> = {
  kick: "kick",
  snare: "snare",
  closedHat: "closedHat",
  openHat: "openHat",
};

export interface SynthNoteParams {
  vocoderFormantShift?: number;
  vocoderPreservation?: number;
  vocoderAttack?: number;
  vocoderRelease?: number;
  pan?: number;
  timbre?: number;
  microtiming?: number;
  retrigger?: number;
  filterCutoff?: number;
  filterResonance?: number;
  reverbSend?: number;
  reverbType?: "room" | "plate" | "hall";
  envMod?: number;
  drive?: number;
  delaySend?: number;
  /** Prophecy: Vowel formant preset override 0–4 */
  vowel?: number;
  /** Prophecy: Portamento rate override 0–1 */
  portamento?: number;
  /** Prophecy: Formant shift override 0–1 */
  formantShift?: number;
  /** Note velocity 0–1 (mapped to MIDI 0–127 for Open303 noteOn) */
  velocity?: number;
}

export interface DrumNoteParams {
  retrigger?: number;
  reverbSend?: number;
  reverbType?: "room" | "plate" | "hall";
}

export type PlaySynthFn = (
  params: SynthParams,
  note: string | string[],
  time: number,
  durationSteps?: number,
  stepTime?: number,
  slideFromFreq?: number,
  track?: SynthTrack,
  noteParams?: SynthNoteParams,
  tuning?: ScaleDefinition | null,
) => void;

export type NoteOnSynthFn = (
  params: SynthParams,
  note: string,
  time?: number,
  track?: SynthTrack,
) => number | null;

export interface ActiveSynthNote {
  stop: () => void;
}

export interface ActiveSamplerNote {
  source: AudioBufferSourceNode;
  envGain: GainNode;
  expressiveNode?: AudioWorkletNode | null;
  releaseTime?: number;
}

export interface PlaybackRefs {
  masterGainRef: MutableRefObject<GainNode | null>;
  masterSaturationRef: MutableRefObject<WaveShaperNode | null>;
  masterCompressorRef: MutableRefObject<DynamicsCompressorNode | null>;
  sidechainGainRef: MutableRefObject<BiquadFilterNode | null>;
  reverbNodesRef: MutableRefObject<Record<string, ConvolverNode>>;
  reverbTypeRef: MutableRefObject<"room" | "plate" | "hall">;
  delayNodeRef: MutableRefObject<DelayNode | null>;
  delayFeedbackRef: MutableRefObject<GainNode | null>;
  masterPannerRef: MutableRefObject<StereoPannerNode | null>;
  noiseBufferRef: MutableRefObject<AudioBuffer | null>;
  open303ManagerRef: MutableRefObject<Open303Manager | null>;
  prophecyManagerRef: MutableRefObject<ProphecyManager | null>;
  voiceManagerARef: MutableRefObject<VoiceManager | null>;
  voiceManagerBRef: MutableRefObject<VoiceManager | null>;
  nextSynthNoteId: MutableRefObject<number>;
  activeSynthNotes: MutableRefObject<Map<number, ActiveSynthNote>>;
  activeSamplerNotes: MutableRefObject<Map<number, ActiveSamplerNote>>;
  ambianceSourceNodeRef: MutableRefObject<AudioBufferSourceNode | null>;
  ambianceGainNodeRef: MutableRefObject<GainNode | null>;
  loadedAmbianceBuffersRef: MutableRefObject<Map<string, AudioBuffer>>;
  singingVoiceManagerRef: MutableRefObject<SingingVoiceManager | null>;
  harmonizerRef: MutableRefObject<Harmonizer | null>;
  bassSidechainEQBusRef: MutableRefObject<BiquadFilterNode | null>;
  sidechainBusRef: MutableRefObject<GainNode | null>;
  drumKitEngineRef: MutableRefObject<DrumKitEngine | null>;
  synthABusRef: MutableRefObject<GainNode | null>;
}
