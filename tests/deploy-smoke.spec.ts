import { test, expect } from '@playwright/test';

/**
 * Smoke test against the public test deployment (COOP/COEP + WASM path).
 * Skipped in CI unless DEPLOY_SMOKE_URL is set — local runs can target test.1ink.us.
 */
const deployBase =
  process.env.DEPLOY_SMOKE_URL?.replace(/\/?$/, '/') ?? 'https://test.1ink.us/hyphon/';

test.describe('deploy smoke', () => {
  test.skip(process.env.CI === 'true' && !process.env.DEPLOY_SMOKE_URL, 'Set DEPLOY_SMOKE_URL in CI to run against live deploy');

  test('cold load reaches playable transport', async ({ page }) => {
    await page.goto(deployBase + 'index.html', { waitUntil: 'domcontentloaded' });

    const startBtn = page.getByRole('button', { name: 'INITIALIZE SYSTEM' });
    await expect(startBtn).toBeVisible({ timeout: 120_000 });
    await expect(startBtn).toBeEnabled({ timeout: 120_000 });
    await startBtn.click();

    await expect(
      page.getByRole('button', { name: 'Start Playback', exact: true }),
    ).toBeVisible({ timeout: 120_000 });
  });
});
