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
    await expect
      .poll(async () => {
        const step = await getAutomationPlaybackStep(page);
        if (step >= 0) return step;
        return (await hasSequencerPlayhead(page)) ? 0 : -1;
      }, { timeout: 15_000, intervals: [100, 250, 500] })
      .toBeGreaterThanOrEqual(0);
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

    await expect
      .poll(async () => {
        const step = await getAutomationPlaybackStep(page);
        if (step >= 0) return step;
        return (await hasSequencerPlayhead(page)) ? 0 : -1;
      }, { timeout: 15_000, intervals: [100, 250, 500] })
      .toBeGreaterThanOrEqual(0);

    // SYNTH A cutoff knob is present, reports a valid aria value, and moves with
    // its lane during playback.
    //
    // Why not "> 0": since #1522 KnobOverlay reports the *automated* lane value
    // in aria-valuenow while a lane drives the knob. The fixture's PCF pattern is
    // [0, 4, 8, …, 60] on TB-303 A, which the importer turns into a
    // synthA.filterCutoff lane that starts every bar at exactly 0 (0 → 0.081 over
    // 16 steps), so the attribute legitimately reads 0 on step 0 — that is the
    // intermittent red on chromium / firefox / webkit (CI run 41444674773
    // traces: before 1 → after 0, 2 → 0, before 0). The invariant is: a finite
    // integer in 0..100 at both samples, and different between them, because the
    // lane is being scheduled. At the fixture's 128 BPM, 1.5 s is ~12.8 sixteenth
    // steps, so the two samples always land on steps that read differently.
    const cutoffKnob = page.getByRole('slider', { name: /^CUTOFF/i }).first();
    await expect(cutoffKnob).toBeVisible();

    const readAriaValueNow = async (): Promise<number> => {
      const raw = await cutoffKnob.getAttribute('aria-valuenow');
      expect(raw, 'aria-valuenow is an integer').toMatch(/^\d+$/);
      const value = Number(raw);
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
      return value;
    };

    const before = await readAriaValueNow();
    await page.waitForTimeout(1500);
    const after = await readAriaValueNow();
    expect(after, 'cutoff lane moves the knob between samples').not.toBe(before);
  });
});
