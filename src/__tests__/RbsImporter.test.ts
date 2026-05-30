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

  it('omits automation when source has no lanes, PCF automation is disabled, and no accent/slide steps', () => {
    const importer = new RbsImporter({ convertPcfToAutomation: false });
    const noAccentSlideSteps = Array.from({ length: 16 }, (_, i) => ({
      index: i,
      note: i % 12,
      octave: 3,
      accent: false,
      slide: false,
      tie: false,
      gate: 80,
    }));
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
        tb303PatternA: { ...makeRawData().tb303PatternA, steps: noAccentSlideSteps },
        tb303PatternB: { ...makeRawData().tb303PatternB, steps: noAccentSlideSteps },
      })
    );

    expect(result.song.automation).toBeUndefined();
    expect(result.report.automationLanesConverted).toBe(0);
  });

  it('maps additional automation parameters (resonance, decay, pcfResonance, pcfEnvAmount)', () => {
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
        automation: [
          {
            parameter: 'tb303Aresonance',
            name: 'Resonance A',
            points: [[0, 64], [8, 127]],
            interpolation: 'step',
            range: [0, 127],
          },
          {
            parameter: 'tb303Bresonance',
            name: 'Resonance B',
            points: [[0, 32]],
            interpolation: 'step',
            range: [0, 127],
          },
          {
            parameter: 'tb303Adecay',
            name: 'Decay A',
            points: [[0, 80]],
            interpolation: 'step',
            range: [0, 127],
          },
          {
            parameter: 'tb303Bdecay',
            name: 'Decay B',
            points: [[0, 60]],
            interpolation: 'step',
            range: [0, 127],
          },
          {
            parameter: 'pcfResonance',
            name: 'PCF Res',
            points: [[0, 100]],
            interpolation: 'step',
            range: [0, 127],
          },
          {
            parameter: 'pcfEnvAmount',
            name: 'PCF Env',
            points: [[0, 50]],
            interpolation: 'step',
            range: [0, 127],
          },
        ],
      })
    );

    const lanes = result.song.automation ?? [];

    const resA = lanes.find((l) => l.name === 'Resonance A');
    expect(resA).toBeDefined();
    expect(resA?.target).toBe('synthA');
    expect(resA?.parameter).toBe('filterResonance');

    const resB = lanes.find((l) => l.name === 'Resonance B');
    expect(resB).toBeDefined();
    expect(resB?.target).toBe('synthB');
    expect(resB?.parameter).toBe('filterResonance');

    const decayA = lanes.find((l) => l.name === 'Decay A');
    expect(decayA).toBeDefined();
    expect(decayA?.target).toBe('synthA');
    expect(decayA?.parameter).toBe('decay');

    const decayB = lanes.find((l) => l.name === 'Decay B');
    expect(decayB).toBeDefined();
    expect(decayB?.target).toBe('synthB');
    expect(decayB?.parameter).toBe('decay');

    const pcfRes = lanes.find((l) => l.name === 'PCF Res');
    expect(pcfRes).toBeDefined();
    expect(pcfRes?.target).toBe('master');
    expect(pcfRes?.parameter).toBe('pcfResonance');

    const pcfEnv = lanes.find((l) => l.name === 'PCF Env');
    expect(pcfEnv).toBeDefined();
    expect(pcfEnv?.target).toBe('master');
    expect(pcfEnv?.parameter).toBe('pcfEnvAmount');
  });

  it('normalizes slideTime in Bass2Params (default ≈ 0.33 when not provided)', () => {
    const importer = new RbsImporter({ tb303BTarget: 'bass2' });
    const result = importer.convertToHyphonSong(makeRawData());

    expect(result.success).toBe(true);
    const bass2 = result.song.params.bass2;
    expect(bass2).toBeDefined();
    // Default raw slideTime = 42; 42/127 ≈ 0.3307
    expect(bass2?.slideTime).toBeCloseTo(42 / 127, 3);
  });

  it('normalizes an explicit slideTime value from TB-303 pattern', () => {
    const importer = new RbsImporter({ tb303BTarget: 'bass2' });
    const result = importer.convertToHyphonSong(
      makeRawData({
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
          slideTime: 63,
        },
      })
    );

    const bass2 = result.song.params.bass2;
    expect(bass2).toBeDefined();
    expect(bass2?.slideTime).toBeCloseTo(63 / 127, 3);
  });

  it('maps envMod as normalized filterMode (0-1) in SynthParams', () => {
    const importer = new RbsImporter();
    const result = importer.convertToHyphonSong(makeRawData());

    expect(result.success).toBe(true);
    // envMod = 80 for tb303PatternA → filterMode = 80/127 ≈ 0.630
    expect(result.song.params.synthA?.filterMode).toBeCloseTo(80 / 127, 3);
  });

  it('maps portamento (slideTime) into SynthParams', () => {
    const importer = new RbsImporter();
    const result = importer.convertToHyphonSong(
      makeRawData({
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
          slideTime: 42,
        },
      })
    );

    expect(result.song.params.synthA?.portamento).toBeCloseTo(42 / 127, 3);
  });
});

// =============================================================================
// Per-step accent and slide automation lane generation
// =============================================================================

