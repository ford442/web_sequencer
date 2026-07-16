import { noteToMidi, applyMicrotonalTuning } from './utils/musicTheory';
import type { ScaleDefinition } from './utils/musicTheory';
import type { Pattern, SynthParams, KickParams, SnareParams, HatParams, SamplerBankParams, SamplerParams, AmbianceTrack, DrumKitType } from './types';
import { DRUM_KIT_PRESETS } from './engines/DrumKitPresets';

export const NUM_STEPS = 32;
export const DEFAULT_TEMPO = 120;

/** Legacy pattern-mode bank size (pre–v2 saved songs). */
export const LEGACY_TRACK_PATTERN_SLOTS = 8;
/** ReBirth-compatible pattern banks per track (DEVL supports 32). */
export const MAX_TRACK_PATTERN_SLOTS = 32;
/** SavedSongData schema: 1 = 8 slots, 2 = 32 slots. */
export const SAVED_SONG_DATA_VERSION = 2;

export const TRACK_KEYS = [
  'partA',
  'partB',
  'bass2',
  'kick',
  'snare',
  'closedHat',
  'openHat',
  'sampler',
] as const;

export const DEFAULT_SYNTH_PARAMS_A: SynthParams = {
  waveform: 'sawtooth',
  pitch: 0,
  filterCutoff: 2500,
  filterResonance: 5,
  filterMode: 0,
  drive: 0,
  attack: 0.01,
  decay: 0.2,
  sustain: 0.5,
  release: 0.1,
  length: 0.25,
  volume: 0.5,
  delayTime: 0.3,
  delayFeedback: 0.4,
  delayMix: 0.35,
};

export const DEFAULT_SYNTH_PARAMS_B: SynthParams = {
  waveform: 'square',
  pitch: -12,
  filterCutoff: 1500,
  filterResonance: 8,
  filterMode: 0,
  drive: 0,
  attack: 0.02,
  decay: 0.3,
  sustain: 0.4,
  release: 0.1,
  length: 0.25,
  volume: 0.4,
  delayTime: 0.0,
  delayFeedback: 0.0,
  delayMix: 0.0,
};

export const DEFAULT_BASS2_PARAMS = {
  waveform: '303-sqr' as const,
  pitch: -12,
  cutoff: 3000,
  resonance: 12,
  filterMode: 0,
  drive: 0,
  decay: 0.4,
  accent: 0.7,
  envMod: 0.5,
  volume: 0.45,
  engine303: 'open303' as const,
};

export const DEFAULT_KICK_PARAMS: KickParams = { pitch: 60, decay: 0.4, tone: 0.9, volume: 1 };
export const DEFAULT_SNARE_PARAMS: SnareParams = { decay: 0.2, tone: 150, noise: 5000, volume: 0.8 };
export const DEFAULT_CLOSED_HAT_PARAMS: HatParams = { pitch: 9000, decay: 0.05, volume: 0.4 };

export const DEFAULT_OPEN_HAT_PARAMS: HatParams = { pitch: 7000, decay: 0.4, volume: 0.4 };

/** Default drum kit type */
export const DEFAULT_DRUM_KIT: DrumKitType = '808';

/**
 * Get default drum params for a specific kit type.
 * Use this when switching kits or loading .rbs files.
 */
export function getKitDrumParams(kitType: DrumKitType): { kick: KickParams; snare: SnareParams; closedHat: HatParams; openHat: HatParams } {
  const preset = DRUM_KIT_PRESETS[kitType];
  return {
    kick: { ...preset.kick },
    snare: { ...preset.snare },
    closedHat: { ...preset.closedHat },
    openHat: { ...preset.openHat },
  };
}

// This is just a helper, the actual default is array of 8 of these
export const DEFAULT_SAMPLER_BANK_PARAMS: SamplerBankParams = {
  sampleName: 'default',
  playbackSpeed: 1.0,
  volume: 0.8,
  filterCutoff: 20000,
  filterResonance: 0,
  drive: 0,
  delaySend: 0,
  mode: 'loop',
  glitchChance: 0
};

