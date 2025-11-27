import { test, expect } from '@playwright/test';

test('sequencer playback in pattern mode', async ({ page }) => {
  await page.goto('http://localhost:5174/');

  // Wait for the app to initialize
  await page.waitForSelector('text=ELECTRIBE', { timeout: 60000 });

  // Switch to pattern mode
  await page.click('text=PATTERN');

  // Click the play button
  await page.click('text=PLAY');

  // Wait for a moment for playback to start
  await page.waitForTimeout(500);

  // Check if the first step indicator is visible
  const firstCurrentStepIndicator = page.locator('rect[stroke="#ffffff"]').first();
  await expect(firstCurrentStepIndicator).toBeVisible();
});
