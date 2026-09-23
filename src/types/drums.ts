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

export interface AllDrumParams {
  kick: KickParams;
  snare: SnareParams;
  closedHat: HatParams;
  openHat: HatParams;
}