export const DEFAULT_SAMPLER_PARAMS: SamplerParams = Array.from({length: 8}, () => ({...DEFAULT_SAMPLER_BANK_PARAMS}));

export const INITIAL_PATTERN: Pattern = {
  partA: {
    steps: [
      // Bar 1 (C Major Arp)
      { note: 'C4', velocity: 1, length: 1 }, null, null, null,
      { note: 'E4', velocity: 1, length: 1 }, null, null, null,
      { note: 'G4', velocity: 1, length: 1 }, null, null, null,
      { note: 'E4', velocity: 1, length: 1 }, null, null, null,
      // Bar 2 (F Major Variation)
      { note: 'C4', velocity: 1, length: 1 }, null, null, null,
      { note: 'F4', velocity: 1, length: 1 }, null, null, null,
      { note: 'A4', velocity: 1, length: 1 }, null, null, null,
      { note: 'F4', velocity: 1, length: 1 }, null, null, null,
    ],
  },
  partB: {
    steps: [
      // Bar 1 (C Root)
      null, null, { note: 'C3', velocity: 0.8 }, null,
      null, null, { note: 'C3', velocity: 0.8 }, null,
      null, null, { note: 'D3', velocity: 0.8 }, null,
      null, null, { note: 'C3', velocity: 0.8 }, null,
      // Bar 2 (F Root)
      null, null, { note: 'F3', velocity: 0.8 }, null,
      null, null, { note: 'F3', velocity: 0.8 }, null,
      null, null, { note: 'G3', velocity: 0.8 }, null,
      null, null, { note: 'F3', velocity: 0.8 }, null,
    ],
  },
  bass2: {
    steps: [
      // Bar 1 (Counter bass line)
      null, null, { note: 'G2', velocity: 0.9 }, null,
      null, null, { note: 'G2', velocity: 0.7 }, null,
      null, null, { note: 'A2', velocity: 0.9 }, null,
      null, null, { note: 'G2', velocity: 0.7 }, null,
      // Bar 2 (Counter bass line variation)
      null, null, { note: 'C3', velocity: 0.9 }, null,
      null, null, { note: 'C3', velocity: 0.7 }, null,
      null, null, { note: 'D3', velocity: 0.9 }, null,
      null, null, { note: 'C3', velocity: 0.7 }, null,
    ],
  },
  kick: {
    steps: [
      // Bar 1
      { note: 'C2', velocity: 1 }, null, null, null,
      { note: 'C2', velocity: 1 }, null, null, null,
      { note: 'C2', velocity: 1 }, null, null, null,
      { note: 'C2', velocity: 1 }, null, null, null,
      // Bar 2
      { note: 'C2', velocity: 1 }, null, null, null,
      { note: 'C2', velocity: 1 }, null, null, null,
      { note: 'C2', velocity: 1 }, null, null, null,
      { note: 'C2', velocity: 1 }, null, null, null,
    ]
  },
  snare: {
    steps: [
      // Bar 1
      null, null, null, null,
      { note: 'C2', velocity: 1 }, null, null, null,
      null, null, null, null,
      { note: 'C2', velocity: 1 }, null, null, null,
      // Bar 2 (With ghost note at end)
      null, null, null, null,
      { note: 'C2', velocity: 1 }, null, null, null,
      null, null, null, null,
      { note: 'C2', velocity: 1 }, null, { note: 'C2', velocity: 0.6 }, null,
    ]
  },
  closedHat: {
    steps: [
      // Bar 1
      { note: 'C2', velocity: 0.7 }, { note: 'C2', velocity: 0.5 }, { note: 'C2', velocity: 0.7 }, { note: 'C2', velocity: 0.5 },
      { note: 'C2', velocity: 0.7 }, { note: 'C2', velocity: 0.5 }, { note: 'C2', velocity: 0.7 }, { note: 'C2', velocity: 0.5 },
      { note: 'C2', velocity: 0.7 }, { note: 'C2', velocity: 0.5 }, { note: 'C2', velocity: 0.7 }, { note: 'C2', velocity: 0.5 },
      { note: 'C2', velocity: 0.7 }, { note: 'C2', velocity: 0.5 }, { note: 'C2', velocity: 0.7 }, { note: 'C2', velocity: 0.5 },
      // Bar 2
      { note: 'C2', velocity: 0.7 }, { note: 'C2', velocity: 0.5 }, { note: 'C2', velocity: 0.7 }, { note: 'C2', velocity: 0.5 },
      { note: 'C2', velocity: 0.7 }, { note: 'C2', velocity: 0.5 }, { note: 'C2', velocity: 0.7 }, { note: 'C2', velocity: 0.5 },
      { note: 'C2', velocity: 0.7 }, { note: 'C2', velocity: 0.5 }, { note: 'C2', velocity: 0.7 }, { note: 'C2', velocity: 0.5 },
      { note: 'C2', velocity: 0.7 }, { note: 'C2', velocity: 0.5 }, { note: 'C2', velocity: 0.7 }, { note: 'C2', velocity: 0.5 },
    ]
  },
  openHat: {
    steps: [
      // Bar 1
      null, null, null, null,
      null, null, null, null,
      null, null, { note: 'C2', velocity: 0.8 }, null,
      null, null, null, null,
      // Bar 2
      null, null, null, null,
      null, null, null, null,
      null, null, { note: 'C2', velocity: 0.8 }, null,
      null, null, null, null,
    ]
  },
  sampler: Array.from({length: 8}, () => ({ steps: Array(NUM_STEPS).fill(null) }))
};

