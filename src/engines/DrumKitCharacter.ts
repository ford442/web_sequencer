/**
 * Kit-specific synthesis multipliers shared by the WASM drumkit and the
 * Web Audio fallback. Keep in sync with emscripten/drumkit_wrapper.cpp.
 */

import type { DrumKitType } from '@/types';

export const DRUMKIT_VOICE = {
  kick: 0,
  snare: 1,
  closedHat: 2,
  openHat: 3,
} as const;

export type DrumkitVoiceId = (typeof DRUMKIT_VOICE)[keyof typeof DRUMKIT_VOICE];

export interface KitSynthCharacter {
  kickFreqStart: number;
  kickFreqEnd: number;
  kickWaveform: OscillatorType;
  kickPitchCurve: number;
  snareWaveform: OscillatorType;
  snareNoiseFreq: number;
  snareNoiseQ: number;
  hatResonance: number;
  hatOscCount: number;
}

export const KIT_CHARACTER: Record<DrumKitType, KitSynthCharacter> = {
  '808': {
    kickFreqStart: 1.0,
    kickFreqEnd: 0.08,
    kickWaveform: 'sine',
    kickPitchCurve: 0.6,
    snareWaveform: 'triangle',
    snareNoiseFreq: 1500,
    snareNoiseQ: 1.0,
    hatResonance: 2.0,
    hatOscCount: 4,
  },
  '909': {
    kickFreqStart: 1.2,
    kickFreqEnd: 0.01,
    kickWaveform: 'sine',
    kickPitchCurve: 0.3,
    snareWaveform: 'triangle',
    snareNoiseFreq: 3000,
    snareNoiseQ: 2.0,
    hatResonance: 4.0,
    hatOscCount: 6,
  },
};

export function kitToNativeId(kit: DrumKitType): number {
  return kit === '909' ? 1 : 0;
}
