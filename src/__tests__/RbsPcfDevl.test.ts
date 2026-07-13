import { describe, expect, it } from 'vitest';
import { RbsParser } from '../importers/rbs/RbsParser';
import { RbsImporter } from '../importers/rbs/RbsImporter';
import type { RawRbsData } from '../importers/rbs/types';
import {
  MIXR_PCF_DEVICE_ID,
  pcfWaveToStepPattern,
} from '../importers/rbs/devlLayout';
import {
  buildDevlPcfChunkPayload,
  buildLegacyRbsFile,
  buildSyntheticIffFile,
} from './rbs/fixtures';

const parser = new RbsParser();

function makeRaw(overrides: Partial<RawRbsData> = {}): RawRbsData {
  const base = parser.generateMockData('fixture.rbs');
  return { ...base, ...overrides };
}

describe('DEVL PCF extraction (IFF path)', () => {
  it('parses enabled PCF from DEVL instead of mock sweep', async () => {
    const bytes = buildSyntheticIffFile({
      includeDevl: true,
      pcf: {
        enabled: true,
        cutoff: 68,
        resonance: 55,
        envAmount: 72,
        wave: 25,
        decay: 67,
        filterType: 'lp',
      },
      mixrPcfId: MIXR_PCF_DEVICE_ID.TB303_1,
    });

    const result = await parser.parseBytes(bytes, { filename: 'pcf_devl.rbs' });
    expect(result.success).toBe(true);
    if (!result.success) return;

    const { pcf } = result.data;
    expect(pcf.enabled).toBe(true);
    expect(pcf.cutoff).toBe(68);
    expect(pcf.resonance).toBe(55);
    expect(pcf.envAmount).toBe(72);
    expect(pcf.decay).toBe(67);
    expect(pcf.filterType).toBe('lp');
    expect(pcf.waveIndex).toBe(25);
    expect(pcf.target.tb303A).toBe(true);
    expect(pcf.target.tb303B).toBe(false);

    // Mock PCF uses cutoff 80 and a sine-shaped pattern — DEVL wave 25 differs.
    const mockPattern = Array(16)
      .fill(0)
      .map((_, i) => Math.floor(40 + Math.sin((i * Math.PI) / 8) * 30));
    expect(pcf.pattern).not.toEqual(mockPattern);
    expect(pcf.pattern).toEqual(pcfWaveToStepPattern(25, 72, 68));
  });

  it('returns disabled PCF when DEVL PCF chunk is off', async () => {
    const bytes = buildSyntheticIffFile({
      includeDevl: true,
      pcf: { enabled: false },
    });

    const result = await parser.parseBytes(bytes, { filename: 'pcf_off.rbs' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.pcf.enabled).toBe(false);
    expect(result.data.pcf.pattern.every((v) => v === 0)).toBe(true);
  });

  it('maps MIXR pcf_id to drum routing', async () => {
    const bytes = buildSyntheticIffFile({
      includeDevl: true,
      pcf: { enabled: true, wave: 0 },
      mixrPcfId: MIXR_PCF_DEVICE_ID.TR808,
    });

    const result = await parser.parseBytes(bytes, { filename: 'pcf_drums.rbs' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.pcf.target.drums).toBe(true);
    expect(result.data.pcf.target.tb303A).toBe(false);
  });

  it('copies TB-303 device params into every pattern bank entry', async () => {
    const bytes = buildSyntheticIffFile({
      includeDevl: true,
      tb303ASteps: [],
    });
    // Patch cutoff in the built PCF payload is separate; 303 params come from buildDevl303ChunkPayload defaults.
    const result = await parser.parseBytes(bytes, { filename: '303_params.rbs' });
    expect(result.success).toBe(true);
    if (!result.success || !result.data.songData) return;

    const banks = result.data.songData.patternBanks.tb303A;
    expect(banks.length).toBeGreaterThan(1);
    const firstCutoff = banks[0].cutoff;
    expect(banks[1].cutoff).toBe(firstCutoff);
    expect(banks[0].resonance).toBe(banks[1].resonance);
  });
});

describe('PCF → automation (IFF + importer)', () => {
  it('wave ramp preset produces monotonic filter-cutoff automation', async () => {
    const envAmount = 127;
    const wavePattern = pcfWaveToStepPattern(1, envAmount, 80);

    const bytes = buildSyntheticIffFile({
      includeDevl: true,
      pcf: {
        enabled: true,
        cutoff: 80,
        envAmount,
        wave: 1,
        filterType: 'lp',
      },
      mixrPcfId: MIXR_PCF_DEVICE_ID.TB303_1,
    });

    const parseResult = await parser.parseBytes(bytes, { filename: 'pcf_ramp.rbs' });
    expect(parseResult.success).toBe(true);
    if (!parseResult.success) return;

    expect(parseResult.data.pcf.pattern).toEqual(wavePattern);

    const importer = new RbsImporter({ convertPcfToAutomation: true, expandTo32Steps: false });
    const importResult = importer.convertToHyphonSong(parseResult.data);

    const lane = importResult.song.automation?.find((l) => l.name === 'PCF → Synth A Filter');
    expect(lane).toBeDefined();
    expect(lane!.parameter).toBe('filterCutoff');
    const values = lane!.points.map((p) => p[1]);
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
    }

    expect(importResult.report.pcfStats?.source).toBe('devl');
    expect(importResult.report.pcfStats?.waveIndex).toBe(1);
    expect(importResult.report.pcfStats?.patternVariance).toBeGreaterThan(0);
    expect(importResult.report.pcfStats?.targets).toContain('synthA');
  });
});

describe('legacy fixed-offset PCF (regression)', () => {
  it('still reads 16-step pattern bytes directly from offset 0x2C0', async () => {
    const pcfPattern = Array.from({ length: 16 }, (_, i) => i * 8);
    const bytes = buildLegacyRbsFile({ pcfPattern });

    const result = await parser.parseBytes(bytes, { filename: 'legacy_pcf.rbs' });
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.pcf.enabled).toBe(true);
    expect(result.data.pcf.pattern).toEqual(pcfPattern);
    expect(result.data.pcf.waveIndex).toBeUndefined();
    expect(result.data.songData).toBeUndefined();

    const importer = new RbsImporter({ convertPcfToAutomation: true, expandTo32Steps: false });
    const importResult = importer.convertToHyphonSong(result.data);
    expect(importResult.report.pcfStats?.source).toBe('legacy');

    const lane = importResult.song.automation?.find((l) => l.name === 'PCF → Synth A Filter');
    const values = lane!.points.map((p) => p[1]);
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
    }
  });
});

