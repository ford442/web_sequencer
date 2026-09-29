import type { MutableRefObject } from "react";
import type { MultisampleBank, SamplerBankParams, SamplerNoteParams } from "../../../types";
import type { AlignmentResult } from "../../../engines/rubberband/PhonemeAligner";
import type { SingingVoiceManager } from "../../../engines/SingingVoiceManager";
import type { Harmonizer } from "../../../engines/Harmonizer";
import type { ScaleDefinition } from "../../../utils/musicTheory";

export interface ActiveSamplerNote {
  source: AudioBufferSourceNode;
  envGain: GainNode;
}

export interface SamplerPlaybackRefs {
  multisampleBanksRef: MutableRefObject<Map<string, MultisampleBank>>;
  loadedSampleBuffersRef: MutableRefObject<Map<string, AudioBuffer>>;
  masterSaturationRef: MutableRefObject<WaveShaperNode | null>;
  singingVoiceManagerRef: MutableRefObject<SingingVoiceManager | null>;
  vocalAlignmentsRef: MutableRefObject<Map<string, AlignmentResult>>;
  choirLeftGainRef: MutableRefObject<GainNode | null>;
  choirRightGainRef: MutableRefObject<GainNode | null>;
  reverbNodesRef: MutableRefObject<Record<string, ConvolverNode>>;
  reverbTypeRef: MutableRefObject<"room" | "plate" | "hall">;
  delayNodeRef: MutableRefObject<DelayNode | null>;
  harmonizerRef: MutableRefObject<Harmonizer | null>;
  nextSamplerNoteId: MutableRefObject<number>;
  activeSamplerNotes: MutableRefObject<Map<number, ActiveSamplerNote>>;
}

export type PlaySamplerVoiceFn = (
  params: SamplerBankParams,
  note: string | string[],
  time: number,
  durationSteps?: number,
  stepTime?: number,
  noteParams?: SamplerNoteParams,
  pitchOffsetSemitones?: number,
  tuning?: ScaleDefinition | null,
) => void;

export type PlaySamplerFn = (
  params: SamplerBankParams,
  note: string | string[],
  time: number,
  durationSteps?: number,
  stepTime?: number,
  noteParams?: SamplerNoteParams,
  tuning?: ScaleDefinition | null,
) => void;
