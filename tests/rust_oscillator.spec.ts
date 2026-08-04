import { test, expect } from '@playwright/test';
import { initializeHyphonAudio, openRackModule, selectOscillatorFamily, clickControl } from './helpers/boot';

/**
 * Rust oscillator waveform selector smoke.
 * Family + variant clicks are real user clicks — HardwareModule no longer
 * cancels pointerdowns aimed at its DOM overlays (#1035).
 */
test('Verify Rust Oscillator loads and Waveform Selector updates', async ({ page }) => {
  await initializeHyphonAudio(page);

  const leadModule = await openRackModule(page, 'SYNTH A');
  await selectOscillatorFamily(leadModule, 'rust');

  const rustSawBtn = leadModule.getByLabel('Select Rust SAW waveform');
  await expect(rustSawBtn).toBeVisible({ timeout: 10_000 });
  await clickControl(rustSawBtn);
  await expect(rustSawBtn).toHaveAttribute('aria-pressed', 'true');

  const rustSqrBtn = leadModule.getByLabel('Select Rust SQR waveform');
  await clickControl(rustSqrBtn);
  await expect(rustSqrBtn).toHaveAttribute('aria-pressed', 'true');
  await expect(rustSawBtn).toHaveAttribute('aria-pressed', 'false');
});
