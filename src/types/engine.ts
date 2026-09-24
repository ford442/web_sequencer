import type { AlignmentResult } from '../engines/rubberband/PhonemeAligner';
import type { SingingVoice } from '../engines/SingingVoice';
import type { WebGpuOscillator } from '../engines/WebGpuOscillator';
import type { WasmOscillator } from '../engines/WasmOscillator';
import type { Open303Manager } from '../engines/Open303Manager';
import type { Open303Oscillator } from '../engines/Open303Oscillator';
import type { ScaleDefinition } from '../utils/musicTheory';
import type { MultisampleBank } from '../engines/MultisampleGenerator';
export type { MultisampleBank } from '../engines/MultisampleGenerator';
import type { SynthParams } from './synth';
import type { DrumSound, KickParams, SnareParams, HatParams } from './drums';
import type { SamplerBankParams } from './sampler';
import type { PartSequence, ReverbType } from './pattern';
export type { ReverbType } from './pattern';

/** Instruments that expose a color-coded expression LED in the rack UI. */
export type ExpressionLedTarget =
  | 'synthA' | 'synthB' | 'bass2'
  | 'kick' | 'snare' | 'closedHat' | 'openHat'
  | 'sampler';

export type TrackAnalysers = Partial<Record<ExpressionLedTarget, AnalyserNode>>;

/** An ambiance/background audio track selectable from the ambiance player. */
export interface AmbianceTrack {
  id: string;
  name: string;
  url: string;
}

export interface AudioEngine {
  context: AudioContext;
  /** Passive monitor tap on the master output — use for level meters and visualisers. */
  analyserNode?: AnalyserNode | null;
  /** Per-instrument monitor taps for expression LEDs (when routed through a track bus). */
  trackAnalysers?: TrackAnalysers;
  webGpuEngine?: WebGpuOscillator | null;
  wasmEngine?: WasmOscillator | null;
  open303Engine?: Open303Oscillator | Open303Manager | null;
  /** Prophecy formant engine manager; set after init. */
  prophecyManager?: import('../engines/ProphecyManager').ProphecyManager | null;
  /** PcfEffect instance for PCF automation wiring; set after init. */
  pcfEffect?: import('../engines/PcfEffect').PcfEffect | null;
  singingVoice?: SingingVoice;

  // === Playback Methods (with microtonal support) ===
  playSynth: (
    params: SynthParams,
    note: string | string[],
    time: number,
    durationSteps?: number,
    stepTime?: number,
    slideFromFreq?: number,
    track?: 'partA' | 'partB' | 'bass2',
    tuning?: ScaleDefinition | null,
    noteParams?: any
  ) => void;

  playDrum: (
    sound: DrumSound,
    params: KickParams | SnareParams | HatParams,
    time: number,
    tuning?: ScaleDefinition | null,
    stepTime?: number,
    note?: string | { note: string, pan?: number }
  ) => void;

  playSampler: (
    params: SamplerBankParams,
    note: string | string[],
    time: number,
    durationSteps?: number,
    stepTime?: number,
    noteParams?: any,
    tuning?: ScaleDefinition | null
  ) => void;

  noteOnSampler?: (
    params: SamplerBankParams,
    note: string,
    time?: number,
    tuning?: ScaleDefinition | null
  ) => number | null;

  noteOffSampler?: (id: number) => void;

  noteOnSynth?: (
    params: SynthParams,
    note: string,
    time?: number,
    track?: 'partA' | 'partB' | 'bass2',
    tuning?: ScaleDefinition | null
  ) => Promise<number | null> | number | null;

  noteOffSynth?: (id: number) => void;

  stopAllNotes?: () => void;
  /** Flush hanging voices on one track at a clip transition. */
  stopTrackNotes?: (track: 'partA' | 'partB' | 'bass2' | 'kick' | 'snare' | 'closedHat' | 'openHat' | 'sampler') => void;

  // Other existing methods
  loadSampleToEngine: (name: string, buffer: AudioBuffer, onProgress?: (progress: number) => void) => Promise<void> | void;
  renderSynthPartToBuffer: (params: SynthParams, sequence: PartSequence, tempo: number) => Promise<AudioBuffer>;
  playBufferedPart: (buffer: AudioBuffer, time: number) => void;
  playAmbiance: (url: string) => Promise<void>;
  stopAmbiance: () => void;
  setAmbianceVolume: (volume: number) => void;
  setMasterVolume: (volume: number) => void;
  setMasterSaturation: (amount: number) => void;
  setGlobalPan: (pan: number) => void;
  setReverbType: (type: ReverbType) => void;
  detectSamplePitch?: (buffer: AudioBuffer) => Promise<unknown>;
  processSinging?: (sampleName: string, note: string, steps: number, tempo: number) => Promise<AudioBuffer | null>;
  prepareVocal?: (bankIndex: number, text: string, durationPriors?: number[]) => Promise<void>;
  getAlignment?: (bankIndex: number) => AlignmentResult | null;
  setAlignment?: (bankIndex: number, alignment: AlignmentResult | null) => void;
  setSustainMode?: (mode: 'loop' | 'stretch' | 'wavetable') => void;
  setSustainGrainSize?: (size: number) => void;
  playSinging?: (buffer: AudioBuffer, targetNote: string, duration: number, sourceNote?: string) => void;

  // Multisample support
  getMultisampleBank?: (bankIndex: number) => MultisampleBank | null;
  isMultisampleReady?: (bankIndex: number) => boolean;

  // Real-time voice parameter updates
  updateSamplerVoiceParams?: (bankIndex: number, param: string, value: number | string | boolean) => void;

  processSpoon?: (sampleName: string, note: string) => Promise<AudioBuffer | null>;

  // Harmonizer & effects
  setHarmonizerConfig?: (config: any, isActive: boolean) => void;
  triggerTapeStop?: (duration?: number) => void;
  resetTapeStop?: () => void;
  getFrequencyForNote?: (note: string, tuning?: ScaleDefinition | null) => number;
}
