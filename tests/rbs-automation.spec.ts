import { test, expect } from '@playwright/test';

/**
 * E2E coverage placeholder for RBS import + automation workflows.
 *
 * These scenarios are intentionally skipped until full CI audio/worklet boot is
 * stable (same pattern as existing E2E specs in this repo).
 */

test.skip('RBS import modal loads 10_isotherms.rbs and starts playback', async ({ page }) => {
  await page.goto('/');

  const startButton = page.getByRole('button', { name: 'INITIALIZE SYSTEM' });
  await startButton.click({ force: true });

  await page.getByRole('button', { name: /import rbs/i }).click();
  await page.getByLabel(/select rbs file/i).setInputFiles('10_isotherms.rbs');
  await page.getByRole('button', { name: /import/i }).click();

  await expect(page.getByText(/import report/i)).toBeVisible();
  await page.getByRole('button', { name: /start playback/i }).click();
});

test.skip('automation lane recording persists after song reload', async ({ page }) => {
  await page.goto('/');

  const startButton = page.getByRole('button', { name: 'INITIALIZE SYSTEM' });
  await startButton.click({ force: true });

  await page.getByRole('button', { name: /record automation/i }).click();
  await page.getByLabel(/cutoff/i).fill('70');
  await page.getByRole('button', { name: /record automation/i }).click();

  await page.getByRole('button', { name: /save song/i }).click();
  await page.getByRole('button', { name: /load song/i }).click();

  await expect(page.getByText(/automation/i)).toBeVisible();
  await page.getByRole('button', { name: /start playback/i }).click();
});
