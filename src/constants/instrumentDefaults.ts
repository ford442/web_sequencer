/**
 * Default instrument patches and drum kits. The one constants module that
 * imports engine code (the kit presets and the TB-303 voice fields): import
 * it from app code, never from `src/engines` (see
 * `src/constants/__tests__/constantsLayering.test.ts`).
 */
import type { SynthParams, KickParams, SnareParams, HatParams, SamplerBankParams, SamplerParams, DrumKitType } from '../types';
import { DRUM_KIT_PRESETS } from '../engines/DrumKitPresets';
import { DEFAULT_TB303_VOICE_FIELDS } from '../engines/TB303Models';

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
  engine303: DEFAULT_TB303_VOICE_FIELDS.engine303,
  model303: DEFAULT_TB303_VOICE_FIELDS.model303,
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
