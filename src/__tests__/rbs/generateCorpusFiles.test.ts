/**
 * One-shot generator for committed license-clear corpus files.
 * Run: GENERATE_RBS_CORPUS=1 pnpm exec vitest run src/__tests__/rbs/generateCorpusFiles.test.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSyntheticIffFile } from './fixtures';

const OUT = resolve(process.cwd(), 'test-fixtures/rbs/generated');

describe.skipIf(!process.env.GENERATE_RBS_CORPUS)('generate RBS corpus files', () => {
  it('writes struct-accurate fixtures to test-fixtures/rbs/generated/', () => {
    mkdirSync(OUT, { recursive: true });

    const tb303ASteps = Array.from({ length: 16 }, (_, index) => ({
      index,
      note: index % 4 === 3 ? -1 : index % 12,
      octave: 3,
      accent: index % 4 === 0,
      slide: index % 8 === 0,
      tie: false,
    }));

    const specs = [
      {
        name: 'generated_v20_song_arrangement.rbs',
        bytes: buildSyntheticIffFile({
          playMode: 1,
          tempo: 128_000,
          includeDevl: true,
          tb303ASteps,
          trakEvents: [
            { delta: 0, ctrl: 0x01, value: 0 },
            { delta: 768, ctrl: 0x01, value: 1 },
            { delta: 768, ctrl: 0x01, value: 2 },
            { delta: 768, ctrl: 0x01, value: 0 },
          ],
        }),
      },
      {
        name: 'generated_v20_song_multi_pattern.rbs',
        bytes: buildSyntheticIffFile({
          playMode: 1,
          tempo: 135_000,
          includeDevl: true,
          tb303ASteps,
          trakEvents: [
            { delta: 0, ctrl: 0x01, value: 0 },
            { delta: 768, ctrl: 0x01, value: 1 },
            { delta: 768, ctrl: 0x01, value: 2 },
            { delta: 768, ctrl: 0x01, value: 3 },
            { delta: 768, ctrl: 0x01, value: 0 },
          ],
        }),
      },
      {
        name: 'generated_v20_pattern_mode.rbs',
        bytes: buildSyntheticIffFile({
          playMode: 0,
          tempo: 120_000,
          includeDevl: true,
          tb303ASteps,
          trakEvents: [],
        }),
      },
      {
        name: 'generated_v15_single_303.rbs',
        bytes: buildSyntheticIffFile({
          playMode: 0,
          tempo: 118_000,
          headVersionString: 'ReBirth RB-338 v1.5',
          includeDevl: true,
          include303B: false,
          tb303ASteps,
          trakEvents: [],
        }),
      },
    ];

    for (const { name, bytes } of specs) {
      writeFileSync(resolve(OUT, name), bytes);
      expect(bytes.byteLength).toBeGreaterThan(1000);
    }
  });
});
