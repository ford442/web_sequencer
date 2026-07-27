import { defineConfig, devices } from '@playwright/test';

/**
 * Cross-browser matrix for high-fid engine selection / fallback (#978).
 * Chromium: WebGPU expected when available.
 * Firefox / WebKit: CPU fallback path — no crash, correct badges.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://localhost:5173',
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    launchOptions: {
      args: ['--autoplay-policy=no-user-gesture-required'],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
});
