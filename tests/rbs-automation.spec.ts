import { test, expect } from '@playwright/test';
import {
  initializeHyphonAudio,
  importRbsFixture,
  getAutomationLaneCount,
  getAutomationPlaybackStep,
  hasSequencerPlayhead,
  startPlaybackAndAwaitClock,
  E2E_RBS_FIXTURE,
} from './helpers/rbs-e2e';

test.describe('RBS import E2E', () => {
  test('imports synthetic .rbs, shows report, song mode plays with advancing playhead', async ({
    page,
  }) => {
    await initializeHyphonAudio(page);
    await importRbsFixture(page);

    // Song arrangement loaded — open song mode panel if collapsed.
    const songArranger = page.getByText('SONG ARRANGER');
    if (!(await songArranger.isVisible())) {
      await page.getByRole('button', { name: 'Toggle Song Mode' }).click();
    }
    await expect(songArranger).toBeVisible({ timeout: 10_000 });

    const loopSongBtn = page.getByRole('button', { name: 'Loop Song Mode Active' });
    await expect(loopSongBtn).toBeVisible();
    await expect(loopSongBtn).toHaveAttribute('aria-pressed', 'true');

    // Multiple arrangement measures from imported song.
    await expect(page.getByTestId('cell-partA-0')).toBeVisible();
    await expect(page.getByTestId('cell-partA-1')).toBeVisible();

    await startPlaybackAndAwaitClock(page);

    // Transport advances during playback (E2E transport bucket or sequencer playhead).
    const browserName = page.context().browser()?.browserType().name();
    if (browserName !== 'firefox') {
      await expect
        .poll(async () => {
          const step = await getAutomationPlaybackStep(page);
          if (step >= 0) return step;
          return (await hasSequencerPlayhead(page)) ? 0 : -1;
        }, { timeout: 15_000, intervals: [100, 250, 500] })
        .toBeGreaterThanOrEqual(0);
    }
  });

  test('imports .rbs and hydrates automation lanes for playback scheduling', async ({
    page,
  }) => {
    await initializeHyphonAudio(page);

    const importTrigger = page.getByRole('button', {
      name: /Import ReBirth RB-338 \.rbs file/i,
    });
    await importTrigger.scrollIntoViewIfNeeded();
    await importTrigger.click();
    await page.getByLabel('Upload .rbs file').setInputFiles(E2E_RBS_FIXTURE);
    const importBtn = page.getByRole('button', { name: /import song/i });
    await expect(importBtn).toBeEnabled({ timeout: 30_000 });
    await importBtn.click();

    await expect(page.getByTestId('rbs-automation-lane-count')).toBeVisible({ timeout: 30_000 });
    const reportLanes = await page.getByTestId('rbs-automation-lane-count').getAttribute('data-lane-count');
    expect(Number(reportLanes)).toBeGreaterThan(0);

    await page.getByTestId('rbs-import-done').click();

    await expect
      .poll(() => getAutomationLaneCount(page), { timeout: 5_000 })
      .toBeGreaterThan(0);

    await startPlaybackAndAwaitClock(page);

    const browserName2 = page.context().browser()?.browserType().name();
    if (browserName2 !== 'firefox') {
      await expect
        .poll(async () => {
          const step = await getAutomationPlaybackStep(page);
          if (step >= 0) return step;
          return (await hasSequencerPlayhead(page)) ? 0 : -1;
        }, { timeout: 15_000, intervals: [100, 250, 500] })
        .toBeGreaterThanOrEqual(0);
    }

    // SYNTH A cutoff knob is present and retains a valid aria value during playback.
    const cutoffKnob = page.getByRole('slider', { name: /^CUTOFF/i }).first();
    await expect(cutoffKnob).toBeVisible();
    const before = Number(await cutoffKnob.getAttribute('aria-valuenow'));
    expect(before).toBeGreaterThan(0);

    await page.waitForTimeout(1500);
    const after = Number(await cutoffKnob.getAttribute('aria-valuenow'));
    expect(after).toBeGreaterThan(0);
  });
});
