
export type Waveform =
  | 'sawtooth' | 'square' | 'triangle' | 'sine'
  | 'pyodide-saw' | 'pyodide-square' | 'pyodide-sine'
  | 'wgsl-saw' | 'wgsl-sqr' | 'wgsl-tri' | 'wgsl-sin';

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

export interface SamplerParams {
  sampleName: string; // The key used in Python SAMPLES dict
  playbackSpeed: number; // 1.0 = normal
  volume: number;
}

export interface AllDrumParams {
    kick: KickParams;
    snare: SnareParams;
    closedHat: HatParams;
    openHat: HatParams;
}

export interface Note {
  note: string; // e.g., 'C4' for synths, placeholder for drums
  velocity: number;
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
  sampler: PartSequence;
}

export interface AmbianceTrack {
  name: string;
  url: string;
}

export interface AudioEngine {
  context: AudioContext;
  playSynth: (params: SynthParams, note: string, time: number, destination?: AudioNode) => void;
  playDrum: (sound: DrumSound, params: KickParams | SnareParams | HatParams, time: number) => void;
  playSampler: (params: SamplerParams, note: string, time: number) => void;
  loadSampleToEngine: (name: string, buffer: AudioBuffer) => void;
  renderSynthPartToBuffer: (params: SynthParams, sequence: PartSequence, tempo: number) => Promise<AudioBuffer>;
  playBufferedPart: (buffer: AudioBuffer, time: number) => void;
  playAmbiance: (url: string) => Promise<void>;
  stopAmbiance: () => void;
  setAmbianceVolume: (volume: number) => void;
  setMasterVolume: (volume: number) => void;
  setMasterPan: (pan: number) => void;
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
