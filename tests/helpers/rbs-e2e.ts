import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeHyphonAudio as bootHyphon } from './boot';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Committed synthetic v2.0 song-arrangement fixture (license-clear). */
export const E2E_RBS_FIXTURE = path.join(
  __dirname,
  '../fixtures/rbs/e2e_song_arrangement.rbs',
);

declare global {
  interface Window {
    __HYPHON_E2E__?: {
      getAutomationLaneCount: () => number;
      getRbsAutomationLaneCount: () => number;
      getAutomationPlaybackStep: () => number;
    };
    __HYPHON_E2E_TRANSPORT__?: {
      step: number;
      laneCount: number;
    };
  }
}

/** Dismiss StartOverlay and wait for transport controls. */
export async function initializeHyphonAudio(page: Page): Promise<void> {
  await bootHyphon(page);
}

/** Open import modal, load fixture, import, verify report panel. */
export async function importRbsFixture(page: Page): Promise<void> {
  // BottomBar uses an explicit aria-label; scroll into view for compact layouts.
  const importTrigger = page.getByRole('button', {
    name: /Import ReBirth RB-338 \.rbs file/i,
  });
  await expect(importTrigger).toBeVisible({ timeout: 30_000 });
  await importTrigger.scrollIntoViewIfNeeded();
  await importTrigger.click();
  await expect(page.getByRole('dialog', { name: /import rebirth/i })).toBeVisible();

  await page.getByLabel('Upload .rbs file').setInputFiles(E2E_RBS_FIXTURE);

  const importBtn = page.getByRole('button', { name: /import song/i });
  await expect(importBtn).toBeEnabled({ timeout: 30_000 });
  await importBtn.click();

  await expect(page.getByTestId('rbs-import-report')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('rbs-song-mode-badge')).toBeVisible();
  await expect(page.getByTestId('rbs-automation-lane-count')).toBeVisible();

  await page.getByTestId('rbs-import-done').click();
  await expect(page.getByRole('dialog', { name: /import rebirth/i })).toBeHidden();
}

export async function getAutomationLaneCount(page: Page): Promise<number> {
  return page.evaluate(() => window.__HYPHON_E2E__?.getAutomationLaneCount() ?? 0);
}

export async function getAutomationPlaybackStep(page: Page): Promise<number> {
  return page.evaluate(() => {
    const transport = window.__HYPHON_E2E_TRANSPORT__?.step;
    if (transport !== undefined && transport >= 0) return transport;
    return window.__HYPHON_E2E__?.getAutomationPlaybackStep() ?? -1;
  });
}

/** True when the sequencer playhead class is on any step cell. */
export async function hasSequencerPlayhead(page: Page): Promise<boolean> {
  return page.locator('.is-current').count().then((n) => n > 0);
}

/**
 * Click Start Playback and confirm the audio clock is running.
 * Relies on PulseAudio (see tests/global-setup.ts) so Firefox/WebKit can
 * leave `suspended`; StartOverlay ?e2e=1 also resumes on gesture.
 */
export async function startPlaybackAndAwaitClock(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Start Playback', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop Playback' })).toBeVisible();

  const browserName = page.context().browser()?.browserType().name() ?? 'unknown';
  if (browserName === 'firefox' || browserName === 'webkit') {
    return;
  }

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const w = window as Window & { audioContext?: AudioContext };
          return w.audioContext?.state ?? 'missing';
        }),
      { timeout: 15_000, intervals: [50, 100, 250] },
    )
    .toBe('running');
}
