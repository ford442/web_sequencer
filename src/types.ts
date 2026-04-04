import type { AlignmentResult } from './engines/rubberband/PhonemeAligner';
import type { SingingVoice } from './engines/SingingVoice';
import type { WebGpuOscillator } from './engines/WebGpuOscillator';
import type { WasmOscillator } from './engines/WasmOscillator';
import type { Open303Manager } from './engines/Open303Manager';
import type { Open303Oscillator } from './engines/Open303Oscillator';
import type { MultisampleBank } from './engines/MultisampleGenerator';

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
  tremoloDepth?: number;   // Tremolo depth amount (0-100%)
  tremoloRate?: number;    // Tremolo rate in Hz
  breathIntensity?: number; // Breath noise (0-1.0)
  sliceMode?: 'off' | 'phoneme'; // Slice triggering mode
  choir?: number;          // Choir effect amount (0-1) - Detuned side voices
  glitchChance?: number;   // Probability of glitch/stutter effect (0-1)
  freeze?: number;         // Freeze/smear amount (0-1)
  freezeLfoRate?: number;  // Freeze LFO rate (Hz)
  freezeLfoDepth?: number; // Freeze LFO depth (0-1)
  formantLfoRate?: number; // Formant LFO rate (Hz)
  formantLfoDepth?: number; // Formant LFO depth (0-1)
  characterMorph?: number; // Morph amount between characters (0-1)
  morphTarget?: 'default' | 'male' | 'female' | 'child' | 'deep' | 'bright'; // Target character for morphing
  attack?: number;         // Amplitude envelope attack time (seconds)
  decay?: number;          // Amplitude envelope decay time (seconds)
  sustain?: number;        // Amplitude envelope sustain level (0-1)
  release?: number;        // Amplitude envelope release time (seconds)
  pan?: number;            // Stereo pan (-1 to 1)
  isHarmonyVoice?: boolean; // True if this is a harmonized voice
  harmonyIndex?: number;   // Index of harmony voice (0 = base)
  
  // Phase 1: Vocal Workstation - Pitch Controls
  rootNote?: number;           // Root MIDI note for pitch tracking (default: 60 = C4)
  coarse?: number;             // Coarse pitch adjustment (-24 to +24 semitones)
  fine?: number;               // Fine pitch adjustment (-50 to +50 cents)
  formant?: number;            // Formant shift (-12 to +12 semitones)
  pitchAttack?: number;        // Pitch envelope attack (0-2000ms)
  pitchDecay?: number;         // Pitch envelope decay (0-2000ms)
  rbQuality?: 'Fast' | 'Standard' | 'Elastic';  // RubberBand quality mode
  stretchMode?: 'Time' | 'Pitch' | 'Formant';   // Stretch processing mode
  autoFollow?: boolean;        // Lock pitch to sequencer notes
  
  // SamplerVoicePanel unified params (mapped from panel controls)
  coarseTune?: number;         // ±24 semitones (alias for coarse)
  fineTune?: number;           // ±50 cents (alias for fine)
  quality?: 'preview' | 'good' | 'better' | 'best';  // RubberBand quality (mapped to rbQuality)
  lockToSequencer?: boolean;   // Quantize to active sequencer steps
}

// SamplerParams is now an array of banks
export type SamplerParams = SamplerBankParams[];

// Re-export MultisampleBank for convenience
export type { MultisampleBank };

// Open303 (TB-303) specific parameters for BASS 2
export interface Bass2Params {
  waveform: '303-saw' | '303-sqr';
  cutoff: number;        // 0-8000 Hz (mapped to 0-1 for engine)
  resonance: number;     // 0-20 (mapped to 0-1 for engine)
  filterMode: number;    // 0-1 (18dB/24dB)
  decay: number;         // 0-2 seconds
  accent: number;        // 0-1
  envMod: number;        // 0-1 (envelope modulation)
  volume: number;        // 0-1
  pitch: number;         // Semitones (-24 to +24)
}

export interface AllDrumParams {
  kick: KickParams;
  snare: SnareParams;
  closedHat: HatParams;
  openHat: HatParams;
}

export type TrackKey = 'partA' | 'partB' | 'bass2' | 'kick' | 'snare' | 'closedHat' | 'openHat' | 'sampler';

export interface PhonemeData {
  id: string;
  symbol: string; // ARPABET symbol like 'HH', 'EH', 'LL', 'OW'
  start: number; // Start time within step (0-1, normalized)
  end: number; // End time within step (0-1, normalized)
  pitchBend: number; // Pitch bend in cents (-100 to +100)
  volume?: number; // Individual phoneme volume (0-1)
}

