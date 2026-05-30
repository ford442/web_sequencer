import { describe, expect, it } from 'vitest';
import { RbsImporter } from '../importers/rbs/RbsImporter';
import type { RawRbsData, Tb303Step } from '../importers/rbs/types';

function makeSteps(): Tb303Step[] {
  return Array.from({ length: 16 }, (_, index) => ({
    index,
    note: index % 4 === 3 ? -1 : index % 12,
    octave: 3,
    accent: index % 4 === 0,
    slide: index % 8 === 0,
    tie: false,
    gate: 80,
  }));
}

function makeRawData(overrides: Partial<RawRbsData> = {}): RawRbsData {
  return {
    version: '2.0',
    project: {
      name: 'fixture',
      author: 'test',
      tempo: 128,
      timeSignatureNum: 4,
      timeSignatureDen: 4,
      swing: 50,
      patternLength: 16,
    },
    tb303PatternA: {
      steps: makeSteps(),
      cutoff: 100,
      resonance: 64,
      envMod: 80,
      decay: 90,
      accent: 96,
      waveform: 0,
      distortion: 0,
      delaySend: 0,
    },
    tb303PatternB: {
      steps: makeSteps(),
      cutoff: 90,
      resonance: 48,
      envMod: 70,
      decay: 70,
      accent: 80,
      waveform: 1,
      distortion: 0,
      delaySend: 0,
      transpose: 0,
    },
    drums: {
      kick: Array(16).fill(false),
      snare: Array(16).fill(false),
      closedHat: Array(16).fill(false),
      openHat: Array(16).fill(false),
      accent: Array(16).fill(0),
      kitType: '808',
      tuning: { kick: 0, snare: 0, closedHat: 0, openHat: 0 },
      decay: { kick: 64, snare: 64, closedHat: 64, openHat: 64 },
    },
    pcf: {
      enabled: true,
      filterType: 'lp',
      cutoff: 100,
      resonance: 64,
      envAmount: 64,
      decay: 64,
      pattern: Array.from({ length: 16 }, (_, i) => (i % 2 === 0 ? 127 : 64)),
      target: { tb303A: true, tb303B: true, drums: true },
    },
    automation: [
      {
        parameter: 'tb303Acutoff',
        name: 'Cutoff A',
        points: [
          [0, 0],
          [0, 127],
          [1.2, 64],
          [40, 10],
        ],
        interpolation: 'linear',
        range: [0, 127],
      },
    ],
    ...overrides,
  };
}

describe('RbsImporter', () => {
  it('converts pattern, PCF and automation lanes', () => {
    const importer = new RbsImporter();
    const result = importer.convertToHyphonSong(makeRawData());

    expect(result.success).toBe(true);
    expect(result.song.pattern.partA.steps).toHaveLength(32);
    expect(result.song.pattern.partB.steps).toHaveLength(32);

    const lanes = result.song.automation ?? [];
    expect(lanes.some((lane) => lane.name === 'PCF → Synth A Filter')).toBe(true);
    expect(lanes.some((lane) => lane.name === 'PCF → Synth B Filter')).toBe(true);
    expect(lanes.some((lane) => lane.name === 'PCF → Drum Filter')).toBe(true);

    const importedCutoffLane = lanes.find((lane) => lane.name === 'Cutoff A');
    expect(importedCutoffLane).toBeDefined();
    expect(importedCutoffLane?.points).toEqual([
      [0, 0],
      [1, expect.closeTo(64 / 127, 5)],
    ]);
  });

  it('stores PCF as pcfFilter when importPcfAsFilter is enabled', () => {
    const importer = new RbsImporter({ importPcfAsFilter: true });
    const result = importer.convertToHyphonSong(makeRawData());

    expect(result.song.pcfFilter).toBeDefined();
    expect(result.song.pcfFilter?.enabled).toBe(true);
    expect(result.song.automation?.some((lane) => lane.name.startsWith('PCF'))).toBe(false);
  });

  it('omits automation when source has no lanes and PCF automation is disabled', () => {
    const importer = new RbsImporter({ convertPcfToAutomation: false });
    const result = importer.convertToHyphonSong(
      makeRawData({
        pcf: {
          enabled: false,
          filterType: 'lp',
          cutoff: 0,
          resonance: 0,
          envAmount: 0,
          decay: 0,
          pattern: Array(16).fill(0),
          target: { tb303A: false, tb303B: false, drums: false },
        },
        automation: [],
      })
    );

    expect(result.song.automation).toBeUndefined();
    expect(result.report.automationLanesConverted).toBe(0);
  });
});
