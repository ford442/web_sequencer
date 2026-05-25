import type { AlignmentResult } from './engines/rubberband/PhonemeAligner';
import type { SingingVoice } from './engines/SingingVoice';
import type { WebGpuOscillator } from './engines/WebGpuOscillator';
import type { WasmOscillator } from './engines/WasmOscillator';
import type { Open303Manager } from './engines/Open303Manager';
import type { Open303Oscillator } from './engines/Open303Oscillator';
import type { ScaleDefinition } from './utils/musicTheory';
import type { MultisampleBank } from './engines/MultisampleGenerator';
export type { MultisampleBank } from './engines/MultisampleGenerator';

export type Waveform =
  | 'sawtooth' | 'square' | 'triangle' | 'sine'
  | 'pyodide-saw' | 'pyodide-square' | 'pyodide-sine'
  | 'wgsl-saw' | 'wgsl-sqr' | 'wgsl-tri' | 'wgsl-sin'
  | 'wam-saw' | 'wam-sqr' | 'wam-tri' | 'wam-sin'
  | 'wav-saw' | 'wav-sqr'
  | 'rust-saw' | 'rust-sqr'
  | '303-saw' | '303-sqr';

export interface SynthParams {
  waveform: Waveform;
  pitch: number; // Semitones adjustment
  filterCutoff: number; // Hz
  filterResonance: number; // Q factor
  filterMode?: number; // 0-1 (filter mode toggle)
  attack: number;
  decay: number;
  sustain: number; // 0-1 (level)
  release: number; // seconds
  length: number; // seconds (gate time)
  volume: number; // 0-1
  pan?: number; // Stereo pan (-1 to 1)
  delayTime: number; // seconds
  delayFeedback: number; // 0-1
  delayMix: number; // 0-1 (wet/dry)
}

export type DrumSound = 'kick' | 'snare' | 'closedHat' | 'openHat';

export interface KickParams {
  pitch: number;
  decay: number;
  tone: number;
  volume: number;
  pan?: number;
}

export interface SnareParams {
  decay: number;
  tone: number;
  noise: number;
  volume: number;
  pan?: number;
}

export interface HatParams {
  pitch: number;
  decay: number;
  volume: number;
  pan?: number;
}

export interface SamplerBankParams {
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
  grainEnvDepth?: number;
  grainPitchQuantize?: number;
  formantLfoSync?: boolean;
  formantLfoRate?: number;
  formantLfoDepth?: number;
  reverbLfoRate?: number;
  reverbLfoDepth?: number;
  formantLfoShape?: number[];
  formantEnvAttack?: number;
  formantEnvDecay?: number;
  formantEnvAmount?: number;
  customLfoShape?: number[];
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
  coarseTune?: number;
  fineTune?: number;
  quality?: 'preview' | 'good' | 'better' | 'best';
  stretchMode?: 'Time' | 'Pitch' | 'Formant';
  lockToSequencer?: boolean;
  pitchAttack?: number;
  gateRate?: number;
  gateDepth?: number;
  spectralPanRate?: number;
  spectralPanDepth?: number;
  pitchDecay?: number;
  expressiveness?: {
    vibratoRate: number;
    vibratoDepth: number;
    tremoloDepth: number;
    breathAmount: number;
  };
}

export type SamplerParams = SamplerBankParams[];

export interface Bass2Params {
  waveform: '303-saw' | '303-sqr';
  cutoff: number;
  resonance: number;
  filterMode: number;
  decay: number;
  accent: number;
  envMod: number;
  volume: number;
  pitch: number;
  pan?: number;
}

export interface AllDrumParams {
  kick: KickParams;
  snare: SnareParams;
  closedHat: HatParams;
  openHat: HatParams;
}

export type TrackKey = 'partA' | 'partB' | 'bass2' | 'kick' | 'snare' | 'closedHat' | 'openHat' | 'sampler';

export interface AmbianceTrack {
  name: string;
  url: string;
}

export type ReverbType = 'room' | 'plate' | 'hall';

export interface PhonemeData {
  id: string;
  symbol: string;
  start: number;
  end: number;
  pitchBend: number;
  volume?: number;
}

export interface Note {
  note: string;
  velocity: number;
  length?: number;
  slide?: boolean;
  chord?: string[];
  timbre?: number;
  probability?: number;
  microtiming?: number;
  retrigger?: number;
  reverse?: boolean;
  sliceIndex?: number;
  freeze?: number;
  formantShift?: number;
  vibratoDepth?: number;
  reverbSend?: number;
  reverbType?: ReverbType;
  reverbLfoRate?: number;
  reverbLfoDepth?: number;
  delaySend?: number;
  choir?: number;
  drive?: number;
  tranceGate?: number;
  gateRate?: number;
  gateDepth?: number;
  spectralPanRate?: number;
  spectralPanDepth?: number;
  phonemes?: PhonemeData[];
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

export interface AudioEngine {
  context: AudioContext;
  webGpuEngine?: WebGpuOscillator | null;
  wasmEngine?: WasmOscillator | null;
  open303Engine?: Open303Oscillator | Open303Manager | null;
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
    tuning?: ScaleDefinition | null
  ) => void;

  playDrum: (
    sound: DrumSound,
    params: KickParams | SnareParams | HatParams,
    time: number,
    tuning?: ScaleDefinition | null,
    stepTime?: number,
    note?: string
  ) => void;

  playSampler: (
    params: SamplerBankParams,
    note: string | string[],
    time: number,
    durationSteps?: number,
    stepTime?: number,
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
  prepareVocal?: (bankIndex: number, text: string) => Promise<void>;
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

// ... rest of your types (SongStructure, SavedSongData, etc.)
export interface AutomationPoint {
  step: number;
  value: number;
}

export interface KnobAutomation {
  paramId: string;
  trackKey: string;
  points: AutomationPoint[];
  isRecording: boolean;
}

export interface SongStep {
  patternIndex: number;
}

export interface SongStructure {
  length: number;
  steps: SongStep[];
  currentSongStep: number;
}

export interface SavedSongData {
  version?: number;
  pattern: Pattern;
  params: {
    synthA: SynthParams;
    synthB: SynthParams;
    kick: KickParams;
    snare: SnareParams;
    closedHat: HatParams;
    openHat: HatParams;
    sampler: SamplerParams;
  };
  trackStorage: Record<string, unknown>;
  activeTrackSlots: Record<string, number>;
  songStructure: unknown[];
  tempo: number;
  ambianceUrl?: string;
  backgroundImage?: string;
  embeddedSamples?: { [bankIndex: number]: string };
  ttsPhrases?: string[];
}
export interface AmbianceTrack {
  id: string;
  name: string;
  url: string;
}
