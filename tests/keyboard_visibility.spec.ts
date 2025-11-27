import { test, expect } from '@playwright/test';

test('keyboard visibility toggle', async ({ page }) => {
  await page.goto('/');

  // Wait for the main app UI to be visible
  await expect(page.locator('text=ELECTRIBEWEB')).toBeVisible({ timeout: 90000 });

  const keyboardContainer = page.getByTestId('keyboard-container');
  const showKeyboardButton = page.getByRole('button', { name: 'SHOW KEYBOARD' });
  const hideKeyboardButton = page.getByRole('button', { name: 'HIDE KEYBOARD' });

  // Keyboard should be hidden initially, check for width 0 and opacity 0
  await expect(keyboardContainer).toHaveClass(/w-0/);
  await expect(keyboardContainer).toHaveClass(/opacity-0/);
  await expect(showKeyboardButton).toBeVisible();
  await expect(hideKeyboardButton).toBeHidden();

  // Click to show the keyboard
  await showKeyboardButton.click();

  // Keyboard should be visible now
  await expect(keyboardContainer).not.toHaveClass(/w-0/);
  await expect(keyboardContainer).not.toHaveClass(/opacity-0/);
  await expect(showKeyboardButton).toBeHidden();
  await expect(hideKeyboardButton).toBeVisible();

  // Click to hide the keyboard again
  await hideKeyboardButton.click();

  // Keyboard should be hidden again
  await expect(keyboardContainer).toHaveClass(/w-0/);
  await expect(keyboardContainer).toHaveClass(/opacity-0/);
  await expect(showKeyboardButton).toBeVisible();
  await expect(hideKeyboardButton).toBeHidden();
});
