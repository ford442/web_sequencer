/**
 * Golden snapshot on independently-verified mapped import output.
 */
import { describe, expect, it } from 'vitest';
import { RbsParser } from '../importers/rbs/RbsParser';
import { RbsImporter } from '../importers/rbs/RbsImporter';
import {
  buildLegacyRbsFile,
  buildImportSnapshotSummary,
} from './rbs/fixtures';

describe('RbsImporter golden snapshot', () => {
  it('matches mapped output summary for synthesized legacy file', async () => {
    const tempo = 140;
    const kitType = '808' as const;
    const bytes = buildLegacyRbsFile({
      tempo,
      kitType,
      songName: 'SnapshotSong',
      pcfPattern: [0, 32, 64, 96, 127, 96, 64, 32, 0, 32, 64, 96, 127, 96, 64, 32],
    });

    const parsed = await new RbsParser().parseBytes(bytes, { filename: 'snap.rbs', requireExtension: false });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    expect(parsed.data.project.tempo).toBe(tempo);
    expect(parsed.data.drums.kitType).toBe(kitType);

    const imported = new RbsImporter({ expandTo32Steps: true }).convertToHyphonSong(parsed.data);
    const summary = buildImportSnapshotSummary(imported.song);

    // Independent invariants before snapshot
    expect(summary.tempo).toBe(140);
    expect(summary.drumKit).toBe('808');
    expect(summary.patternStepCounts.partA).toBe(32);
    expect(summary.kickPitch).toBeGreaterThanOrEqual(40);
    expect(summary.kickPitch).toBeLessThanOrEqual(80);
    expect(summary.automationLaneNames.length).toBeGreaterThan(0);

    await expect(summary).toMatchFileSnapshot('./__snapshots__/rbs-import-summary.json');
  });
});
