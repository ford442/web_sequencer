import type { AlignmentResult } from './engines/rubberband/PhonemeAligner';
import type { SingingVoice } from './engines/SingingVoice';
import type { WebGpuOscillator } from './engines/WebGpuOscillator';
import type { WasmOscillator } from './engines/WasmOscillator';
import type { Open303Manager } from './engines/Open303Manager';
import type { Open303Oscillator } from './engines/Open303Oscillator';
import type { ScaleDefinition } from './utils/musicTheory';
import type { MultisampleBank } from './engines/MultisampleGenerator';
export type { MultisampleBank } from './engines/MultisampleGenerator';
import type { TB303ModelId } from './engines/TB303Models';
export type { TB303ModelId, TB303Model, TB303ModelInfo, Engine303Family } from './engines/TB303Models';

export type Waveform =
  | 'sawtooth' | 'square' | 'triangle' | 'sine'
  | 'pyodide-saw' | 'pyodide-square' | 'pyodide-sine'
  | 'wgsl-saw' | 'wgsl-sqr' | 'wgsl-tri' | 'wgsl-sin'
  | 'wam-saw' | 'wam-sqr' | 'wam-tri' | 'wam-sin'
  | 'wav-saw' | 'wav-sqr'
  | 'rust-saw' | 'rust-sqr'
  | 'cpp-sin' | 'cpp-saw' | 'cpp-sqr' | 'cpp-rand'
  | '303-saw' | '303-sqr'
  | 'prophecy-saw' | 'prophecy-sqr' | 'prophecy-tri' | 'prophecy-pulse';

export interface SynthParams {
  waveform: Waveform;
  pitch: number; // Semitones adjustment
  filterCutoff: number; // Hz
  filterResonance: number; // Q factor
  filterMode?: number; // 0-1 (filter mode toggle)
  drive?: number;
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
  /** Legacy DSP engine field for '303-saw'/'303-sqr' waveforms. Superseded by
   *  model303 but still written on save so older builds load songs correctly. */
  engine303?: Engine303;
  /** Selected 303 voice/model (see engines/TB303Models.ts). Defaults to 'stock-open303'. */
  model303?: TB303ModelId;
  /** Prophecy: Vowel formant preset 0–4 (A=0, E=1, I=2, O=3, U=4) */
  pitchAttack?: number;
  pitchDecay?: number;
  pitchAmount?: number;
  vowel?: number;
  /** Prophecy: Portamento rate 0–1 (0=instantaneous, 1=max glide) */
  portamento?: number;
  /** Prophecy: Formant frequency shift 0–1 */
  formantShift?: number;
  formantPitchLink?: number;
  coarseTune?: number;
  fineTune?: number;
  /** CPP: fine tune / shape parameter 0–1 */
  cppFine?: number;
}

export type DrumSound = 'kick' | 'snare' | 'closedHat' | 'openHat';

/** Drum kit type selection for authentic 808/909 sound character */
export type DrumKitType = '808' | '909';

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
  consonantClarity?: number;
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
  consonantClarity?: number;
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

/** TB-303 DSP engine selection.
 *  - 'open303': custom synthesizer (open303_wrapper.cpp, open303_* API)
 *  - 'jc303':   authentic rosic::Open303 (jc303_wrapper.cpp, jc303_* API)
 */
export type Engine303 = 'open303' | 'jc303';

/**
 * High-level oscillator family / "engine type" for theming and UI grouping.
 * Replaces/augments the flat waveform buttons with a themed selector.
 * Each type maps to a group of waveforms and carries visual theme data.
 */
export type OscillatorType =
  | 'javascript'   // Native Web Audio OscillatorNode (saw/sqr/tri/sin)
  | 'pcm'          // Pre-rendered WAV samples
  | 'open303'      // Custom Open303 TB-303 engine (WASM)
  | 'jc303'        // Authentic JC303 / rosic::Open303 (per-voice)
  | 'prophecy'     // Korg Prophecy formant engine
  | 'pyodide'      // Python/Pyodide software oscillators
  | 'rust'         // Rust/WASM high-precision synth
  | 'webgpu'       // WGSL/WebGPU GPU oscillators
  | 'wam'          // Web Audio Modules (WAM) plugins
  | 'cpp'          // High-precision C++ math oscillators (sinf / saw / sqr / rand)
;

/** Visual theme applied to the oscillator panel / overlay when this type is active. */
export interface OscillatorTheme {
  /** Human label for the type (shown in selector / badge). */
  label: string;
  /** Tailwind color key used for active accents (e.g. 'emerald', 'violet'). */
  accent: string;
  /** Subtle background treatment for the oscillator control container. */
  panelBg: string;
  /** Border / ring treatment for the panel. */
  panelBorder: string;
  /** Text / icon tint. */
  text: string;
  /** Optional short badge text or emoji hint. */
  badge?: string;
}

