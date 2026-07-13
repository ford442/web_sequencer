/**
 * Property-based tests: parse() never throws on arbitrary input.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { RbsParser } from '../importers/rbs/RbsParser';
import {
  classifyParserError,
  RBS_ERROR_CODES,
  type RbsParserError,
} from '../importers/rbs/parser-types';
import {
  buildLegacyRbsFile,
  buildSyntheticIffFile,
} from './rbs/fixtures';

const parser = new RbsParser();

const KNOWN_ERROR_TYPES: RbsParserError['type'][] = [
  'INVALID_FORMAT',
  'UNSUPPORTED_VERSION',
  'CORRUPTED_DATA',
  'READ_ERROR',
];

async function parseBytesSafe(bytes: Uint8Array) {
  return parser.parseBytes(bytes, { filename: 'prop.rbs', requireExtension: false });
}

describe('RbsParser property tests', () => {
  it('parseBytes never throws on arbitrary bytes', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ minLength: 0, maxLength: 4096 }), async (bytes) => {
        const result = await parseBytesSafe(bytes);
        expect(result).toBeDefined();
        if (result.success) {
          expect(result.data.version).toBeTruthy();
          expect(result.data.tb303PatternA.steps).toHaveLength(16);
        } else {
          expect(KNOWN_ERROR_TYPES).toContain(result.error.type);
          expect(RBS_ERROR_CODES).toContain(classifyParserError(result.error));
        }
      }),
      { numRuns: 80 }
    );
  });

  it('valid legacy file round-trips tempo, swing, patternLength, kit', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          tempo: fc.integer({ min: 40, max: 250 }),
          swing: fc.integer({ min: 0, max: 100 }),
          patternLength: fc.constantFrom(16 as const, 32 as const),
          kitType: fc.constantFrom('808' as const, '909' as const),
        }),
        async (cfg) => {
          const bytes = buildLegacyRbsFile({
            tempo: cfg.tempo,
            swing: cfg.swing,
            patternLength: cfg.patternLength,
            kitType: cfg.kitType,
          });
          const result = await parseBytesSafe(bytes);
          expect(result.success).toBe(true);
          if (!result.success) return;
          expect(result.data.project.tempo).toBe(cfg.tempo);
          expect(result.data.project.swing).toBe(cfg.swing);
          expect(result.data.project.patternLength).toBe(cfg.patternLength);
          expect(result.data.drums.kitType).toBe(cfg.kitType);
          expect(result.data.tb303PatternA.steps).toHaveLength(16);
          expect(result.data.tb303PatternB.steps).toHaveLength(16);
        }
      ),
      { numRuns: 40 }
    );
  });

  it('valid IFF file round-trips GLOB tempo and play mode', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          playMode: fc.constantFrom(0 as const, 1 as const),
          tempo: fc.integer({ min: 40_000, max: 250_000 }),
          shuffle: fc.integer({ min: 0, max: 127 }),
        }),
        async (cfg) => {
          const bytes = buildSyntheticIffFile({
            playMode: cfg.playMode,
            tempo: cfg.tempo,
            shuffle: cfg.shuffle,
            trakEvents: [{ delta: 0, ctrl: 0x01, value: 0 }],
          });
          const result = await parseBytesSafe(bytes);
          expect(result.success).toBe(true);
          if (!result.success) return;
          expect(result.data.songData).toBeDefined();
          expect(result.data.songData!.glob.playMode).toBe(cfg.playMode);
          expect(result.data.songData!.glob.tempo).toBeCloseTo(cfg.tempo / 1000, 0);
          expect(result.data.songData!.glob.shuffle).toBe(cfg.shuffle);
        }
      ),
      { numRuns: 40 }
    );
  });
});
