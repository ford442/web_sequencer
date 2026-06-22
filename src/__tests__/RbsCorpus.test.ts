/**
 * Real-world RBS corpus regression tests (#774).
 *
 * - **Generated corpus** (`test-fixtures/rbs/generated/`): license-clear, runs in CI when committed.
 * - **External corpus** (`RBS_FIXTURE_DIR` or `test-fixtures/rbs/corpus/`): jsynth downloads, opt-in.
 */
import { describe, expect, it } from 'vitest';
import {
  buildCorpusGoldenSummary,
  isExternalCorpusEnabled,
  isGeneratedCorpusEnabled,
  listAvailableCorpusEntries,
  parseAndSummarizeCorpusEntry,
} from './rbs/corpusUtils';

function corpusSuite(kind: 'generated' | 'external', enabled: boolean) {
  const available = enabled ? listAvailableCorpusEntries(kind) : [];

  describe.skipIf(!enabled || available.length === 0)(
    `RBS ${kind} corpus (#774)`,
    () => {
      for (const entry of available) {
        describe(entry.label, () => {
          it(`parses ${entry.file} without mock fallback`, async () => {
            const outcome = await parseAndSummarizeCorpusEntry(entry);
            expect(outcome).not.toBeNull();
            if (!outcome || !('result' in outcome) || !outcome.result.success) {
              expect.fail(`parse failed for ${entry.file}: ${JSON.stringify(outcome)}`);
            }

            expect(outcome.result.data.songData).toBeDefined();
            expect(outcome.converted!.success).toBe(true);
            expect(outcome.converted!.song.pattern.partA.steps).toHaveLength(32);
          });

          it(`matches golden summary for ${entry.file}`, async () => {
            const outcome = await parseAndSummarizeCorpusEntry(entry);
            expect(outcome).not.toBeNull();
            if (!outcome || !('summary' in outcome) || !outcome.summary) return;

            const golden = buildCorpusGoldenSummary(outcome.summary);
            expect(golden.hasSongData).toBe(true);
            expect(golden.tempo).toBeGreaterThan(0);
            expect(golden.tb303APatternCount).toBeGreaterThanOrEqual(
              entry.expect.minTb303APatterns ?? 1,
            );

            await expect(golden).toMatchFileSnapshot(
              `./__snapshots__/rbs-corpus/${entry.file}.json`,
            );
          });
        });
      }
    },
  );
}

corpusSuite('generated', isGeneratedCorpusEnabled());
corpusSuite('external', isExternalCorpusEnabled());

describe('RBS corpus harness (always on)', () => {
  it('rejects Standard MIDI masquerading as .rbs', async () => {
    const { readFileSync, existsSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const midPath = resolve(process.cwd(), 'test-fixtures/10_isotherms.mid');
    if (!existsSync(midPath)) return;

    const { parseCorpusFile } = await import('./rbs/corpusUtils');
    const result = await parseCorpusFile(midPath);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(['INVALID_FORMAT', 'CORRUPTED_DATA']).toContain(result.error.type);
  });
});