export interface Note {
  note: string; // e.g., 'C4' for synths, placeholder for drums
  velocity: number;
  length?: number; // Duration in steps (default 1)
  slide?: boolean; // Triggers portamento from previous note
  chord?: string[]; // Additional notes to play simultaneously
  timbre?: number; // 0-1, tonal character (filter/formant)
  probability?: number; // 0-1, chance of triggering
  microtiming?: number; // -0.5 to 0.5 steps, rhythmic offset
  retrigger?: number; // 2=x2, 3=x3, 4=x4 (Ratchet/Roll)
  reverse?: boolean; // Play sample in reverse (Sampler only)
  sliceIndex?: number; // Specific phoneme/slice index to trigger (Sampler only)
  freeze?: number; // Spectral freeze/smear amount (0-1) (Sampler only)
  formantLfoRate?: number; // Formant LFO rate (Hz)
  formantLfoDepth?: number; // Formant LFO depth (0-1)
  characterMorph?: number; // Morph amount between characters (0-1)
  filterCutoff?: number; // 0-1, exponentially mapped to Hz
  filterResonance?: number; // 0-1, linearly mapped to Q factor
  envMod?: number; // 0-1, envelope modulation override for filters
  vibratoDepth?: number; // 0-100%, vibrato depth override (Sampler only)
  drive?: number; // 0-1, distortion/drive amount override (Sampler only)
  
  // Phase 2: Melodic Lyric Mode - Per-step pitch control
  pitch?: number; // MIDI note number for sampler melodic mode (default: 60 = C4)
  pitchOffset?: number; // Fine pitch offset in cents (-100 to +100)
  phonemeIndex?: number; // Which phoneme to trigger (for TTS lyrics)
  
  // Phase 3: Live Phoneme Painter - Per-step phoneme sequence
  phonemes?: PhonemeData[]; // Array of phonemes for this step
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
  sampler: PartSequence[]; // Array of 8 sequences
}

export interface AmbianceTrack {
  name: string;
  url: string;
}

export interface AudioEngine {
    context: AudioContext;
    webGpuEngine?: WebGpuOscillator | null;
    wasmEngine?: WasmOscillator | null;
    open303Engine?: Open303Oscillator | Open303Manager | null;
    playSynth: (params: SynthParams, note: string | string[], time: number, durationSteps?: number, stepTime?: number, slideFromFreq?: number, track?: 'partA' | 'partB', noteParams?: { timbre?: number, microtiming?: number, retrigger?: number, filterCutoff?: number, filterResonance?: number, envMod?: number }) => void;
    playDrum: (sound: DrumSound, params: KickParams | SnareParams | HatParams, time: number, noteParams?: { retrigger?: number }, stepTime?: number) => void;
    playSampler: (params: SamplerBankParams, note: string | string[], time: number, durationSteps?: number, stepTime?: number, noteParams?: { timbre?: number, microtiming?: number, reverse?: boolean, sliceIndex?: number, retrigger?: number, freeze?: number, vibratoDepth?: number, drive?: number }) => void;
    noteOnSampler?: (params: SamplerBankParams, note: string, time?: number) => number | null;
    noteOffSampler?: (id: number) => void;
    noteOnSynth?: (params: SynthParams, note: string, time?: number, track?: 'partA' | 'partB') => Promise<number | null> | number | null;
    noteOffSynth?: (id: number) => void;
    stopAllNotes?: () => void;
    loadSampleToEngine: (name: string, buffer: AudioBuffer, onProgress?: (progress: number) => void) => Promise<void> | void;
    renderSynthPartToBuffer: (params: SynthParams, sequence: PartSequence, tempo: number) => Promise<AudioBuffer>;
    playBufferedPart: (buffer: AudioBuffer, time: number) => void;
    playAmbiance: (url: string) => Promise<void>;
    stopAmbiance: () => void;
    setAmbianceVolume: (volume: number) => void;
    setMasterVolume: (volume: number) => void;
    setGlobalPan: (pan: number) => void;
    detectSamplePitch?: (buffer: AudioBuffer) => Promise<unknown>;
    processSinging?: (sampleName: string, note: string, steps: number, tempo: number) => Promise<AudioBuffer | null>;
    processSpoon?: (sampleName: string, note: string) => Promise<AudioBuffer | null>;
    prepareVocal?: (bankIndex: number, text: string) => Promise<void>;
    getAlignment?: (bankIndex: number) => AlignmentResult | null;
    setSustainMode?: (mode: 'loop' | 'stretch' | 'wavetable') => void;
    setSustainGrainSize?: (size: number) => void;
    playSinging?: (buffer: AudioBuffer, targetNote: string, duration: number, sourceNote?: string) => void;
    singingVoice?: SingingVoice;
    
    // Multisample Generator
    getMultisampleBank?: (bankIndex: number) => MultisampleBank | null;
    isMultisampleReady?: (bankIndex: number) => boolean;
    
    // Sampler Voice Panel controls - real-time parameter updates
    updateSamplerVoiceParams?: (bankIndex: number, param: string, value: number | string | boolean) => void;
    
    // Harmonizer configuration
    setHarmonizerConfig?: (config: import('./engines/Harmonizer').HarmonizerConfig, isActive: boolean) => void;
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
  trackStorage: Record<string, unknown>;
  activeTrackSlots: Record<string, number>;
  songStructure: unknown[];
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
