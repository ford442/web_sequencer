import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { RbsParser } from '../importers/rbs/RbsParser';
import { classifyParserError } from '../importers/rbs/parser-types';

describe('RbsParser', () => {
  it('rejects Standard MIDI content with .rbs extension (no mock fallback)', async () => {
    const midPath = resolve(process.cwd(), 'test-fixtures/10_isotherms.mid');
    if (!existsSync(midPath)) {
      // Fixture optional in minimal checkouts
      return;
    }

    const bytes = readFileSync(midPath);
    const parser = new RbsParser();
    const result = await parser.parseBytes(bytes, { filename: '10_isotherms.rbs', requireExtension: true });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(['INVALID_FORMAT', 'CORRUPTED_DATA']).toContain(result.error.type);
    expect(classifyParserError(result.error)).not.toBe('RBS_ERROR_READ_ERROR');
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
    expect(RbsParser.isVersionSupported('1.5')).toBe(true);
    expect(RbsParser.isVersionSupported('9.9')).toBe(false);
    expect(RbsParser.getSupportedVersions()).toContain('4.2');
    expect(RbsParser.getSupportedVersions()).toContain('1.5');
  });
});
