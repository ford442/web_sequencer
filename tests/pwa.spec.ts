import { test, expect } from '@playwright/test';
import { initializeHyphonAudio } from './helpers/boot';

/**
 * public/sw.js + the `hyphon-precache-manifest` Vite plugin (vite.config.ts).
 *
 * Registration is gated behind `?pwa=1` in main.tsx so the rest of the E2E
 * matrix (which never passes it) is byte-for-byte unaffected — see the
 * `registerServiceWorker` comment in src/main.tsx.
 */
test.describe('PWA service worker', () => {
  test('crossOriginIsolated stays true once the service worker controls the page', async ({ page }) => {
    await initializeHyphonAudio(page, { query: 'e2e=1&pwa=1' });

    // SW activation calls self.clients.claim(), so the *current* page becomes
    // controlled without needing a second navigation.
    await expect
      .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker?.controller)), {
        timeout: 30_000,
        intervals: [200, 500, 1000],
      })
      .toBe(true);

    // SharedArrayBuffer / threaded hyphon_native.wasm depend on this — a
    // service worker that ever serves a response missing the
    // Cross-Origin-Resource-Policy header (see withCorp() in sw.js) would
    // silently flip this false without failing any single resource load.
    const isolated = await page.evaluate(() => window.crossOriginIsolated);
    expect(isolated).toBe(true);
  });

  test('second load boots the app shell and plays a pattern fully offline', async ({ page, context, browserName }) => {
    // Playwright's WebKit driver cannot reload a service-worker-controlled
    // page while the context is offline — page.reload() throws "WebKit
    // encountered an internal error" at the protocol level, deterministically
    // (confirmed on both the initial attempt and Playwright's built-in
    // webkit retry), before any app code runs. This is a driver limitation,
    // not a functional gap in sw.js — crossOriginIsolated (the test above)
    // passes on webkit with the same service worker active.
    test.skip(browserName === 'webkit', 'Playwright WebKit cannot reload while offline with an active service worker');

    // First load: online, so the service worker can install and precache the
    // shell, and runtime-cache the audio engine assets loadHyphonNative()
    // fetches during a normal boot (hyphon_native.js/.wasm, default
    // oscillator samples) — see RUNTIME_CACHE_PATTERNS in sw.js.
    await initializeHyphonAudio(page, { query: 'e2e=1&pwa=1' });

    await expect
      .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker?.controller)), {
        timeout: 30_000,
        intervals: [200, 500, 1000],
      })
      .toBe(true);

    // Belt-and-suspenders: `controller` being set already implies install's
    // waitUntil(precacheShell()) resolved (activate/clients.claim() run
    // after it), but confirm the precache entry actually landed in Cache
    // Storage before cutting the network.
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const keys = await caches.keys();
            return keys.some((k) => k.startsWith('hyphon-precache-'));
          }),
        { timeout: 15_000 },
      )
      .toBe(true);

    await context.setOffline(true);
    try {
      await page.reload();

      const overlay = page.getByTestId('start-overlay');
      await overlay.waitFor({ state: 'visible', timeout: 30_000 });
      const startBtn = page.getByTestId('initialize-system');
      await expect(startBtn).toBeEnabled({ timeout: 60_000 });
      await startBtn.click();
      await overlay.waitFor({ state: 'hidden', timeout: 30_000 });

      const playBtn = page.getByRole('button', { name: 'Start Playback', exact: true });
      await expect(playBtn).toBeVisible({ timeout: 60_000 });

      await playBtn.click();
      await expect(
        page.getByRole('button', { name: 'Stop Playback', exact: true }),
      ).toBeVisible({ timeout: 15_000 });
    } finally {
      await context.setOffline(false);
    }
  });
});
