/**
 * Cross-boundary guards: SynthParams keys, Note shape, drum tuning ranges.
 */
import { describe, expect, it } from 'vitest';
import type { SynthParams, Bass2Params, Note } from '../types';
import { RbsImporter } from '../importers/rbs/RbsImporter';
import { RbsParser } from '../importers/rbs/RbsParser';
import type { HyphonAutomationLane } from '../importers/rbs/types';
import { AUTOMATION_PARAMETER_MAP } from '../importers/rbs/types';

const SYNTH_PARAM_KEYS = new Set(Object.keys({
  waveform: 0,
  pitch: 0,
  filterCutoff: 0,
  filterResonance: 0,
  filterMode: 0,
  attack: 0,
  decay: 0,
  sustain: 0,
  release: 0,
  length: 0,
  volume: 0,
  pan: 0,
  delayTime: 0,
  delayFeedback: 0,
  delayMix: 0,
  engine303: 'open303',
  model303: 'stock-open303',
  pitchAttack: 0,
  pitchDecay: 0,
  pitchAmount: 0,
  vowel: 0,
  portamento: 0,
  formantShift: 0,
  cppFine: 0,
  drive: 0,
  formantPitchLink: 0,
  coarseTune: 0,
  fineTune: 0,
} satisfies Record<keyof SynthParams, unknown>));

const BASS2_PARAM_KEYS = new Set(Object.keys({
  waveform: '303-saw',
  cutoff: 0,
  resonance: 0,
  filterMode: 0,
  decay: 0,
  accent: 0,
  envMod: 0,
  volume: 0,
  pitch: 0,
  pan: 0,
  engine303: 'open303',
  model303: 'stock-open303',
  slideTime: 0,
  drive: 0,
} satisfies Record<keyof Bass2Params, unknown>));

const SYNTH_AUTOMATION_EXTENSIONS = new Set(['accent', 'slide']);

const MASTER_AUTOMATION_PARAMS = new Set([
  'tempo', 'swing', 'volume', 'pcfModulation', 'pcfResonance', 'pcfEnvAmount', 'drumPcfModulation',
]);

const KICK_BOUNDS = { pitch: [40, 80] as const, decay: [0.1, 1.0] as const, tone: [0, 1] as const };
const SNARE_BOUNDS = { tone: [100, 400] as const, noise: [1000, 5000] as const, decay: [0.1, 0.8] as const };
const HAT_BOUNDS = { pitch: [5000, 15000] as const, decay: [0.05, 0.8] as const };

function inRange(v: number, [lo, hi]: readonly [number, number]) {
  expect(v).toBeGreaterThanOrEqual(lo);
  expect(v).toBeLessThanOrEqual(hi);
}

function assertAutomationParameterValid(lane: HyphonAutomationLane) {
  const { target, parameter } = lane;
  if (target === 'synthA' || target === 'synthB') {
    expect(
      SYNTH_PARAM_KEYS.has(parameter) || SYNTH_AUTOMATION_EXTENSIONS.has(parameter)
    ).toBe(true);
  } else if (target === 'bass2') {
    expect(
      BASS2_PARAM_KEYS.has(parameter) || SYNTH_AUTOMATION_EXTENSIONS.has(parameter)
    ).toBe(true);
  } else if (target === 'master') {
    expect(MASTER_AUTOMATION_PARAMS.has(parameter)).toBe(true);
  } else if (target === 'kick') {
    expect(['pitch', 'decay', 'tone', 'volume'].includes(parameter)).toBe(true);
  } else if (target === 'snare') {
    expect(['decay', 'tone', 'noise', 'volume'].includes(parameter)).toBe(true);
  } else if (target === 'closedHat' || target === 'openHat') {
    expect(['pitch', 'decay', 'volume'].includes(parameter)).toBe(true);
  }
}

function collectAllNotes(song: ReturnType<RbsImporter['convertToHyphonSong']>['song']): Note[] {
  const notes: Note[] = [];
  for (const steps of [
    song.pattern.partA.steps,
    song.pattern.partB.steps,
    song.pattern.kick.steps,
  ]) {
    for (const s of steps) {
      if (s) notes.push(s);
    }
  }
  return notes;
}

describe('RbsImporter cross-boundary guards', () => {
  it('every emitted automation parameter is valid for its target', () => {
    const importer = new RbsImporter({ convertPcfToAutomation: true });
    const raw = new RbsParser().generateMockData('x.rbs');

    raw.automation = Object.entries(AUTOMATION_PARAMETER_MAP).map(([id, param], idx) => ({
      parameter: param as (typeof raw.automation)[0]['parameter'],
      name: `Lane ${idx}`,
      points: [[0, 64]] as [number, number][],
      interpolation: 'linear' as const,
      range: [0, 127] as [number, number],
    }));

    const result = importer.convertToHyphonSong(raw);
    expect((result.song.automation ?? []).length).toBeGreaterThan(0);
    for (const lane of result.song.automation ?? []) {
      assertAutomationParameterValid(lane);
    }
  });

  it('mapping report SynthParams.* targets are real SynthParams keys', () => {
    const importer = new RbsImporter();
    const raw = new RbsParser().generateMockData('x.rbs');
    const result = importer.convertToHyphonSong(raw);

    for (const m of result.report.mappings) {
      if (m.target.startsWith('SynthParams.')) {
        const key = m.target.replace('SynthParams.', '');
        expect(SYNTH_PARAM_KEYS.has(key)).toBe(true);
      }
      if (m.target.startsWith('Bass2Params.')) {
        const key = m.target.replace('Bass2Params.', '');
        expect(BASS2_PARAM_KEYS.has(key)).toBe(true);
      }
    }
  });

  it('imported Note objects match Note interface shape', () => {
    const importer = new RbsImporter();
    const raw = new RbsParser().generateMockData('x.rbs');
    const result = importer.convertToHyphonSong(raw);

    for (const note of collectAllNotes(result.song)) {
      expect(typeof note.note).toBe('string');
      expect(note.note.length).toBeGreaterThan(0);
      expect(typeof note.velocity).toBe('number');
      if (note.length !== undefined) expect(note.length).toBeGreaterThan(0);
    }
  });

  it('drum tuning/decay values stay within DrumKitEngine-acceptable ranges', () => {
    const importer = new RbsImporter({ drumKitMapping: 'auto' });
    const parser = new RbsParser();

    for (const kit of ['808', '909'] as const) {
      const raw = parser.generateMockData('drums.rbs');
      raw.drums.kitType = kit;
      raw.drums.tuning = { kick: -50, snare: 50, closedHat: -50, openHat: 50 };
      raw.drums.decay = { kick: 0, snare: 127, closedHat: 127, openHat: 0 };

      const { kick, snare, closedHat, openHat } = importer.convertToHyphonSong(raw).song.params;

      inRange(kick.pitch, KICK_BOUNDS.pitch);
      inRange(kick.decay, KICK_BOUNDS.decay);
      inRange(kick.tone, KICK_BOUNDS.tone);

      inRange(snare.tone, SNARE_BOUNDS.tone);
      inRange(snare.noise, SNARE_BOUNDS.noise);
      inRange(snare.decay, SNARE_BOUNDS.decay);

      inRange(closedHat.pitch, HAT_BOUNDS.pitch);
      inRange(closedHat.decay, HAT_BOUNDS.decay);
      inRange(openHat.pitch, HAT_BOUNDS.pitch);
      inRange(openHat.decay, HAT_BOUNDS.decay);
    }
  });
});
