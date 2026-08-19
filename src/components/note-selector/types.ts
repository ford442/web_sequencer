import type { ScaleDefinition } from "../../utils/musicTheory";
import type { ReverbType } from "../../types";

export type PropertyChangeKey =
  | "timbre"
  | "velocity"
  | "probability"
  | "microtiming"
  | "reverse"
  | "retrigger"
  | "freeze"
  | "freezeEnvDepth"
  | "grainEnvDepth"
  | "grainPitchEnvDepth"
  | "grainLfoRate"
  | "grainLfoDepth"
  | "grainJitter"
  | "grainPitchQuantize"
  | "windowShape"
  | "customGrainEnvelope"
  | "timeStretchEnvDepth"
  | "spectralPanRate"
  | "spectralPanDepth"
  | "granularPitchShift"
  | "bitcrush"
  | "downsample"
  | "spectralCompression"
  | "tranceGate"
  | "formantShift"
  | "formantPitchLink"
  | "filterCutoff"
  | "filterResonance"
  | "envMod"
  | "slideFormant"
  | "formantLfoSync"
  | "formantLfoRate"
  | "formantLfoDepth"
  | "freezeLfoSync"
  | "freezeLfoRate"
  | "freezeLfoDepth"
  | "formantEnvAttack"
  | "formantEnvDecay"
  | "formantEnvAmount"
  | "formantEnvFollower"
  | "formantSidechainDepth"
  | "formantEnvSync"
  | "vibratoDepth"
  | "tremoloDepth"
  | "customWindowShape"
  | "tremoloRate"
  | "gateDepth"
  | "gateRate"
  | "pan"
  | "drive"
  | "characterMorph"
  | "reverbSend"
  | "reverbType"
  | "reverbLfoRate"
  | "reverbLfoDepth"
  | "delayLfoRate"
  | "delayLfoDepth"
  | "delaySend"
  | "choir"
  | "vocoderMix"
  | "vocoderFormantShift"
  | "vocoderPreservation"
  | "vocoderAttack"
  | "vocoderRelease"
  | "vowel"
  | "portamento"
  | "pitchAttack"
  | "pitchDecay"
  | "pitchAmount"
  | "glitchChance";

export interface NoteSelectorProps {
  x: number;
  y: number;
  trackType: "synth" | "drum" | "voice";
  currentNote: string;
  currentLength: number;
  currentPan?: number;
  currentPitchAmount?: number;
  currentPitchAttack?: number;
  currentPitchDecay?: number;
  onSelect: (note: string) => void;
  onLengthChange: (length: number) => void;
  onClose: () => void;
  getNoteColor: (note: string) => string;
  currentScale?: ScaleDefinition | null;

  currentTimbre?: number;
  currentVelocity?: number;
  currentProbability?: number;
  currentMicrotiming?: number;
  currentReverse?: boolean;
  currentRetrigger?: number;
  currentFreeze?: number;
  currentBitcrush?: number;
  currentDownsample?: number;
  currentSpectralCompression?: number;
  currentFormantShift?: number;
  currentFormantPitchLink?: number;
  currentSlideFormant?: boolean;
  currentFilterCutoff?: number;
  currentFilterResonance?: number;
  currentEnvMod?: number;
  currentFormantLfoSync?: boolean;
  currentFormantLfoRate?: number;
  currentFormantLfoDepth?: number;
  currentFormantEnvSync?: boolean;
  currentFormantEnvAttack?: number;
  currentFormantEnvDecay?: number;
  currentFormantEnvAmount?: number;
  currentFormantEnvFollower?: number;
  currentFormantSidechainDepth?: number;
  currentFreezeLfoSync?: boolean;
  currentFreezeLfoRate?: number;
  currentFreezeLfoDepth?: number;
  currentVibratoDepth?: number;
  currentTremoloDepth?: number;
  currentTremoloRate?: number;
  currentDrive?: number;
  currentCharacterMorph?: number;
  currentReverbSend?: number;
  currentReverbType?: ReverbType;
  currentReverbLfoRate?: number;
  currentReverbLfoDepth?: number;
  currentDelayLfoRate?: number;
  currentDelayLfoDepth?: number;
  currentFreezeEnvDepth?: number;
  currentGrainEnvDepth?: number;
  currentGrainPitchEnvDepth?: number;
  currentGrainLfoRate?: number;
  currentGrainLfoDepth?: number;
  currentGrainJitter?: number;
  currentGrainPitchQuantize?: number;
  currentGranularPitchShift?: number;
  currentTimeStretchEnvDepth?: number;
  currentSpectralPanRate?: number;
  currentSpectralPanDepth?: number;
  currentTranceGate?: number;
  currentDelaySend?: number;
  currentChoir?: number;
  currentVocoderMix?: number;
  currentVocoderFormantShift?: number;
  currentVocoderPreservation?: number;
  currentVocoderAttack?: number;
  currentVocoderRelease?: number;
  currentGateDepth?: number;
  currentGateRate?: number;
  isProphecy?: boolean;
  currentVowel?: number;
  currentPortamento?: number;
  currentCustomWindowShape?: number[];
  onPropertyChange?: (key: PropertyChangeKey, value: number | boolean | string | number[]) => void;
}
