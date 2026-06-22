import { defineConfig } from '@playwright/test';

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
});