describe('song mode per-pattern 303 params', () => {
  it('trackParamStorage carries distinct cutoff per pattern slot', () => {
    const raw = makeRaw();
    raw.songData = {
      glob: {
        playMode: 1,
        tempo: 120,
        shuffle: 50,
        loopStart: 0,
        loopEnd: 8,
        vintage: 0,
      },
      patternBanks: {
        tb303A: [],
        tb303B: [],
        drums808: [],
        drums909: [],
      },
      tracks: [],
      totalLengthTicks: 3072,
      totalLengthBars: 4,
      usedPatternCount: 2,
    };

    const pat0 = { ...raw.tb303PatternA, cutoff: 100 };
    const pat1 = { ...raw.tb303PatternA, cutoff: 40, resonance: 20 };
    raw.songData.patternBanks.tb303A = [pat0, pat1];

    const importer = new RbsImporter({ expandTo32Steps: false });
    const importResult = importer.convertToHyphonSong(raw);

    const slots = importResult.song.songArrangement?.trackParamStorage?.synthA;
    expect(slots).toBeDefined();
    expect(slots![0]?.filterCutoff).toBeGreaterThan(slots![1]?.filterCutoff ?? 0);
    expect(slots![0]?.filterResonance).not.toBe(slots![1]?.filterResonance);
  });
});

describe('buildDevlPcfChunkPayload', () => {
  it('encodes RBS42 byte layout', () => {
    const payload = buildDevlPcfChunkPayload({
      enabled: true,
      cutoff: 68,
      resonance: 55,
      envAmount: 72,
      wave: 25,
      decay: 67,
      filterType: 'lp',
    });
    expect(payload[0]).toBe(1);
    expect(payload[1]).toBe(68);
    expect(payload[4]).toBe(25);
    expect(payload[6]).toBe(1);
  });
});
