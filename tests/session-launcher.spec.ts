import { test, expect } from '@playwright/test';
import { initializeHyphonAudio } from './helpers/boot';
import { startPlaybackAndAwaitClock } from './helpers/rbs-e2e';

test.describe('Session clip launcher', () => {
  test('boot → load pack → launch scene → quantized play → capture → arrangement', async ({ page }) => {
    await initializeHyphonAudio(page);

    await page.getByRole('button', { name: 'Toggle Session Launcher' }).click();
    await expect(page.getByRole('dialog', { name: 'SESSION' })).toBeVisible();

    await page.getByRole('button', { name: 'Load starter pack Acid Live Set' }).click();
    await expect(page.getByTestId('session-clip-kick-0')).toBeEnabled();

    await startPlaybackAndAwaitClock(page);

    await page.getByTestId('session-scene-0').click();

    await expect
      .poll(async () => {
        return page.evaluate(() => {
          const w = window as Window & {
            __HYPHON_E2E__?: { getSessionPlayingCount?: () => number; getSessionLastApplyStep?: () => number };
          };
          return w.__HYPHON_E2E__?.getSessionPlayingCount?.() ?? 0;
        });
      }, { timeout: 15_000, intervals: [100, 250, 500] })
      .toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Capture launches into the arrangement' }).click();
    await page.getByRole('button', { name: 'Stop capturing launches into the arrangement' }).click();

    // Capture writes timeline clips and opens the Arrangement view (#1342).
    await expect(page.getByRole('region', { name: 'Arrangement timeline' })).toBeVisible({ timeout: 10_000 });
  });
});
