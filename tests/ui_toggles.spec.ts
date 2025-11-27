import { test, expect } from '@playwright/test';

test('UI toggles for keyboard and song mode', async ({ page }) => {
  await page.goto('http://localhost:5174/');

  // Wait for the app to initialize
  await page.waitForSelector('text=ELECTRIBE', { timeout: 60000 });

  const keyboardContainer = page.getByTestId('keyboard-container');
  const songContainer = page.getByTestId('song-mode-container');

  // Initial state
  await expect(keyboardContainer).toHaveClass(/w-0/);
  await expect(songContainer).not.toHaveClass(/max-h-0/);

  // Show keyboard
  await page.click('text=SHOW KEYBOARD');
  await page.waitForTimeout(1000);
  await expect(keyboardContainer).not.toHaveClass(/w-0/);

  // Hide song mode
  await page.click('text=HIDE SONG');
  await page.waitForTimeout(1000);
  await expect(songContainer).toHaveClass(/max-h-0/);

  // Hide keyboard
  await page.click('text=HIDE KEYBOARD');
  await page.waitForTimeout(1000);
  await expect(keyboardContainer).toHaveClass(/w-0/);

  // Show song mode
  await page.click('text=SHOW SONG');
  await page.waitForTimeout(1000);
  await expect(songContainer).not.toHaveClass(/max-h-0/);
});
