/**
 * Hyphon → ReBirth RBS encoders (inverse of RbsImporter mapping).
 */

import type { Note, PartSequence, SynthParams, Bass2Params } from '../../types';
import type { DrumPattern, HyphonSong, PcfSettings, Tb303PatternA, Tb303Step } from './types';
import { noteToMidi } from '../../utils/musicTheory';
import type { Tb303DeviceParams } from './iffBuilder';

function clampByte(value: number): number {
  return Math.max(0, Math.min(127, Math.round(value)));
}

/** Inverse of RbsImporter.convertCutoffToHz */
export function hzToRbsCutoff(hz: number): number {
  const clamped = Math.max(100, Math.min(8000, hz));
  return clampByte(21.17 * Math.log2(clamped / 100));
}

/** Inverse of RbsImporter.convertResonance */
export function hyphonResonanceToRbs(resonance: number): number {
  return clampByte(resonance * 6.35);
}

/** Inverse of RbsImporter.convertDecayToSeconds */
export function hyphonDecayToRbs(decaySeconds: number): number {
  const clamped = Math.max(0.05, Math.min(2.0, decaySeconds));
  return clampByte((127 * Math.log(clamped / 0.05)) / Math.log(40));
}

/** Inverse of RbsImporter.convertAccentToBoost (volume knob → accent byte). */
export function hyphonVolumeToRbsAccent(volume: number): number {
  return clampByte((volume - 0.6) * 317.5);
}

export function hyphonFilterModeToEnvMod(filterMode: number): number {
  return clampByte((filterMode ?? 0) * 127);
}

export function hyphonWaveformToRbs(waveform: string): 0 | 1 {
  return waveform === '303-sqr' || waveform === 'square' ? 1 : 0;
}

/** Collapse 32 Hyphon steps to 16 ReBirth steps (first sub-step of each 16th). */
export function collapseHyphonStepsTo16(steps: (Note | null)[]): (Note | null)[] {
  if (steps.length <= 16) {
    return steps.slice(0, 16).concat(Array(Math.max(0, 16 - steps.length)).fill(null));
  }
  const out: (Note | null)[] = [];
  for (let i = 0; i < 16; i++) {
    out.push(steps[i * 2] ?? steps[i] ?? null);
  }
  return out;
}

export function hyphonNoteToTb303Step(note: Note | null, index: number): Tb303Step {
  if (!note) {
    return {
      index,
      note: -1,
      octave: 3,
      accent: false,
      slide: false,
      tie: false,
      gate: 100,
    };
  }

  const midi = noteToMidi(note.note);
  const noteNum = midi % 12;
  const octave = Math.max(1, Math.min(5, Math.floor(midi / 12) - 1));

  return {
    index,
    note: noteNum,
    octave,
    accent: note.velocity >= 0.9,
    slide: !!note.slide || (note.length ?? 1) >= 2,
    tie: false,
    gate: 100,
  };
}

export function partSequenceToTb303Steps(
  seq: PartSequence,
  collapse32: boolean,
): Tb303Step[] {
  const raw = collapse32 ? collapseHyphonStepsTo16(seq.steps) : seq.steps.slice(0, 16);
  return raw.map((note, index) => hyphonNoteToTb303Step(note, index));
}

export function partSequenceToDrumBooleans(
  seq: PartSequence,
  collapse32: boolean,
): boolean[] {
  const raw = collapse32 ? collapseHyphonStepsTo16(seq.steps) : seq.steps.slice(0, 16);
  return raw.map((n) => n !== null);
}

export function synthParamsToTb303DeviceParams(
  params: SynthParams | Bass2Params,
  metadata?: Omit<Tb303PatternA, 'steps'>,
): Tb303DeviceParams {
  if (metadata?.cutoff !== undefined) {
    return {
      cutoff: metadata.cutoff,
      resonance: metadata.resonance ?? 64,
      envMod: metadata.envMod ?? 64,
      decay: metadata.decay ?? 48,
      accent: metadata.accent ?? 80,
      waveform: metadata.waveform ?? 0,
    };
  }

  const isBass2 = 'cutoff' in params && !('filterCutoff' in params);
  const cutoffHz = isBass2
    ? (params as Bass2Params).cutoff
    : (params as SynthParams).filterCutoff;
  const resonanceVal = isBass2
    ? (params as Bass2Params).resonance
    : (params as SynthParams).filterResonance;

  return {
    cutoff: hzToRbsCutoff(cutoffHz),
    resonance: hyphonResonanceToRbs(resonanceVal),
    envMod: hyphonFilterModeToEnvMod(params.filterMode ?? 0),
    decay: hyphonDecayToRbs(params.decay),
    accent: hyphonVolumeToRbsAccent(params.volume),
    waveform: hyphonWaveformToRbs(params.waveform),
  };
}

