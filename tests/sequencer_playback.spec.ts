import { test, expect } from '@playwright/test';

test('sequencer advances steps when playing', async ({ page }) => {
  // Navigate to the app
  await page.goto('http://localhost:5174/');

  // Wait for the app to be ready by looking for a key UI element.
  await expect(page.locator('text=ELECTRIBEWEB')).toBeVisible({ timeout: 90000 });

  // Click the "PLAY" button to start the sequencer.
  await page.getByRole('button', { name: 'PLAY' }).click();

  // Wait for the sequencer to start playing (initialization might take time)
  await expect(page.getByRole('button', { name: 'STOP' })).toBeVisible({ timeout: 30000 });

  // The sequencer starts at step -1, then moves to 0. We expect to see the indicator at the first step.
  // The step indicator is a <rect> element with a white stroke.
  const firstStepIndicator = page.locator('g[transform="translate(140, 0)"] rect[stroke="#ffffff"]');
  await expect(firstStepIndicator).toBeVisible({ timeout: 15000 });

  // Now, we'll wait a moment and check that the indicator has moved to a different step.
  // This confirms the sequencer is advancing. The exact step it will be on is timing-dependent,
  // so we check that the first step is *no longer* highlighted.
  await expect(firstStepIndicator).not.toBeVisible({ timeout: 5000 });

  // As a final check, we'll verify that some *other* step indicator is now visible.
  const anyStepIndicator = page.locator('rect[stroke="#ffffff"]');
  await expect(anyStepIndicator).toBeVisible({ timeout: 5000 });
});
