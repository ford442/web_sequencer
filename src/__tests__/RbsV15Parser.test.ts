/**
 * ReBirth v1.5 subset import tests (#778).
 */
import { describe, expect, it } from 'vitest';
import { RbsParser } from '../importers/rbs/RbsParser';
import { RbsImporter } from '../importers/rbs/RbsImporter';
import { classifyParserError } from '../importers/rbs/parser-types';
import {
  buildLegacyV15RbsFile,
  buildSyntheticIffFile,
} from './rbs/fixtures';

const MOCK_TB303_A_NOTES = [0, 0, 7, 7, 9, 9, 7, -1, 5, 5, 4, 4, 2, 2, 0, -1];

describe('RbsParser v1.5 subset', () => {
  it('parses legacy v1.5 fixture without mock 303-B melody', async () => {
    const bytes = buildLegacyV15RbsFile({
      tb303ASteps: [{ index: 0, note: 5, octave: 3, accent: true, slide: false, tie: false }],
    });
    const parser = new RbsParser();
    const result = await parser.parseBytes(bytes, { filename: 'legacy_v15.rbs' });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.version).toBe('1.5');
    expect(result.data.parsePath).toBe('legacy');
    expect(result.data.devicesPresent).toContain('303-1');
    expect(result.data.devicesPresent).not.toContain('303-2');
    expect(result.data.devicesPresent).toContain('808');
    expect(result.data.devicesPresent).not.toContain('909');

    const partBNotes = result.data.tb303PatternB.steps.map((s) => s.note);
    expect(partBNotes).not.toEqual(MOCK_TB303_A_NOTES);
    expect(partBNotes.every((n) => n < 0)).toBe(true);
  });

  it('parses IFF v1.5 HEAD signature with single 303 DEVL bank', async () => {
    const bytes = buildSyntheticIffFile({
      headVersionString: 'ReBirth RB-338 v1.5',
      includeDevl: true,
      include303B: false,
      tb303ASteps: [{ index: 0, note: 3, octave: 3, accent: false, slide: false, tie: false }],
    });

    const parser = new RbsParser();
    const result = await parser.parseBytes(bytes, { filename: 'iff_v15.rbs' });
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.version).toBe('1.5');
    expect(result.data.parsePath).toBe('iff');
    expect(result.data.songData!.patternBanks.tb303B.length).toBe(0);
    expect(result.data.devicesPresent).toEqual(expect.arrayContaining(['303-1', '808']));
    expect(result.data.devicesPresent).not.toContain('303-2');
  });

  it('returns RBS_ERROR_UNSUPPORTED_VERSION for unknown format version', async () => {
    const bytes = buildLegacyV15RbsFile();
    bytes[0x09] = 9; // version 1.9

    const parser = new RbsParser();
    const result = await parser.parseBytes(bytes, { filename: 'bad_ver.rbs' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.type).toBe('UNSUPPORTED_VERSION');
    expect(classifyParserError(result.error)).toBe('RBS_ERROR_UNSUPPORTED_VERSION');
    if (result.error.type === 'UNSUPPORTED_VERSION') {
      expect(result.error.supported).toContain('1.5');
      expect(result.error.version).toBe('1.9');
    }
  });
});

describe('RbsImporter v1.5 subset', () => {
  it('uses TR-808 kit when only 808 data is present (auto mapping)', async () => {
    const bytes = buildLegacyV15RbsFile();
    const parser = new RbsParser();
    const parseResult = await parser.parseBytes(bytes, { filename: 'v15_kit.rbs' });
    expect(parseResult.success).toBe(true);
    if (!parseResult.success) return;

    const importer = new RbsImporter({ drumKitMapping: 'auto' });
    const { song, report } = importer.convertToHyphonSong(parseResult.data);

    expect(song.params.drumKit).toBe('808');
    expect(report.formatVersion).toBe('1.5');
    expect(report.devicesPresent).toContain('808');
    expect(report.devicesPresent).not.toContain('909');
    expect(report.warnings.some((w) => w.includes('909'))).toBe(true);
    expect(report.parsePath).toBe('legacy');

    const partBTriggers = song.pattern.partB.steps.filter((s) => s !== null).length;
    expect(partBTriggers).toBe(0);
  });
});

describe('v2.0 regression', () => {
  it('IFF v2.0 synthetic file still parses with both 303 devices when present', async () => {
    const bytes = buildSyntheticIffFile({ includeDevl: true, include303B: true });
    const parser = new RbsParser();
    const result = await parser.parseBytes(bytes, { filename: 'v20.rbs' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.version).toBe('2.0');
    expect(result.data.songData!.patternBanks.tb303A.length).toBeGreaterThan(0);
    expect(result.data.songData!.patternBanks.tb303B.length).toBeGreaterThan(0);
  });
});
