import { test, expect } from '@playwright/test';
import { ReleaseGuard, formatFindings } from './helpers/release-guard';

/**
 * Smoke test against a public test deployment (COOP/COEP + WASM path).
 * Opt-in via DEPLOY_SMOKE_URL so the default matrix does not depend on the
 * live host (which can still be on a pre-fix bundle).
 *
 * Fails on any console.error / page error, any HTTP >= 400, any failed request
 * and a non-isolated page (same rules and allowlists as tests/release-smoke.spec.ts).
 * The full core-flow coverage lives there; this is the minimal boot → play check.
 */
const deployBase =
  process.env.DEPLOY_SMOKE_URL?.replace(/\/?$/, '/') ?? 'https://test.1ink.us/hyphon/';

test.describe('deploy smoke', () => {
  test.skip(!process.env.DEPLOY_SMOKE_URL, 'Set DEPLOY_SMOKE_URL to run against a live deploy');

  test('cold load reaches playable transport with a clean console and network', async ({ page }) => {
    const guard = new ReleaseGuard();
    guard.attach(page.context());

    await page.goto(deployBase + 'index.html', { waitUntil: 'domcontentloaded' });
    expect(await page.evaluate(() => self.crossOriginIsolated), 'page is not crossOriginIsolated').toBe(true);

    const startBtn = page.getByRole('button', { name: 'INITIALIZE SYSTEM' });
    await expect(startBtn).toBeVisible({ timeout: 120_000 });
    await expect(startBtn).toBeEnabled({ timeout: 120_000 });
    await startBtn.click();

    await expect(
      page.getByRole('button', { name: 'Start Playback', exact: true }),
    ).toBeVisible({ timeout: 120_000 });

    const findings = guard.drain();
    if (findings.length > 0) {
      throw new Error(`${findings.length} console/network finding(s):\n${formatFindings(findings)}`);
    }
  });
});
