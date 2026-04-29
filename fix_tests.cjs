const fs = require('fs');

const file1 = 'tests/rust_oscillator.spec.ts';
fs.writeFileSync(file1, `import { test, expect } from '@playwright/test';

test('Verify Rust Oscillator loads and Waveform Selector updates', async ({ page }) => {
  // 1. Go to the app
  await page.goto('/');

  // Dismiss StartOverlay
  const startBtnOverlay = page.getByRole('button', { name: 'INITIALIZE SYSTEM' });
  if (await startBtnOverlay.isVisible()) {
      await expect(startBtnOverlay).toBeEnabled({ timeout: 90000 });
      await startBtnOverlay.dispatchEvent('click');
      await expect(startBtnOverlay).toBeHidden({ timeout: 30000 });
  }

  // Wait extra time for the overlay to completely animate away and Pyodide to finish
  await page.waitForTimeout(3000);

  // 3. Locate the Waveform Selector for Synth A (Lead)
  const leadModule = page.locator('.rounded-2xl', { hasText: 'SYNTH A // LEAD' });

  // We need to OPEN the waveform selector first
  const waveformToggle = leadModule.getByRole('button', { name: 'Open waveform selector' });
  await waveformToggle.waitFor({ state: 'visible' });
  await waveformToggle.dispatchEvent('click');
  await page.waitForTimeout(1000);

  // 4. Click the "RUST SAW" button
  const rustSawBtn = page.getByRole('button', { name: 'Select rust-saw', exact: false });
  await rustSawBtn.waitFor({ state: 'visible' });
  await rustSawBtn.dispatchEvent('click');
  await page.waitForTimeout(1000);

  // 5. Verify it is selected
  await expect(rustSawBtn).toHaveClass(/bg-cyan-500/);

  // Open again
  await waveformToggle.dispatchEvent('click');
  await page.waitForTimeout(1000);

  // 6. Click "RUST SQR"
  const rustSqrBtn = page.getByRole('button', { name: 'Select rust-sqr', exact: false });
  await rustSqrBtn.dispatchEvent('click');

  // 7. Verify it is selected
  await expect(rustSqrBtn).toHaveClass(/bg-cyan-500/);
});
`);

const file2 = 'tests/verify_note_length.spec.ts';
fs.writeFileSync(file2, `import { test, expect } from '@playwright/test';

test('verify note length controls and auto-delete', async ({ page }) => {
    // 1. Load Page
    await page.goto('/');
    
    // Dismiss StartOverlay
    const startBtnOverlay = page.getByRole('button', { name: 'INITIALIZE SYSTEM' });
    if (await startBtnOverlay.isVisible()) {
        await expect(startBtnOverlay).toBeEnabled({ timeout: 90000 });
        await startBtnOverlay.dispatchEvent('click');
        await expect(startBtnOverlay).toBeHidden({ timeout: 30000 });
    }
    
    await expect(page.getByText('HYPHON').first()).toBeVisible();

    // Give it a moment for the sequencer to render completely and overlay to disappear
    await page.waitForTimeout(3000);

    // 2. Setup: Create notes on Step 0 and Step 2
    // Use exact match to avoid matching "Lead step 10", "11", etc.
    const step0 = page.getByRole('button', { name: 'Lead step 1', exact: true });
    const step2 = page.getByRole('button', { name: 'Lead step 3', exact: true });

    // Wait for hydration/rendering
    await step0.waitFor();

    await step0.dispatchEvent('click');
    await page.waitForTimeout(500);
    await step2.dispatchEvent('click');
    await page.waitForTimeout(500);

    // Verify both are active
    await expect(step0.locator('.step-glow')).toBeVisible();
    await expect(step2.locator('.step-glow')).toBeVisible();

    // 3. Open Context Menu on Step 0
    await step0.dispatchEvent('contextmenu');
    await page.waitForTimeout(1000);

    // Verify Menu Open
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(page.getByText('NOTE PROPERTIES')).toBeVisible();

    // 4. Change Duration to 4
    const slider = dialog.locator('input[type="range"]');
    // Using fill to set value directly
    await slider.fill('4');
    // Also dispatch input/change to ensure React state updates
    await slider.dispatchEvent('input');
    await slider.dispatchEvent('change');
    await page.waitForTimeout(500);

    // 5. Verify Step 0 expanded text updates
    await expect(page.getByText('4 Steps')).toBeVisible();

    // 6. Verify Step 2 is DELETED (no glow)
    // The auto-delete logic should have cleared step 2 because length 4 covers steps 0, 1, 2, 3.
    await expect(step2.locator('.step-glow')).not.toBeVisible();

    // 7. Verify Step 0 is still active
    await expect(step0.locator('.step-glow')).toBeVisible();
});
`);
