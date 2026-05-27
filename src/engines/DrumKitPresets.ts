/**
 * Drum Kit Presets
 *
 * Authentic TR-808 and TR-909 default parameter sets modeled after
 * the classic ReBirth RB-338 drum machine defaults.
 *
 * 808: Deeper kick, lower snare tone, less noise snap, longer decay
 * 909: Tighter kick, higher snare tone, more noise snap, punchier
 */

import type { KickParams, SnareParams, HatParams, DrumKitType } from '../types';

/** Synthesis parameters that define the character of a drum kit */
export interface DrumKitPreset {
  readonly name: string;
  readonly kick: KickParams;
  readonly snare: SnareParams;
  readonly closedHat: HatParams;
  readonly openHat: HatParams;
}

/**
 * TR-808 preset: Deep, boomy kick with long decay; snappy but warm snare;
 * crisp metallic hats with moderate decay.
 */
export const PRESET_808: DrumKitPreset = {
  name: 'TR-808',
  kick: {
    pitch: 50,
    decay: 0.6,
    tone: 0.6,
    volume: 1.0,
  },
  snare: {
    decay: 0.3,
    tone: 200,
    noise: 2000,
    volume: 0.9,
  },
  closedHat: {
    pitch: 8000,
    decay: 0.05,
    volume: 0.7,
  },
  openHat: {
    pitch: 6500,
    decay: 0.5,
    volume: 0.7,
  },
};

/**
 * TR-909 preset: Punchy, tight kick; bright snare with more noise;
 * crisp hats with faster attack.
 */
export const PRESET_909: DrumKitPreset = {
  name: 'TR-909',
  kick: {
    pitch: 65,
    decay: 0.35,
    tone: 0.8,
    volume: 1.0,
  },
  snare: {
    decay: 0.2,
    tone: 300,
    noise: 4000,
    volume: 0.9,
  },
  closedHat: {
    pitch: 10000,
    decay: 0.04,
    volume: 0.7,
  },
  openHat: {
    pitch: 8000,
    decay: 0.35,
    volume: 0.7,
  },
};

/** Map of kit type to preset */
export const DRUM_KIT_PRESETS: Record<DrumKitType, DrumKitPreset> = {
  '808': PRESET_808,
  '909': PRESET_909,
};

/**
 * Get default drum parameters for a given kit type
 */
export function getDrumKitDefaults(kitType: DrumKitType): DrumKitPreset {
  return DRUM_KIT_PRESETS[kitType];
}
