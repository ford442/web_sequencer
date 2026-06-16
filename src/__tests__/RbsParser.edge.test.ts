/**
 * Targeted binary edge-case tests for RbsParser.
 */
import { describe, expect, it } from 'vitest';
import { RbsParser } from '../importers/rbs/RbsParser';
import { classifyParserError } from '../importers/rbs/parser-types';
import {
  buildLegacyRbsFile,
  buildSyntheticIffFile,
  buildTruncatedIffFile,
  buildWrongFormTypeIffFile,
  writeAscii,
  writeU32BE,
} from './rbs/fixtures';

const parser = new RbsParser();

async function parse(bytes: Uint8Array, name = 'edge.rbs') {
  return parser.parseBytes(bytes, { filename: name, requireExtension: false });
}

describe('RbsParser binary edge cases', () => {
  it('returns INVALID_EXTENSION when extension check is required', async () => {
    const result = await parser.parseBytes(new Uint8Array(0x400), {
      filename: 'bad.bin',
      requireExtension: true,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(classifyParserError(result.error)).toBe('RBS_ERROR_INVALID_EXTENSION');
  });

  it('rejects file smaller than MIN_FILE_SIZE', async () => {
    const result = await parse(new Uint8Array(100));
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(classifyParserError(result.error)).toBe('RBS_ERROR_FILE_TOO_SMALL');
  });

  it('rejects legacy file with bad magic bytes', async () => {
    const bytes = buildLegacyRbsFile();
    bytes.set(writeAscii('NOPE', 4), 0);
    const result = await parse(bytes);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.type).toBe('INVALID_FORMAT');
    expect(classifyParserError(result.error)).toBe('RBS_ERROR_UNKNOWN_FORMAT');
  });

  it('detects truncated IFF chunk (length past EOF)', async () => {
    const bytes = buildTruncatedIffFile();
    const result = await parse(bytes);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(classifyParserError(result.error)).toBe('RBS_ERROR_TRUNCATED_CHUNK');
  });

  it('skips unknown IFF chunk by length without crashing', async () => {
    const unknownPayload = new Uint8Array([1, 2, 3]); // odd length → pad byte
    const bytes = buildSyntheticIffFile({
      extraChunks: [{ id: 'ZZZZ', payload: unknownPayload }],
      trakEvents: [{ delta: 0, ctrl: 0, value: 0 }],
    });
    const result = await parse(bytes);
    expect(result.success).toBe(true);
  });

  it('handles zero-length IFF chunk', async () => {
    const bytes = buildSyntheticIffFile({
      extraChunks: [{ id: 'EMPT', payload: new Uint8Array(0) }],
      trakEvents: [{ delta: 0, ctrl: 0, value: 0 }],
    });
    const result = await parse(bytes);
    expect(result.success).toBe(true);
  });

  it('consumes odd-length chunk pad byte correctly', async () => {
    const payload = new Uint8Array([0x42]); // 1 byte → 1 pad
    const bytes = buildSyntheticIffFile({
      extraChunks: [{ id: 'ODD1', payload }],
      trakEvents: [{ delta: 0, ctrl: 0, value: 0 }],
    });
    const result = await parse(bytes);
    expect(result.success).toBe(true);
  });

  it('parses IFF with alternate form type when HEAD chunk is still present', async () => {
    const bytes = buildWrongFormTypeIffFile();
    const result = await parse(bytes);
    // Form type "XXXX" is logged but HEAD/GLOB/TRKL still parse — must not throw.
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data?.songData).toBeDefined();
    }
  });

  it('handles chunk length 0xFFFFFFFF without throwing (safe int clamp)', async () => {
    const file = buildSyntheticIffFile({ trakEvents: [{ delta: 0, ctrl: 0, value: 0 }] });
    // Corrupt first chunk size after HEAD to huge value
    const headOff = 12; // after CAT + size + RB40
    file.set(writeU32BE(0xffffffff), headOff + 4);
    const result = await parse(file);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(['RBS_ERROR_TRUNCATED_CHUNK', 'RBS_ERROR_UNKNOWN_FORMAT', 'RBS_ERROR_CORRUPTED_DATA'])
      .toContain(classifyParserError(result.error));
  });

  it('parses legacy file with NaN/Infinity tempo byte without throwing', async () => {
    const bytes = buildLegacyRbsFile({ tempo: 255 });
    const result = await parse(bytes);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.project.tempo).toBe(255);
  });

  it('truncated legacy header returns error or partial read without throw', async () => {
    const bytes = buildLegacyRbsFile().slice(0, 0x200);
    const result = await parse(bytes);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(classifyParserError(result.error)).toBe('RBS_ERROR_FILE_TOO_SMALL');
  });

  it('nested CAT DEVL/TRKL does not recurse infinitely', async () => {
    // Minimal nested CAT inside extra chunk — parser walks one level only
    const innerCat = new Uint8Array(20);
    innerCat.set(writeAscii('CAT ', 4), 0);
    innerCat.set(writeU32BE(4), 4);
    innerCat.set(writeAscii('DEVL', 4), 8);
    const bytes = buildSyntheticIffFile({
      extraChunks: [{ id: 'CAT ', payload: innerCat.slice(4) }],
      trakEvents: [{ delta: 0, ctrl: 0, value: 0 }],
    });
    const result = await parse(bytes);
    expect(result.success).toBe(true);
  });
});