/** Static theme map for all oscillator types. Keep colors subtle so they compose with cyan/pink part accents. */
export const OSCILLATOR_THEMES: Record<OscillatorType, OscillatorTheme> = {
  javascript: {
    label: 'JavaScript',
    accent: 'sky',
    panelBg: 'bg-sky-950/30',
    panelBorder: 'border-sky-500/30',
    text: 'text-sky-300',
    badge: 'JS',
  },
  pcm: {
    label: 'PCM / WAV',
    accent: 'stone',
    panelBg: 'bg-stone-950/30',
    panelBorder: 'border-stone-500/30',
    text: 'text-stone-300',
    badge: 'WAV',
  },
  open303: {
    label: 'Open303',
    accent: 'emerald',
    panelBg: 'bg-emerald-950/30',
    panelBorder: 'border-emerald-500/30',
    text: 'text-emerald-300',
    badge: '303',
  },
  jc303: {
    label: 'JC303',
    accent: 'teal',
    panelBg: 'bg-teal-950/30',
    panelBorder: 'border-teal-500/30',
    text: 'text-teal-300',
    badge: 'JC',
  },
  prophecy: {
    label: 'Prophecy',
    accent: 'violet',
    panelBg: 'bg-violet-950/30',
    panelBorder: 'border-violet-500/30',
    text: 'text-violet-300',
    badge: 'PRO',
  },
  pyodide: {
    label: 'Pyodide',
    accent: 'yellow',
    panelBg: 'bg-yellow-950/30',
    panelBorder: 'border-yellow-500/30',
    text: 'text-yellow-300',
    badge: 'PY',
  },
  rust: {
    label: 'Rust',
    accent: 'orange',
    panelBg: 'bg-orange-950/30',
    panelBorder: 'border-orange-500/30',
    text: 'text-orange-300',
    badge: 'RS',
  },
  webgpu: {
    label: 'WebGPU',
    accent: 'fuchsia',
    panelBg: 'bg-fuchsia-950/30',
    panelBorder: 'border-fuchsia-500/30',
    text: 'text-fuchsia-300',
    badge: 'GPU',
  },
  wam: {
    label: 'WAM',
    accent: 'amber',
    panelBg: 'bg-amber-950/30',
    panelBorder: 'border-amber-500/30',
    text: 'text-amber-300',
    badge: 'WAM',
  },
  cpp: {
    label: 'CPP',
    accent: 'fuchsia',
    panelBg: 'bg-gradient-to-br from-indigo-950/40 via-fuchsia-950/30 to-rose-950/40',
    panelBorder: 'border-fuchsia-500/40',
    text: 'text-fuchsia-200',
    badge: 'CPP',
  },
};

/** Hardware panel artwork in public/osc/ — one WebP per oscillator family. */
export const OSCILLATOR_PANEL_IMAGES: Record<OscillatorType, string> = {
  javascript: '/osc/js.webp',
  pcm: '/osc/pcm.webp',
  open303: '/osc/open303.webp',
  jc303: '/osc/jc303.webp',
  prophecy: '/osc/prophecy.webp',
  pyodide: '/osc/pyodide.webp',
  rust: '/osc/rust.webp',
  webgpu: '/osc/webgpu.webp',
  wam: '/osc/wam.webp',
  cpp: '/osc/cpp.webp',
};

/** Derive the OscillatorType from a concrete Waveform + optional engine303 override. */
export function waveformToOscillatorType(waveform: Waveform, engine303?: Engine303): OscillatorType {
  const w = waveform as string;
  if (['sawtooth', 'square', 'triangle', 'sine'].includes(w)) return 'javascript';
  if (w.startsWith('wav-')) return 'pcm';
  if (w.startsWith('303-')) {
    return engine303 === 'jc303' ? 'jc303' : 'open303';
  }
  if (w.startsWith('prophecy-')) return 'prophecy';
  if (w.startsWith('pyodide-')) return 'pyodide';
  if (w.startsWith('rust-')) return 'rust';
  if (w.startsWith('wgsl-')) return 'webgpu';
  if (w.startsWith('wam-')) return 'wam';
  if (w.startsWith('cpp-')) return 'cpp';
  return 'javascript';
}

/** Returns Tailwind classes for a subtle themed container around the oscillator controls. */
export function getOscillatorPanelClasses(type: OscillatorType): string {
  const t = OSCILLATOR_THEMES[type];
  return `${t.panelBg} ${t.panelBorder} ${t.text}`;
}

/** Pick a representative default waveform when the user switches OscillatorType. */
export function getDefaultWaveformForType(type: OscillatorType): Waveform {
  switch (type) {
    case 'javascript': return 'sawtooth';
    case 'pcm': return 'wav-saw';
    case 'open303': return '303-saw';
    case 'jc303': return '303-saw';
    case 'prophecy': return 'prophecy-saw';
    case 'pyodide': return 'pyodide-saw';
    case 'rust': return 'rust-saw';
    case 'webgpu': return 'wgsl-saw';
    case 'wam': return 'wam-saw';
    case 'cpp': return 'cpp-saw';
    default: return 'sawtooth';
  }
}