export function buildDrumPatternFromHyphon(
  pattern: HyphonSong['pattern'],
  collapse32: boolean,
  kitType: '808' | '909',
): DrumPattern {
  return {
    kick: partSequenceToDrumBooleans(pattern.kick, collapse32),
    snare: partSequenceToDrumBooleans(pattern.snare, collapse32),
    closedHat: partSequenceToDrumBooleans(pattern.closedHat, collapse32),
    openHat: partSequenceToDrumBooleans(pattern.openHat, collapse32),
    accent: Array(16).fill(0),
    kitType,
  };
}

/** Build drum pattern bank from per-slot track storage (song mode). */
export function buildDrumPatternsFromTrackStorage(
  trackStorage: {
    kick: (PartSequence | null)[];
    snare: (PartSequence | null)[];
    closedHat: (PartSequence | null)[];
    openHat: (PartSequence | null)[];
  },
  slotCount: number,
  collapse32: boolean,
  kitType: '808' | '909',
): DrumPattern[] {
  const patterns: DrumPattern[] = [];
  for (let i = 0; i < slotCount; i++) {
    const kick = trackStorage.kick[i];
    const snare = trackStorage.snare[i];
    const closedHat = trackStorage.closedHat[i];
    const openHat = trackStorage.openHat[i];
    if (!kick && !snare && !closedHat && !openHat) {
      patterns.push({
        kick: Array(16).fill(false),
        snare: Array(16).fill(false),
        closedHat: Array(16).fill(false),
        openHat: Array(16).fill(false),
        accent: Array(16).fill(0),
        kitType,
      });
      continue;
    }
    patterns.push({
      kick: partSequenceToDrumBooleans(kick ?? { steps: Array(16).fill(null) }, collapse32),
      snare: partSequenceToDrumBooleans(snare ?? { steps: Array(16).fill(null) }, collapse32),
      closedHat: partSequenceToDrumBooleans(closedHat ?? { steps: Array(16).fill(null) }, collapse32),
      openHat: partSequenceToDrumBooleans(openHat ?? { steps: Array(16).fill(null) }, collapse32),
      accent: Array(16).fill(0),
      kitType,
    });
  }
  return patterns;
}

export function pcfSettingsToDevlPayload(pcf: PcfSettings): {
  enabled?: boolean;
  cutoff?: number;
  resonance?: number;
  envAmount?: number;
  wave?: number;
  decay?: number;
  filterType?: 'lp' | 'bp';
} {
  return {
    enabled: pcf.enabled,
    cutoff: pcf.cutoff,
    resonance: pcf.resonance,
    envAmount: pcf.envAmount,
    wave: pcf.waveIndex ?? 1,
    decay: pcf.decay,
    filterType: pcf.filterType === 'lp' ? 'lp' : 'bp',
  };
}

const PROPHECY_PREFIX = 'prophecy-';
const UNSUPPORTED_WAVEFORMS = new Set(['sampler', 'wav', 'rust', 'webgpu']);

export function collectExportWarnings(song: HyphonSong): string[] {
  const warnings: string[] = [];

  warnings.push('Sampler banks are not exported to ReBirth format.');
  warnings.push('Prophecy formant waveforms are not exported — TB-303 saw/square used instead.');

  const checkWave = (wf: string, label: string) => {
    if (wf.startsWith(PROPHECY_PREFIX)) {
      warnings.push(`${label} uses Prophecy waveform "${wf}" — exported as TB-303 saw.`);
    } else if (UNSUPPORTED_WAVEFORMS.has(wf) || wf.includes('rust') || wf.includes('wasm')) {
      warnings.push(`${label} waveform "${wf}" is not supported in ReBirth — exported as TB-303 saw.`);
    }
  };

  checkWave(song.params.synthA.waveform, 'Synth A');
  checkWave(song.params.synthB.waveform, 'Synth B');
  if (song.params.bass2) {
    checkWave(song.params.bass2.waveform, 'Bass 2');
  }

  return warnings;
}