describe('RbsImporter – per-step accent/slide automation lanes', () => {
  it('generates an accent automation lane for synthA when steps have accent', () => {
    const importer = new RbsImporter({ expandTo32Steps: false });
    const result = importer.convertToHyphonSong(makeRawData());
    expect(result.success).toBe(true);

    const accentLane = result.song.automation?.find(
      (l) => l.target === 'synthA' && l.parameter === 'accent'
    );
    expect(accentLane).toBeDefined();
    expect(accentLane?.interpolation).toBe('step');
    // makeSteps() produces 16 steps → 16 points (expandTo32Steps=false)
    expect(accentLane?.points).toHaveLength(16);
  });

  it('generates a slide automation lane for synthA when steps have slide', () => {
    const importer = new RbsImporter({ expandTo32Steps: false });
    const result = importer.convertToHyphonSong(makeRawData());
    expect(result.success).toBe(true);

    const slideLane = result.song.automation?.find(
      (l) => l.target === 'synthA' && l.parameter === 'slide'
    );
    expect(slideLane).toBeDefined();
    expect(slideLane?.interpolation).toBe('step');
    expect(slideLane?.points).toHaveLength(16);
  });

  it('sets accent lane value to 1.0 on accented steps and baseAccentNorm elsewhere', () => {
    // makeSteps(): accent at indices 0, 4, 8, 12
    // tb303PatternA.accent = 96 → baseAccentNorm = 96/127 ≈ 0.756
    const importer = new RbsImporter({ expandTo32Steps: false });
    const result = importer.convertToHyphonSong(makeRawData());

    const accentLane = result.song.automation?.find(
      (l) => l.target === 'synthA' && l.parameter === 'accent'
    );
    expect(accentLane).toBeDefined();
    const pts = accentLane!.points;
    // Step 0: accented → 1.0
    expect(pts[0][1]).toBeCloseTo(1.0, 5);
    // Step 1: not accented → 96/127
    expect(pts[1][1]).toBeCloseTo(96 / 127, 5);
    // Step 4: accented → 1.0
    expect(pts[4][1]).toBeCloseTo(1.0, 5);
  });

  it('sets slide lane value to 1.0 on slide steps and 0.0 elsewhere', () => {
    // makeSteps(): slide at indices 0, 8
    const importer = new RbsImporter({ expandTo32Steps: false });
    const result = importer.convertToHyphonSong(makeRawData());

    const slideLane = result.song.automation?.find(
      (l) => l.target === 'synthA' && l.parameter === 'slide'
    );
    expect(slideLane).toBeDefined();
    const pts = slideLane!.points;
    expect(pts[0][1]).toBeCloseTo(1.0, 5);  // step 0: slide active
    expect(pts[1][1]).toBeCloseTo(0.0, 5);  // step 1: no slide
    expect(pts[8][1]).toBeCloseTo(1.0, 5);  // step 8: slide active
    expect(pts[7][1]).toBeCloseTo(0.0, 5);  // step 7: no slide
  });

  it('expands accent/slide lanes to 32 steps when expandTo32Steps is true', () => {
    const importer = new RbsImporter({ expandTo32Steps: true });
    const result = importer.convertToHyphonSong(makeRawData());

    const accentLane = result.song.automation?.find(
      (l) => l.target === 'synthA' && l.parameter === 'accent'
    );
    expect(accentLane?.points).toHaveLength(32);

    const slideLane = result.song.automation?.find(
      (l) => l.target === 'synthA' && l.parameter === 'slide'
    );
    expect(slideLane?.points).toHaveLength(32);
  });

  it('does not generate an accent lane when no steps are accented', () => {
    const steps: Tb303Step[] = Array.from({ length: 16 }, (_, i) => ({
      index: i,
      note: i % 12,
      octave: 3,
      accent: false,
      slide: true,
      tie: false,
      gate: 80,
    }));
    const raw = makeRawData({
      tb303PatternA: { ...makeRawData().tb303PatternA, steps },
    });
    const importer = new RbsImporter({ expandTo32Steps: false });
    const result = importer.convertToHyphonSong(raw);

    const accentLane = result.song.automation?.find(
      (l) => l.target === 'synthA' && l.parameter === 'accent'
    );
    expect(accentLane).toBeUndefined();
  });

  it('does not generate a slide lane when no steps have slide', () => {
    const steps: Tb303Step[] = Array.from({ length: 16 }, (_, i) => ({
      index: i,
      note: i % 12,
      octave: 3,
      accent: true,
      slide: false,
      tie: false,
      gate: 80,
    }));
    const raw = makeRawData({
      tb303PatternA: { ...makeRawData().tb303PatternA, steps },
    });
    const importer = new RbsImporter({ expandTo32Steps: false });
    const result = importer.convertToHyphonSong(raw);

    const slideLane = result.song.automation?.find(
      (l) => l.target === 'synthA' && l.parameter === 'slide'
    );
    expect(slideLane).toBeUndefined();
  });

  it('generates lanes for synthB (tb303PatternB) as well', () => {
    const importer = new RbsImporter({ expandTo32Steps: false });
    const result = importer.convertToHyphonSong(makeRawData());

    const accentB = result.song.automation?.find(
      (l) => l.target === 'bass2' && l.parameter === 'accent'
    );
    // Default tb303BTarget is 'bass2', so the lane target should be 'bass2'
    expect(accentB).toBeDefined();
    expect(accentB?.name).toContain('Bass 2');
  });

  it('uses synthB target when tb303BTarget is partB', () => {
    const importer = new RbsImporter({ tb303BTarget: 'partB', expandTo32Steps: false });
    const result = importer.convertToHyphonSong(makeRawData());

    const accentB = result.song.automation?.find(
      (l) => l.target === 'synthB' && l.parameter === 'accent'
    );
    expect(accentB).toBeDefined();
    expect(accentB?.name).toContain('TB-303 B');
  });
});
