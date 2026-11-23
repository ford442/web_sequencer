import { test, expect } from '@playwright/test';
import { initializeHyphonAudio } from './helpers/boot';
import { startEphemeralPreview, type EphemeralPreview } from './helpers/ephemeralPreview';

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
});

/**
 * #1659. The page is served by a private `vite preview` that the test KILLS before the
 * reload, so "offline" means the origin is unreachable for the page AND the service worker.
 * `context.setOffline(true)` alone does not stop fetch() calls issued from the worker's own
 * thread, which is why an earlier version of this test could neither fail for the right reason
 * nor pass for the right reason (see docs/deployment/ADR_PWA_SERVICE_WORKER_COEP.md).
 */
test.describe('PWA offline second load (#1659)', () => {
  const OFFLINE_PORT = 5174;
  test.use({ baseURL: `http://127.0.0.1:${OFFLINE_PORT}` });
  test.skip(
    Boolean(process.env.DEPLOY_SMOKE_URL),
    'needs a local dist/ preview it can stop; a deployed build cannot be taken offline',
  );

  let preview: EphemeralPreview | undefined;
  test.beforeEach(async () => {
    preview = await startEphemeralPreview(OFFLINE_PORT);
  });
  test.afterEach(async () => {
    await preview?.stop();
    preview = undefined;
  });

  test('second load boots the app shell and plays a pattern fully offline', async ({ page, context, browserName }) => {
    // First load: online, so the service worker installs and precaches the shell.
    await initializeHyphonAudio(page, { query: 'e2e=1&pwa=1' });

    await expect
      .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker?.controller)), {
        timeout: 30_000,
        intervals: [200, 500, 1000],
      })
      .toBe(true);

    // `controller` set already implies install's waitUntil(precacheShell()) resolved; confirm
    // what landed in Cache Storage is what the offline boot needs, before cutting the network:
    // the hashed bundle AND the unhashed boot assets the page fetched during the (uncontrolled)
    // first load, which no runtime cache-first path ever saw.
    const precached = await page.evaluate(async () => {
      const name = (await caches.keys()).find((k) => k.startsWith('hyphon-precache-'));
      if (!name) return [];
      return (await (await caches.open(name)).keys()).map((r) => new URL(r.url).pathname);
    });
    expect(precached.some((p) => /\/assets\/index-[^/]+\.js$/.test(p))).toBe(true);
    for (const asset of ['/hyphon_native.wasm', '/rubberband.wasm', '/saw.wav', '/samples/vowels/manifest.json']) {
      expect(precached, `${asset} must be precached`).toContain(asset);
    }
    expect(precached.some((p) => p.includes('/pyodide/'))).toBe(false);

    // Take the network away for real: stop the origin, then also emulate offline.
    await preview!.stop();
    preview = undefined;
    // Emulated offline on top (it also takes cross-origin fetches such as fonts offline), except on
    // WebKit: there `page.reload()` after `context.setOffline(true)` throws "WebKit encountered an
    // internal error" at the protocol level before any app code runs (the failure #1659 recorded).
    // With the origin dead and no emulation WebKit reloads and boots fine, so that failure is the
    // Playwright WebKit driver's offline emulation, not the app, and the dead origin is the real offline.
    if (browserName !== 'webkit') await context.setOffline(true);
    await expect(fetch(`http://127.0.0.1:${OFFLINE_PORT}/`, { signal: AbortSignal.timeout(2000) })).rejects.toThrow();

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
      await expect(page.getByRole('button', { name: 'Stop Playback', exact: true })).toBeVisible({
        timeout: 15_000,
      });

      // Same engines as online, not a silent drop to the JS fallbacks: native voice module up,
      // the AssemblyScript export engine loaded, the vowel pack found.
      type Health = {
        nativeStatus: string;
        resolutions: Record<string, string | null>;
        degradations: { id: string }[];
      };
      const h = await page.evaluate(
        () =>
          (
            window as unknown as { __HYPHON_E2E__?: { getEngineHealth?: () => unknown } }
          ).__HYPHON_E2E__?.getEngineHealth?.() as Health,
      );
      expect(h.nativeStatus).toBe('ready');
      expect(h.resolutions.audioExport).toBe('wasm');
      expect(h.degradations.map((d) => d.id)).not.toContain('vowel-samples');
      expect(await page.evaluate(() => window.crossOriginIsolated)).toBe(true);
    } finally {
      if (browserName !== 'webkit') await context.setOffline(false);
    }
  });
});
