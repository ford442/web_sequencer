import type { Pattern, SynthParams, KickParams, SnareParams, HatParams, AmbianceTrack } from './types';
import type { SamplerParams } from './types';

export const NUM_STEPS = 32;
export const DEFAULT_TEMPO = 120;

export const DEFAULT_SYNTH_PARAMS_A: SynthParams = {
  waveform: 'sawtooth',
  pitch: 0,
  filterCutoff: 2500,
  filterResonance: 5,
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

export const DEFAULT_KICK_PARAMS: KickParams = { pitch: 60, decay: 0.4, tone: 0.9, volume: 1 };
export const DEFAULT_SNARE_PARAMS: SnareParams = { decay: 0.2, tone: 150, noise: 5000, volume: 0.8 };
export const DEFAULT_CLOSED_HAT_PARAMS: HatParams = { pitch: 9000, decay: 0.05, volume: 0.4 };

export const DEFAULT_OPEN_HAT_PARAMS: HatParams = { pitch: 7000, decay: 0.4, volume: 0.4 };
export const DEFAULT_SAMPLER_PARAMS: SamplerParams = { sampleName: 'default', playbackSpeed: 1.0, volume: 0.8 };

export const INITIAL_PATTERN: Pattern = {
  length: NUM_STEPS,
  partA: {
    steps: [
      { note: 'C4', velocity: 1 }, null, null, null,
      { note: 'E4', velocity: 1 }, null, null, null,
      { note: 'G4', velocity: 1 }, null, null, null,
      { note: 'E4', velocity: 1 }, null, null, null,
      ...Array(16).fill(null)
    ],
  },
  partB: {
    steps: [
      null, null, { note: 'C3', velocity: 0.8 }, null,
      null, null, { note: 'C3', velocity: 0.8 }, null,
      null, null, { note: 'D3', velocity: 0.8 }, null,
      null, null, { note: 'C3', velocity: 0.8 }, null,
      ...Array(16).fill(null)
    ],
  },
  kick: {
    steps: [
      { note: 'C2', velocity: 1 }, null, null, null, 
      { note: 'C2', velocity: 1 }, null, null, null,
      { note: 'C2', velocity: 1 }, null, null, null, 
      { note: 'C2', velocity: 1 }, null, null, null,
      ...Array(16).fill(null)
    ]
  },
  snare: {
    steps: [
      null, null, null, null, 
      { note: 'C2', velocity: 1 }, null, null, null,
      null, null, null, null, 
      { note: 'C2', velocity: 1 }, null, null, null,
      ...Array(16).fill(null)
    ]
  },
  closedHat: {
    steps: [
      { note: 'C2', velocity: 0.7 }, { note: 'C2', velocity: 0.7 }, { note: 'C2', velocity: 0.7 }, { note: 'C2', velocity: 0.7 },
      { note: 'C2', velocity: 0.7 }, { note: 'C2', velocity: 0.7 }, { note: 'C2', velocity: 0.7 }, { note: 'C2', velocity: 0.7 },
      { note: 'C2', velocity: 0.7 }, { note: 'C2', velocity: 0.7 }, { note: 'C2', velocity: 0.7 }, { note: 'C2', velocity: 0.7 },
      { note: 'C2', velocity: 0.7 }, { note: 'C2', velocity: 0.7 }, { note: 'C2', velocity: 0.7 }, { note: 'C2', velocity: 0.7 },
      ...Array(16).fill(null)
    ]
  },
  openHat: {
    steps: [
      null, null, null, null,
      null, null, null, null,
      null, null, { note: 'C2', velocity: 0.8 }, null,
      null, null, null, null,
      ...Array(16).fill(null)
    ]
  },
  sampler: {
    steps: Array(NUM_STEPS).fill(null)
  }
};

export const AMBIANCE_TRACKS: AmbianceTrack[] = [
    { name: 'None', url: '' },
    { name: 'Ocean Waves', url: 'https://www.soundjay.com/nature/ocean-wave-1.mp3' },
    { name: 'Crickets', url: 'https://www.soundjay.com/nature/crickets-1.mp3' },
    { name: 'Rain', url: 'https://www.soundjay.com/nature/rain-01.mp3' },
    { name: 'Forest', url: 'https://www.soundjay.com/nature/forest-1.mp3' },
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
