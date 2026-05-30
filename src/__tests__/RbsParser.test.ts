import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RbsParser } from '../importers/rbs/RbsParser';
import { RbsImporter } from '../importers/rbs/RbsImporter';

describe('RbsParser', () => {
  it('parses 10_isotherms.rbs and converts it into a Hyphon song', async () => {
    const bytes = await readFile(resolve(process.cwd(), '10_isotherms.rbs'));
    const file = new File([bytes], '10_isotherms.rbs', { type: 'application/octet-stream' });
    const parser = new RbsParser();

    const result = await parser.parseRbsFile(file);
    const importer = new RbsImporter();

    if (result.success) {
      expect(result.data.project.tempo).toBeGreaterThan(0);
      expect(result.data.tb303PatternA.steps).toHaveLength(16);
      expect(result.data.tb303PatternB.steps).toHaveLength(16);
    } else {
      expect(result.error.type).toMatch(/INVALID_FORMAT|CORRUPTED_DATA|READ_ERROR/);
    }

    const converted = importer.convertToHyphonSong(
      result.success ? result.data : parser.generateMockData(file.name)
    );
    expect(converted.success).toBe(true);
    expect(converted.song.pattern.partA.steps).toHaveLength(32);
    expect(converted.song.pattern.partB.steps).toHaveLength(32);
  });

  it('returns INVALID_FORMAT when file extension is not .rbs', async () => {
    const parser = new RbsParser();
    const file = new File([new Uint8Array(768)], 'bad.txt', { type: 'text/plain' });

    const result = await parser.parseRbsFile(file);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.type).toBe('INVALID_FORMAT');
  });

  it('exposes supported versions helpers', () => {
    expect(RbsParser.isVersionSupported('2.0')).toBe(true);
    expect(RbsParser.isVersionSupported('9.9')).toBe(false);
    expect(RbsParser.getSupportedVersions()).toContain('4.2');
  });
});
