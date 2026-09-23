import type { PhonemeData } from './sampler';

export type ReverbType = 'room' | 'plate' | 'hall';

export interface Note {
  note: string;
  pan?: number;
  velocity: number;
  length?: number;
  slide?: boolean;
  slideFormant?: boolean;
  slideFromMidi?: number;
  slideFromFormant?: number;
  slideType?: 'linear' | 'exponential';
  chord?: string[];
  characterMorph?: number;
  isHarmonyVoice?: boolean;
  timbre?: number;
  probability?: number;
  microtiming?: number;
  retrigger?: number;
  glitchChance?: number;
  reverse?: boolean;
  sliceIndex?: number;
  freeze?: number;
  formantShift?: number;
  formantPitchLink?: number;
  coarseTune?: number;
  fineTune?: number;
  formantLfoRate?: number;
  formantLfoDepth?: number;
  formantLfoSync?: boolean;
  customLfoShape?: number[];
  freezeLfoRate?: number;
  freezeLfoDepth?: number;
  freezeLfoSync?: boolean;
  freezeEnvDepth?: number;
  timeStretchEnvDepth?: number;
  grainPitchEnvDepth?: number;
  grainJitter?: number;
  grainPitchQuantize?: number;
  grainEnvDepth?: number;
  grainLfoRate?: number;
  grainLfoDepth?: number;
  grainPosLfoDepth?: number;
  grainPanSpread?: number;
  volumeFilterMod?: number;
  vibratoDepth?: number;
  customWindowShape?: number[];
  reverbSend?: number;
  reverbType?: ReverbType;
  reverbLfoRate?: number;
  reverbLfoDepth?: number;
  bitcrush?: number;
  spectralComp?: number;
  downsample?: number;
  spectralCompression?: number;
  phonemeFilterMod?: number;
  delayLfoRate?: number;
  delayLfoDepth?: number;
  delaySend?: number;
  granularPitchShift?: number;
  windowShape?: number;
  customGrainEnvelope?: number[];
  choir?: number;
  drive?: number;
  tranceGate?: number;
  subHarmonics?: number;
  vocalChorus?: number;
  autoTune?: number;
  microtonalVariance?: number;
  drumDuckDepth?: number;
  formantEnvSync?: boolean;
  formantEnvAttack?: number;
  formantEnvDecay?: number;
  formantEnvAmount?: number;
  formantEnvFollower?: number;
  formantSidechainDepth?: number;
  envMod?: number;
  filterCutoff?: number;
  filterResonance?: number;
  gateRate?: number;
  gateDepth?: number;
  spectralPanRate?: number;
  spectralPanDepth?: number;
  vocoderMix?: number;
  vocoderFormantShift?: number;
  vocoderPreservation?: number;
  vocoderAttack?: number;
  vocoderRelease?: number;
  tremoloDepth?: number;
  tremoloRate?: number;
  breathIntensity?: number;
  phonemes?: PhonemeData[];
  /** Prophecy: Vowel formant preset 0–4 (A=0, E=1, I=2, O=3, U=4) */
  pitchAttack?: number;
  pitchDecay?: number;
  pitchAmount?: number;
  vowel?: number;
  /** Prophecy: Portamento rate 0–1 */
  portamento?: number;
  // ... other fields as needed
}

export interface PartSequence {
  steps: (Note | null)[];
  automation?: { [param: string]: (number | null)[] };
}

export interface Pattern {
  partA: PartSequence;
  partB: PartSequence;
  bass2: PartSequence;
  kick: PartSequence;
  snare: PartSequence;
  closedHat: PartSequence;
  openHat: PartSequence;
  sampler: PartSequence[]; // Array of banks
}

export type TrackKey = 'partA' | 'partB' | 'bass2' | 'kick' | 'snare' | 'closedHat' | 'openHat' | 'sampler';
