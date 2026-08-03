import { test, expect } from '@playwright/test';
import { initializeHyphonAudio, openRackModule } from './helpers/boot';

/**
 * Rust oscillator waveform selector smoke.
 * Previously skipped due to StartOverlay flake + `.rounded-2xl` selectors (#1036).
 */
test('Verify Rust Oscillator loads and Waveform Selector updates', async ({ page }) => {
  await initializeHyphonAudio(page);

  const leadModule = await openRackModule(page, 'SYNTH A');

  const rustSawBtn = leadModule.getByLabel('Select rust-saw waveform');
  await rustSawBtn.click();
  await expect(rustSawBtn).toHaveClass(/bg-cyan-500/);

  const rustSqrBtn = leadModule.getByLabel('Select rust-sqr waveform');
  await rustSqrBtn.click();
  await expect(rustSqrBtn).toHaveClass(/bg-cyan-500/);
});
