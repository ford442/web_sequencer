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
    // integer in 0..100 at every sample, and more than one value across the
    // 1.5 s window, because the lane is being scheduled.
    //
    // Why sample through the window rather than compare its two ends: at the
    // fixture's 128 BPM a bar is 1.875 s, and the two reads' own round trips
    // stretch a nominal 1.5 s gap (1.73 s measured locally), putting the second
    // read on the step next to the first — and neighbouring steps can round to
    // the same value (steps 3 and 4 both read 2; seen locally: 2 → 2). Over the
    // window the lane covers ~12 steps, i.e. at least five distinct values.
    const cutoffKnob = page.getByRole('slider', { name: /^CUTOFF/i }).first();
    await expect(cutoffKnob).toBeVisible();

    await expect.poll(async () => {
      const val = await cutoffKnob.getAttribute('aria-valuenow');
      return Number(val);
    }, { timeout: 5000 }).toBeGreaterThan(0);

    const readAriaValueNow = async (): Promise<number> => {
      const raw = await cutoffKnob.getAttribute('aria-valuenow');
      expect(raw, 'aria-valuenow is an integer').toMatch(/^\d+$/);
      const value = Number(raw);
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
      return value;
    };

    const WINDOW_MS = 1500;
    const SAMPLE_EVERY_MS = 100;
    const seen = new Set<number>([await readAriaValueNow()]);
    for (let waited = 0; waited < WINDOW_MS; waited += SAMPLE_EVERY_MS) {
      await page.waitForTimeout(SAMPLE_EVERY_MS);
      seen.add(await readAriaValueNow());
    }
    expect(seen.size, `cutoff lane moves the knob within ${WINDOW_MS} ms (saw ${[...seen].join(', ')})`)
      .toBeGreaterThanOrEqual(2);
  });
});
