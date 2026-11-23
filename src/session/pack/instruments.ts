/**
 * The instrument settings a pack may carry (SYNTH A / B): which waveforms, and the numeric range of each
 * field. Shared by the schema (which turns them into the contract) and the exporter (which clamps live
 * values into them); kept apart from the schema builders so the importer's lazy chunk does not ship those.
 */

import { MACRO_ENGINES } from '@/engines/MacroParams';
import type { MacroSynthParams, MacroWaveform, SynthParams, Waveform } from '@/types';

/** Every waveform that is not a macro model. The mapped type fails to compile if `Waveform` changes. */
const BASE_WAVEFORMS = {
  sawtooth: 0, square: 0, triangle: 0, sine: 0,
  'pyodide-saw': 0, 'pyodide-square': 0, 'pyodide-sine': 0,
  'wgsl-saw': 0, 'wgsl-sqr': 0, 'wgsl-tri': 0, 'wgsl-sin': 0,
  'wam-saw': 0, 'wam-sqr': 0, 'wam-tri': 0, 'wam-sin': 0,
  'rust-saw': 0, 'rust-sqr': 0, 'rust-tri': 0, 'rust-sin': 0,
  'wav-saw': 0, 'wav-sqr': 0,
  '303-saw': 0, '303-sqr': 0,
  'prophecy-saw': 0, 'prophecy-sqr': 0, 'prophecy-tri': 0, 'prophecy-pulse': 0,
} as const satisfies Record<Exclude<Waveform, MacroWaveform>, 0>;

/** Waveform ids a pack's SYNTH A / B may name. */
export const PACK_WAVEFORMS: readonly Waveform[] = [
  ...(Object.keys(BASE_WAVEFORMS) as Waveform[]),
  ...MACRO_ENGINES.map((engine) => engine.waveform),
];

/** Instrument fields a pack carries (SYNTH A / B). `model303Extra` and the retired `cppFine` are not part of the format. */
export const PACK_SYNTH_NUMERIC_RANGES: Partial<Record<keyof SynthParams, [number, number]>> = {
  pitch: [-48, 48],
  filterCutoff: [20, 20000],
  filterResonance: [0, 40],
  filterMode: [0, 1],
  drive: [0, 1],
  attack: [0, 10],
  decay: [0, 10],
  sustain: [0, 1],
  release: [0, 10],
  length: [0, 10],
  volume: [0, 2],
  pan: [-1, 1],
  delayTime: [0, 4],
  delayFeedback: [0, 0.99],
  delayMix: [0, 1],
  pitchAttack: [0, 10],
  pitchDecay: [0, 10],
  pitchAmount: [-48, 48],
  vowel: [0, 4],
  portamento: [0, 1],
  formantShift: [0, 1],
  formantPitchLink: [0, 1],
  coarseTune: [-48, 48],
  fineTune: [-1200, 1200],
};

/** `SynthParams.macro` knobs that are plain numbers (`polyphony` and `lpgMode` are special-cased). */
export const PACK_MACRO_RANGES: Readonly<Record<Exclude<keyof MacroSynthParams, 'polyphony' | 'lpgMode'>, [number, number]>> = {
  harmonics: [0, 1],
  timbre: [0, 1],
  morph: [0, 1],
  decay: [0, 1],
  lpgColour: [0, 1],
  fmMod: [-1, 1],
  timbreMod: [-1, 1],
  morphMod: [-1, 1],
  spread: [0, 1],
  glide: [0, 1],
  auxMix: [0, 1],
};
