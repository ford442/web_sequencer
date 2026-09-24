import { test, expect } from '@playwright/test';
import { initializeHyphonAudio, openRackModule, selectOscillatorFamily, clickControl } from './helpers/boot';

/**
 * WASM OSC (AssemblyScript) waveform selector smoke.
 *
 * Replaces the old `rust_oscillator.spec.ts`: the Rust family was a second
 * main-thread `generate()` + looped-buffer duplicate of this kernel and was
 * removed in #1294, leaving one WASM wavetable engine. Family + variant clicks
 * are real user clicks — HardwareModule no longer cancels pointerdowns aimed at
 * its DOM overlays (#1035).
 */
test('Verify WASM oscillator loads and Waveform Selector updates', async ({ page }) => {
  await initializeHyphonAudio(page);

  const leadModule = await openRackModule(page, 'SYNTH A');
  await selectOscillatorFamily(leadModule, 'wam');

  const sawBtn = leadModule.getByLabel('Select WASM OSC SAW waveform');
  await expect(sawBtn).toBeVisible({ timeout: 10_000 });
  await clickControl(sawBtn);
  await expect(sawBtn).toHaveAttribute('aria-pressed', 'true');

  const sqrBtn = leadModule.getByLabel('Select WASM OSC SQR waveform');
  await clickControl(sqrBtn);
  await expect(sqrBtn).toHaveAttribute('aria-pressed', 'true');
  await expect(sawBtn).toHaveAttribute('aria-pressed', 'false');
});
