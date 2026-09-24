import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeHyphonAudio as bootHyphon } from './boot';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Real-world Standard MIDI File used as a **positive** SMF fixture.
 * (It's the same file RBS's parser tests use as a negative fixture — proof
 * it rejects real SMF bytes under a .rbs filename.)
 */
export const E2E_SMF_FIXTURE = path.join(__dirname, '../../test-fixtures/10_isotherms.mid');

/** Dismiss StartOverlay and wait for transport controls. */
export async function initializeHyphonAudio(page: Page): Promise<void> {
  await bootHyphon(page);
}

/** Open the SMF import modal, load a .mid file, import it, verify the report panel. */
export async function importSmfFixture(page: Page, fixturePath: string = E2E_SMF_FIXTURE): Promise<void> {
  const importTrigger = page.getByRole('button', { name: /Import Standard MIDI \.mid file/i });
  await expect(importTrigger).toBeVisible({ timeout: 30_000 });
  await importTrigger.scrollIntoViewIfNeeded();
  await importTrigger.click();
  await expect(page.getByRole('dialog', { name: /import standard midi file/i })).toBeVisible();

  await page.getByLabel('Upload .mid file').setInputFiles(fixturePath);

  await expect(page.getByTestId('smf-import-report')).toBeVisible({ timeout: 30_000 });

  const importBtn = page.getByRole('button', { name: /^import file$/i });
  await expect(importBtn).toBeVisible({ timeout: 10_000 });
  await importBtn.click();

  await expect(page.getByTestId('smf-import-done')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('smf-import-done').click();
  await expect(page.getByRole('dialog', { name: /import standard midi file/i })).toBeHidden();
}
