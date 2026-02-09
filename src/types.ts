import { SingingVoice } from './engines/SingingVoice';

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
  attack: number; // seconds
  decay: number; // seconds
  sustain: number; // 0-1 (level)
  release: number; // seconds
  length: number; // seconds (gate time)
  volume: number; // 0-1
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
}

export interface SnareParams {
  decay: number;
  tone: number;
  noise: number;
  volume: number;
}

export interface HatParams {
  pitch: number;
  decay: number;
  volume: number;
}

export interface SamplerBankParams {
  sampleName: string; // The key used in Python SAMPLES dict
  playbackSpeed: number; // 1.0 = normal
  volume: number;
  filterCutoff: number; // Hz
  filterResonance: number; // Q factor
  drive: number; // 0-1 (Distortion amount)
  delaySend: number; // 0-1 (Amount sent to delay bus)
  mode?: 'loop' | 'stretch' | 'wavetable'; // Sustain processor mode (0=loop, 1=stretch, 2=wavetable)
  grainSize?: number; // Grain size for stretch mode (in samples)
  timeRatio?: number;      // Rubberband time stretch (0.5-2.0)
  pitchScale?: number;     // Rubberband pitch shift (0.5-2.0)
  formantShift?: number;   // Formant adjustment (-12 to +12 semitones)
  vibratoDepth?: number;   // Vibrato amount (0-100%)
  breathIntensity?: number; // Breath noise (0-1.0)
  sliceMode?: 'off' | 'phoneme'; // Slice triggering mode
}

// SamplerParams is now an array of banks
export type SamplerParams = SamplerBankParams[];

export interface AllDrumParams {
  kick: KickParams;
  snare: SnareParams;
  closedHat: HatParams;
  openHat: HatParams;
}

export interface Note {
  note: string; // e.g., 'C4' for synths, placeholder for drums
  velocity: number;
  length?: number; // Duration in steps (default 1)
  slide?: boolean; // Triggers portamento from previous note
  chord?: string[]; // Additional notes to play simultaneously
}

export interface PartSequence {
  steps: (Note | null)[];
}

export interface Pattern {
  partA: PartSequence;
  partB: PartSequence;
  kick: PartSequence;
  snare: PartSequence;
  closedHat: PartSequence;
  openHat: PartSequence;
  sampler: PartSequence[]; // Array of 8 sequences
}

export interface AmbianceTrack {
  name: string;
  url: string;
}

export interface AudioEngine {
    context: AudioContext;
    webGpuEngine?: any; // WebGpuOscillator
    wasmEngine?: any; // WasmOscillator
    open303Engine?: any; // Open303Oscillator
    playSynth: (params: SynthParams, note: string | string[], time: number, durationSteps?: number, stepTime?: number, slideFromFreq?: number, track?: 'partA' | 'partB') => void;
    playDrum: (sound: DrumSound, params: KickParams | SnareParams | HatParams, time: number) => void;
    playSampler: (params: SamplerBankParams, note: string, time: number, durationSteps?: number, stepTime?: number) => void;
    noteOnSampler?: (params: SamplerBankParams, note: string, time?: number) => number | null;
    noteOffSampler?: (id: number) => void;
    noteOnSynth?: (params: SynthParams, note: string, time?: number, track?: 'partA' | 'partB') => Promise<number | null> | number | null;
    noteOffSynth?: (id: number) => void;
    stopAllNotes?: () => void;
    loadSampleToEngine: (name: string, buffer: AudioBuffer) => void;
    renderSynthPartToBuffer: (params: SynthParams, sequence: PartSequence, tempo: number) => Promise<AudioBuffer>;
    playBufferedPart: (buffer: AudioBuffer, time: number) => void;
    playAmbiance: (url: string) => Promise<void>;
    stopAmbiance: () => void;
    setAmbianceVolume: (volume: number) => void;
    setMasterVolume: (volume: number) => void;
    setGlobalPan: (pan: number) => void;
    detectSamplePitch?: (buffer: AudioBuffer) => Promise<any>;
    processSinging?: (sampleName: string, note: string, steps: number, tempo: number) => Promise<AudioBuffer | null>;
    processSpoon?: (sampleName: string, note: string) => Promise<AudioBuffer | null>;
    prepareVocal?: (bankIndex: number, text: string) => Promise<void>;
    setSustainMode?: (mode: 'loop' | 'stretch' | 'wavetable') => void;
    setSustainGrainSize?: (size: number) => void;
    playSinging?: (buffer: AudioBuffer, targetNote: string, duration: number, sourceNote?: string) => void;
    singingVoice?: SingingVoice;
}

// Automation recording types
export interface AutomationPoint {
  step: number; // Song step when this value should be applied
  value: number; // The parameter value (0-1)
}

export interface KnobAutomation {
  paramId: string; // e.g., 'pitch', 'filterCutoff'
  trackKey: string; // e.g., 'partA', 'kick'
  points: AutomationPoint[];
  isRecording: boolean;
}

// Song structure types
export interface SongStep {
  patternIndex: number; // Which pattern slot (0-3) to play at this step
}

export interface SongStructure {
  length: number; // Total number of song steps (1-64)
  steps: SongStep[]; // Array of song steps defining which pattern plays when
  currentSongStep: number; // Current position in the song
}

// Helper type for the saved file format
export interface SavedSongData {
  version?: number;
  pattern: Pattern;
  // Use generic objects for params to allow flexibility
  params: {
    synthA: SynthParams;
    synthB: SynthParams;
    kick: KickParams;
    snare: SnareParams;
    closedHat: HatParams;
    openHat: HatParams;
    sampler: SamplerParams;
  };
  trackStorage: any;
  activeTrackSlots: any;
  songStructure: any;
  tempo: number;
  ambianceUrl?: string;
  backgroundImage?: string;
  // NEW: Embedded samples
  embeddedSamples?: {
    [bankIndex: number]: string; // Base64 encoded WAV
  };
  // TTS text phrases for each bank
  ttsPhrases?: string[]; // Array of 8 TTS text strings, one per bank
}
