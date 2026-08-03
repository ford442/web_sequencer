import { defineConfig, devices } from '@playwright/test';

/**
 * Cross-browser matrix for Hyphon DAW E2E (#1036 / #978).
 *
 * Chromium: WebGPU when available; Chromium-only autoplay launch flag.
 * Firefox / WebKit: CPU fallback paths — must NOT receive Chromium CLI args
 * (WebKit rejects `--autoplay-policy=…` and fails to launch entirely).
 *
 * webServer owns the Vite (or preview) lifecycle so tests do not race a
 * manually-started server. CI already serves `dist/` via `pnpm preview` on
 * :5173 — reuseExistingServer picks that up; locally Playwright starts Vite.
 *
 * StartOverlay `?e2e=1` unlocks AudioContext inside the click turn (Firefox/
 * WebKit otherwise hang forever on suspended resume after React setState).
 */
export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  // CI gets one retry for transient WASM/CDN warm-up; local stays strict.
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    trace: 'on-first-retry',
  },
  // Generous timeout: first Vite boot pulls WASM / worklets / Pyodide stubs.
  webServer: {
    command: process.env.PW_WEBSERVER_CMD ?? 'pnpm exec vite --host 127.0.0.1 --port 5173',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
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
      use: { ...devices['Desktop Safari'] },
    },
  ],
});
