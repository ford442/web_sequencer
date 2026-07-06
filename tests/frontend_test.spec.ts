import { test, expect } from '@playwright/test';

test('App starts up without crashing and renders sequencer', async ({ page }) => {
  await page.goto('http://localhost:5173');
  // Wait for the app to load
  await page.waitForSelector('text=HYPHON');
  // the main sequencer should be visible
  await expect(page.locator('.svg-step').first()).toBeVisible();
});