export const AMBIANCE_TRACKS: AmbianceTrack[] = [
  { id: 'none', name: 'None', url: '' },
  { id: 'ocean', name: 'Ocean Waves', url: 'https://www.soundjay.com/nature/ocean-wave-1.mp3' },
  { id: 'crickets', name: 'Crickets', url: 'https://www.soundjay.com/nature/crickets-1.mp3' },
  { id: 'rain', name: 'Rain', url: 'https://www.soundjay.com/nature/rain-01.mp3' },
  { id: 'forest', name: 'Forest', url: 'https://www.soundjay.com/nature/forest-1.mp3' },
];

// Note to Frequency mapping
const noteFrequencies: { [key: string]: number } = {
  'C2': 65.41, 'C#2': 69.30, 'D2': 73.42, 'D#2': 77.78, 'E2': 82.41, 'F2': 87.31, 'F#2': 92.50, 'G2': 98.00, 'G#2': 103.83, 'A2': 110.00, 'A#2': 116.54, 'B2': 123.47,
  'C3': 130.81, 'C#3': 138.59, 'D3': 146.83, 'D#3': 155.56, 'E3': 164.81, 'F3': 174.61, 'F#3': 185.00, 'G3': 196.00, 'G#3': 207.65, 'A3': 220.00, 'A#3': 233.08, 'B3': 246.94,
  'C4': 261.63, 'C#4': 277.18, 'D4': 293.66, 'D#4': 311.13, 'E4': 329.63, 'F4': 349.23, 'F#4': 369.99, 'G4': 392.00, 'G#4': 415.30, 'A4': 440.00, 'A#4': 466.16, 'B4': 493.88,
  'C5': 523.25, 'C#5': 554.37, 'D5': 587.33, 'D#5': 622.25, 'E5': 659.25, 'F5': 698.46, 'F#5': 739.99, 'G5': 783.99, 'G#5': 830.61, 'A5': 880.00, 'A#5': 932.33, 'B5': 987.77,
};

export const noteToFrequency = (note: string): number => {
  return noteFrequencies[note] || 440.00; // Default to A4 if not found
};


export const tunedNoteToFrequency = (note: string, tuning: ScaleDefinition | null = null): number => {
  const baseMidi = noteToMidi(note);
  if (!baseMidi) return noteToFrequency(note);

  if (!tuning || !tuning.tuning || tuning.tuning === '12-TET') {
    // Return standard lookup to avoid math precision issues for 12-TET if possible,
    // or just calculate it directly.
    return noteToFrequency(note);
  }

  const tunedMidi = applyMicrotonalTuning(baseMidi, tuning);
  // midiToFreq logic:
  return 440.00 * Math.pow(2, (tunedMidi - 69) / 12);
};
