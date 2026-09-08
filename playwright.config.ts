import { defineConfig, devices } from '@playwright/test';

/**
 * Cross-browser matrix for Hyphon DAW E2E (#1036 / #978).
 *
 * Chromium: WebGPU when available; Chromium-only autoplay launch flag.
 * Firefox / WebKit: CPU fallback paths — must NOT receive Chromium CLI args
 * (WebKit rejects `--autoplay-policy=…` and fails to launch entirely).
 *
 * webServer owns the Vite preview lifecycle so tests do not race a
 * manually-started server. CI and local verification run after `pnpm run build`
 * and must serve `dist/` — Vite *dev* refuses to transform public/hyphon_native.js
 * (`loadAndTransform`), which leaves INITIALIZE SYSTEM disabled forever.
 *
 * StartOverlay `?e2e=1` unlocks AudioContext inside the click turn (Firefox/
 * WebKit otherwise hang forever on suspended resume after React setState).
 */
export default defineConfig({
  testDir: './tests',
  globalSetup: './tests/global-setup.ts',
  timeout: 240_000,
  expect: { timeout: 15_000 },
  // Two concurrent AudioContexts + hyphon_native pthread WASM abort Chromium
  // and WebKit renderers (`Target page has been closed`). One worker is slow
  // (~45m for the full matrix) but is the only stable configuration.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    screenshot: 'off',
    video: 'off',
    // CI used to upload ~541MB of traces from every retried boot timeout.
    // retain-on-failure keeps a debug artifact without recording successful tests.
    trace: process.env.CI ? 'retain-on-failure' : 'on-first-retry',
  },
  // Preview of dist/ (COOP/COEP headers come from vite.config.ts preview.headers).
  webServer: {
    command: process.env.PW_WEBSERVER_CMD ?? 'pnpm exec vite preview --host 127.0.0.1 --port 5173',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          // Chromium-only — do not put this on the shared `use` block (#1036).
          args: ['--autoplay-policy=no-user-gesture-required'],
        },
      },
    },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        launchOptions: {
          // Belt-and-suspenders with StartOverlay ?e2e=1 unlock.
          firefoxUserPrefs: {
            'media.autoplay.default': 0,
            'media.autoplay.enabled.user-gestures-needed': false,
            'media.autoplay.blocking_policy': 0,
            'media.block-autoplay-until-in-foreground': false,
          },
        },
      },
    },
    {
      name: 'webkit',
      // Renderer aborts under parallel boots; serial + one retry keeps the matrix honest.
      fullyParallel: false,
      retries: 1,
      use: { ...devices['Desktop Safari'] },
    },
  ],
});
