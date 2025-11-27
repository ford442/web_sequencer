import { test, expect } from '@playwright/test';

test('keyboard visibility toggle', async ({ page }) => {
  await page.goto('http://localhost:5174/');

  // Wait for the app to initialize
  await page.waitForSelector('text=ELECTRIBE', { timeout: 60000 });

  const keyboardContainer = page.getByTestId('keyboard-container');

  // Keyboard should be hidden initially
  await expect(keyboardContainer).toHaveClass(/max-h-0/);
  await expect(keyboardContainer).toHaveClass(/opacity-0/);
  await page.screenshot({ path: '/home/jules/verification/00_keyboard_hidden_initial.png' });

  // Click the "SHOW KEYBOARD" button
  await page.click('text=SHOW KEYBOARD');

  // Wait for the animation to complete
  await page.waitForTimeout(1000);

  // Keyboard should be visible
  await expect(keyboardContainer).not.toHaveClass(/max-h-0/);
  await expect(keyboardContainer).toHaveClass(/opacity-100/);
  await page.screenshot({ path: '/home/jules/verification/01_keyboard_visible.png' });

  // Click the "HIDE KEYBOARD" button
  await page.click('text=HIDE KEYBOARD');

  // Wait for the animation to complete
  await page.waitForTimeout(1000);

  // Keyboard should be hidden again
  await expect(keyboardContainer).toHaveClass(/max-h-0/);
  await expect(keyboardContainer).toHaveClass(/opacity-0/);
  await page.screenshot({ path: '/home/jules/verification/02_keyboard_hidden_final.png' });
});
