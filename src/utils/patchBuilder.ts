import type { 
  SynthParams, 
  KickParams, 
  SnareParams, 
  HatParams, 
  Pattern, 
  PartSequence, 
  Note, 
  SamplerBankParams
} from '../types';

/**
 * PatchBuilder
 * 
 * A utility to programmatically generate valid Hyphon synthesis parameters and patterns.
 * This abstracts raw numbers into semantic intentions (e.g., "createAcidBass").
 */

export const PatchBuilder = {
  
  /**
   * Create a default empty pattern structure
   */
  createEmptyPattern(): Pattern {
    return {
      partA: this.createEmptySequence(),
      partB: this.createEmptySequence(),
      kick: this.createEmptySequence(),
      snare: this.createEmptySequence(),
      closedHat: this.createEmptySequence(),
      openHat: this.createEmptySequence(),
      sampler: Array(8).fill(null).map(() => this.createEmptySequence())
    };
  },

  createEmptySequence(): PartSequence {
    return {
      steps: Array(16).fill(null),
      automation: {}
    };
  },

  /**
   * Create a Note object with safe defaults
   */
  createNote(
    note: string, 
    velocity: number = 0.8, 
    length: number = 1.0, 
    slide: boolean = false,
    probability: number = 1.0
  ): Note {
    return {
      note,
      velocity,
      length,
      slide,
      probability
    };
  },

  /**
   * SYNTH FACTORIES
   */

  createDefaultSynth(): SynthParams {
    return {
      waveform: 'sawtooth',
      pitch: 0,
      filterCutoff: 2000,
      filterResonance: 1,
      filterMode: 0,
      attack: 0.01,
      decay: 0.2,
      sustain: 0.5,
      release: 0.5,
      length: 0.5,
      volume: 0.5,
      delayTime: 0.3,
      delayFeedback: 0.3,
      delayMix: 0.0
    };
  },

  createBass(type: 'acid' | 'plucky' | 'sub' = 'plucky'): SynthParams {
    const base = this.createDefaultSynth();
    switch (type) {
      case 'acid':
        return {
          ...base,
          waveform: '303-sqr',
          filterCutoff: 400,
          filterResonance: 12, // High resonance for acid squelch
          attack: 0.01,
          decay: 0.3,
          sustain: 0.0,
          release: 0.1,
          volume: 0.7,
          delayMix: 0.2 // Slight delay for space
        };
      case 'sub':
        return {
          ...base,
          waveform: 'triangle',
          pitch: -12, // Down an octave
          filterCutoff: 300,
          filterResonance: 0,
          attack: 0.05,
          decay: 0.5,
          sustain: 1.0,
          release: 0.5,
          volume: 0.9
        };
      case 'plucky':
      default:
        return {
          ...base,
          waveform: 'square',
          filterCutoff: 1500,
          filterResonance: 2,
          attack: 0.0,
          decay: 0.2,
          sustain: 0.0,
          release: 0.2,
          volume: 0.6
        };
    }
  },

  createPad(type: 'warm' | 'bright' = 'warm'): SynthParams {
    const base = this.createDefaultSynth();
    return {
      ...base,
      waveform: type === 'warm' ? 'triangle' : 'sawtooth',
      filterCutoff: type === 'warm' ? 800 : 4000,
      filterResonance: 0.5,
      attack: 1.0, // Slow attack
      decay: 2.0,
      sustain: 0.8,
      release: 2.0, // Long tail
      volume: 0.4,
      delayMix: 0.5, // Washy
      delayFeedback: 0.6,
      delayTime: 0.5
    };
  },

  /**
   * DRUM FACTORIES
   */

  createKick(type: 'punchy' | 'boomy' | 'distorted' = 'punchy'): KickParams {
    switch (type) {
      case 'boomy':
        return { decay: 0.8, tone: 0.2, pitch: 40, volume: 0.9 };
      case 'distorted':
        return { decay: 0.5, tone: 1.0, pitch: 55, volume: 0.8 };
      case 'punchy':
      default:
        return { decay: 0.3, tone: 0.8, pitch: 50, volume: 0.8 };
    }
  },

  createSnare(type: 'tight' | 'splashy' = 'tight'): SnareParams {
    switch (type) {
      case 'splashy':
        return { decay: 0.6, tone: 0.5, noise: 0.8, volume: 0.7 };
      case 'tight':
      default:
        return { decay: 0.2, tone: 0.8, noise: 0.4, volume: 0.8 };
    }
  },

  createHat(type: 'closed' | 'open'): HatParams {
    if (type === 'open') {
      return { decay: 0.5, pitch: 6000, volume: 0.6 };
    }
    return { decay: 0.05, pitch: 8000, volume: 0.7 };
  },

  /**
   * SAMPLER FACTORIES
   */
   
  createSamplerBank(name: string = 'sample'): SamplerBankParams {
    return {
        sampleName: name,
        playbackSpeed: 1.0,
        volume: 0.8,
        filterCutoff: 20000,
        filterResonance: 0,
        drive: 0,
        delaySend: 0,
        mode: 'loop',
        grainSize: 0.1,
        timeRatio: 1.0,
        pitchScale: 1.0,
        formantShift: 0,
        vibratoDepth: 0,
        breathIntensity: 0,
        sliceMode: 'off',
        choir: 0,
        glitchChance: 0
    };
  }
};
