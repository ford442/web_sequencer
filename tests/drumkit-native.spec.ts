import { test, expect, type Page } from '@playwright/test';
import { initializeHyphonAudio } from './helpers/boot';
import { startPlaybackAndAwaitClock } from './helpers/rbs-e2e';

/**
 * The native drum kit is live: `drumkit` resolves to the AudioWorklet on
 * hyphon_native (not the Web Audio fallback), and the worklet's own output
 * carries the hits while the pattern plays. A fallback kit would sound too,
 * but on its own nodes, so only a working native path reaches the tap.
 *
 * Sequencer steps are SVG cells: toggle them from the keyboard (Enter).
 */

type Hooks = {
  getEngineResolution(subsystem: string): string | null;
  measureAudioTapPeak(name: string, ms: number): Promise<number | null>;
};

const hooks = (page: Page) => ({
  resolution: () =>
    page.evaluate(() => (window as unknown as { __HYPHON_E2E__?: Hooks }).__HYPHON_E2E__?.getEngineResolution('drumkit') ?? null),
  peak: (ms: number) =>
    page.evaluate(
      (d) => (window as unknown as { __HYPHON_E2E__?: Hooks }).__HYPHON_E2E__?.measureAudioTapPeak('drumkit-worklet', d) ?? null,
      ms,
    ),
});

test('native drum kit: resolves to the worklet and renders the hits', async ({ page }) => {
  await initializeHyphonAudio(page);
  const probe = hooks(page);

  expect(await probe.resolution()).toBe('wasm-worklet');
  // Idle: the kit is exactly silent (no held state between hits).
  expect(await probe.peak(300)).toBe(0);

  const kick = page.getByTestId('step-kick-0');
  await kick.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'nearest' }));
  if ((await kick.getAttribute('aria-pressed')) !== 'true') {
    await kick.press('Enter');
  }
  await expect(kick).toHaveAttribute('aria-pressed', 'true');

  await page.evaluate(() => { window.__HYPHON_E2E_DRUM_HITS__ = []; });
  await startPlaybackAndAwaitClock(page);

  await expect
    .poll(() => page.evaluate(() => (window.__HYPHON_E2E_DRUM_HITS__ ?? []).filter((h) => h.track === 'kick').length), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);
  // 120 BPM four-on-the-floor: 1.5 s holds several kicks.
  expect(await probe.peak(1500)).toBeGreaterThan(0.05);

  await page.getByRole('button', { name: 'Stop Playback' }).click();
});
