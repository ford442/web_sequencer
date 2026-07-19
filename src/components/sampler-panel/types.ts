import type { MutableRefObject } from 'react';
import type { SamplerBankParams, SamplerParams, AudioEngine } from '../../types';
import type { AlignmentResult } from '../../engines/rubberband/PhonemeAligner';

export interface SamplerPanelProps {
  params: SamplerParams;
  onChange: (updates: SamplerParams) => void;
  onLoadSample: (name: string, buffer: AudioBuffer, onProgress?: (progress: number) => void) => Promise<void>;
  audioContext: AudioContext;
  audioEngine?: AudioEngine;
  activeBankIdx: number;
  onBankChange: (i: number) => void;
  onOpenEditor?: () => void;
  isVoiceEditorOpen?: boolean;
  ttsPhrases: string[];
  onTtsPhraseChange: (phrases: string[]) => void;
  onGenerateTTS?: (text: string) => Promise<void>;
  onHarmonize?: (bankIndex: number, chordType: string) => Promise<void>;
  onParamChange?: (bankIndex: number, key: string, value: unknown) => void;
  loadedBanks?: boolean[];
  sampleBuffer?: AudioBuffer | null;
  sliceHighlightRef?: MutableRefObject<((slice: number) => void) | null>;
  melodicMode?: boolean;
  onMelodicModeChange?: (enabled: boolean) => void;
  multisampleProgress?: { bankIdx: number; progress: number; isProcessing: boolean } | null;
  multisampleReady?: boolean[];
  multisampleProcessing?: boolean[];
  alignment?: AlignmentResult | null;
  onAlignmentChange?: (alignment: AlignmentResult) => void;
}

export const SAMPLE_BANKS = Array.from({ length: 8 }, (_, i) => `${i + 1}`);

export const DEFAULT_BANK_PARAMS: SamplerBankParams = {
  sampleName: 'bank_0',
  playbackSpeed: 1.0,
  volume: 1.0,
  filterCutoff: 20000,
  filterResonance: 0,
  drive: 0,
  delaySend: 0,
  mode: 'loop',
  grainSize: 4410,
  timeRatio: 1.0,
  pitchScale: 1.0,
  formantShift: 0,
  vibratoDepth: 0,
  tremoloDepth: 0,
  tremoloRate: 0.1,
  breathIntensity: 0,
  expressiveness: {
    vibratoRate: 5.5,
    vibratoDepth: 0,
    tremoloDepth: 0,
    breathAmount: 0,
  },
  freeze: 0,
  grainPitchEnvDepth: 0,
  grainJitter: 0,
  grainPitchQuantize: 0,
  granularPitchShift: 0,
  formantLfoRate: 0,
  formantLfoDepth: 0,
  reverbLfoRate: 0.1,
  reverbLfoDepth: 0,
  formantEnvAttack: 0.1,
  formantEnvDecay: 0.5,
  formantEnvAmount: 0,
  formantEnvFollower: 0,
  characterMorph: 0,
  morphTarget: 'female',
  attack: 0.05,
  decay: 0.1,
  sustain: 1.0,
  release: 0.1,
  choir: 0,
  rootNote: 60,
  coarseTune: 0,
  fineTune: 0,
  stretchProfile: 'vocal',
  stretchMode: 'Pitch',
  lockToSequencer: false,
};

export const grainSizeToMs = (size: number) => Math.round(size / 441 * 10);
export const grainSizeToPercent = (size: number) => ((size - 441) / (22050 - 441) * 100);
