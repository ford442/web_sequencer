/** Live-editable per-note sampler voice params, held in a ref and mirrored to state. */
export interface SamplerVoiceParams {
  drive: number;
  rootNote: number;
  coarseTune: number;
  fineTune: number;
  formantShift: number;
  attack: number;
  decay: number;
  vibratoRate: number;
  vibratoDepth: number;
  tremoloDepth: number;
  breathAmount: number;
  stretchProfile: 'vocal' | 'harmonic' | 'fast';
  stretchMode: 'Time' | 'Pitch' | 'Formant';
  lockToSequencer: boolean;
  pan?: number;
}

export interface SamplerBankParams {
  grainJitter?: number;
  sampleName: string;
  playbackSpeed: number;
  volume: number;
  filterCutoff: number;
  filterResonance: number;
  drive: number;
  delaySend: number;
  mode?: 'loop' | 'stretch' | 'wavetable';
  grainSize?: number;
  timeRatio?: number;
  pitchScale?: number;
  formantShift?: number;
  formantPitchLink?: number;
  coarseTune?: number;
  fineTune?: number;
  vibratoDepth?: number;
  tremoloDepth?: number;
  tremoloRate?: number;
  breathIntensity?: number;
  sliceMode?: 'off' | 'phoneme';
  choir?: number;
  glitchChance?: number;
  freeze?: number;
  portamentoType?: 'linear' | 'exponential';
  freezeLfoRate?: number;
  freezeLfoSync?: boolean;
  freezeLfoDepth?: number;
  freezeEnvDepth?: number;
  timeStretchEnvDepth?: number;
  grainPitchEnvDepth?: number;
  grainEnvDepth?: number;
  grainLfoRate?: number;
  grainLfoDepth?: number;
  grainPosLfoDepth?: number;
  grainPitchQuantize?: number;
  grainPanSpread?: number;
  granularPitchShift?: number;
  windowShape?: number;
  customGrainEnvelope?: number[];
  formantLfoSync?: boolean;
  volumeFilterMod?: number;
  formantLfoRate?: number;
  formantLfoDepth?: number;
  customLfoShape?: number[];
  customWindowShape?: number[];
  reverbLfoRate?: number;
  reverbLfoDepth?: number;
  bitcrush?: number;
  spectralComp?: number;
  subHarmonics?: number;
  vocalChorus?: number;
  autoTune?: number;
  microtonalVariance?: number;
  drumDuckDepth?: number;
  downsample?: number;
  spectralCompression?: number;
  phonemeFilterMod?: number;
  delayLfoRate?: number;
  delayLfoDepth?: number;
  formantEnvAttack?: number;
  formantEnvDecay?: number;
  formantEnvAmount?: number;
  formantEnvFollower?: number;
  formantSidechainDepth?: number;
  formantEnvSync?: boolean;
  characterMorph?: number;
  morphTarget?: 'default' | 'male' | 'female' | 'child' | 'deep' | 'bright';
  attack?: number;
  decay?: number;
  sustain?: number;
  release?: number;
  pan?: number;
  isHarmonyVoice?: boolean;
  harmonyIndex?: number;

  // Pitch / Voice Controls
  rootNote?: number;
  stretchProfile?: 'vocal' | 'harmonic' | 'fast';
  stretchMode?: 'Time' | 'Pitch' | 'Formant';
  lockToSequencer?: boolean;
  pitchAttack?: number;
  pitchDecay?: number;
  pitchAmount?: number;
  gateRate?: number;
  gateDepth?: number;
  spectralPanRate?: number;
  spectralPanDepth?: number;
  vocoderMix?: number;
  vocoderFormantShift?: number;
  vocoderPreservation?: number;
  vocoderAttack?: number;
  vocoderRelease?: number;
  expressiveness?: {
    vibratoRate: number;
    vibratoDepth?: number;
    tremoloDepth: number;
    breathAmount: number;
  };
}

export type SamplerParams = SamplerBankParams[];

export interface PhonemeData {
  id: string;
  symbol: string;
  start: number;
  end: number;
  pitchBend: number;
  vibratoDepth?: number;
  vibratoRate?: number;
  volume?: number;
  grainJitter?: number;
  formantShift?: number;
  grainSize?: number;
  /**
   * Phoneme elasticity 0.5–1.5 (default 1): this phoneme's share of the note
   * relative to the others. The note length does not change — see
   * src/engines/rubberband/phonemeElasticity.ts.
   */
  elasticity?: number;
}