/** Return the concrete Waveform choices available for a given high-level OscillatorType (used by per-type variant picker). */
export function getWaveformsForType(type: OscillatorType): Waveform[] {
  switch (type) {
    case 'javascript': return ['sawtooth', 'square', 'triangle', 'sine'];
    case 'pcm': return ['wav-saw', 'wav-sqr'];
    case 'open303':
    case 'jc303': return ['303-saw', '303-sqr'];
    case 'prophecy': return ['prophecy-saw', 'prophecy-sqr', 'prophecy-tri', 'prophecy-pulse'];
    case 'pyodide': return ['pyodide-saw', 'pyodide-square', 'pyodide-sine'];
    case 'rust': return ['rust-saw', 'rust-sqr'];
    case 'webgpu': return ['wgsl-saw', 'wgsl-sqr', 'wgsl-tri', 'wgsl-sin'];
    case 'wam': return ['wam-saw', 'wam-sqr', 'wam-tri', 'wam-sin'];
    case 'cpp': return ['cpp-sin', 'cpp-saw', 'cpp-sqr', 'cpp-rand'];
    default: return ['sawtooth'];
  }
}

export interface Bass2Params {
  waveform: '303-saw' | '303-sqr';
  cutoff: number;
  resonance: number;
  filterMode: number;
  drive?: number;
  decay: number;
  accent: number;
  envMod: number;
  volume: number;
  pitch: number;
  pan?: number;
  /** Legacy DSP engine field. Superseded by model303 but still written on save. */
  engine303?: Engine303;
  /** Selected 303 voice/model (see engines/TB303Models.ts). Defaults to 'stock-open303'. */
  model303?: TB303ModelId;
  /**
   * Slide/portamento time (0–1 normalized, where 0.33 ≈ 60 ms TB-303 default).
   * Maps to Open303Params.slideTime for the Devil Fish MOD.
   */
  slideTime?: number;
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
  vibratoDepth?: number;
  vibratoRate?: number;
  volume?: number;
  grainJitter?: number;
  formantShift?: number;
  grainSize?: number;
}

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
  consonantClarity?: number;
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

/** Instruments that expose a color-coded expression LED in the rack UI. */
export type ExpressionLedTarget =
  | 'synthA' | 'synthB' | 'bass2'
  | 'kick' | 'snare' | 'closedHat' | 'openHat'
  | 'sampler';

export type TrackAnalysers = Partial<Record<ExpressionLedTarget, AnalyserNode>>;

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
  prophecyManager?: import('./engines/ProphecyManager').ProphecyManager | null;
  /** PcfEffect instance for PCF automation wiring; set after init. */
  pcfEffect?: import('./engines/PcfEffect').PcfEffect | null;
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

// ... rest of your types (SongStructure, SavedSongData, etc.)
export interface AutomationPoint {
  step: number;
  value: number;
  customWindowShape?: number[];
  volumeFilterMod?: number;
}

export interface KnobAutomation {
  paramId: string;
  trackKey: string;
  points: AutomationPoint[];
  isRecording: boolean;
}

// ============================================================================
// AUTOMATION LANE SYSTEM (Issue #652)
// ============================================================================

/** Automation target — which track/instrument the lane controls */
export type AutomationTarget =
  | 'synthA' | 'synthB' | 'bass2'
  | 'kick' | 'snare' | 'closedHat' | 'openHat'
  | 'sampler' | 'master'
  | 'sampler0' | 'sampler1' | 'sampler2' | 'sampler3'
  | 'sampler4' | 'sampler5' | 'sampler6' | 'sampler7'
  | 'wam';

/** Where the automation data originated */
export type AutomationSource = 'rbs' | 'recorded' | 'ai' | 'manual';

/** Interpolation mode between automation points */
export type AutomationInterpolation = 'step' | 'linear' | 'smooth';

/** Scope of the automation lane */
export type AutomationScope = 'pattern' | 'song';

/**
 * Barrel re-export for the domain types that used to live directly in this
 * file (#1233/#1259 follow-up). Domain modules live in `src/types/*`; this
 * file exists only so pre-existing `from '../types'` imports keep working.
 *
 * Oscillator UI theme/image tables (`OSCILLATOR_THEMES`,
 * `OSCILLATOR_PANEL_IMAGES`, `waveformToOscillatorType`, etc.) are NOT
 * re-exported here — they moved to `src/components/oscillatorThemes.ts`
 * since they are UI helpers, not domain types.
 */
export * from './types/synth';
export * from './types/drums';
export * from './types/sampler';
export * from './types/pattern';
export * from './types/automation';
export * from './types/engine';
export * from './types/song';
