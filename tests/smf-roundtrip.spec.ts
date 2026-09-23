import { test, expect } from '@playwright/test';
import { initializeHyphonAudio, importSmfFixture, E2E_SMF_FIXTURE } from './helpers/smf-e2e';

/**
 * `test-fixtures/10_isotherms.mid` is a real Standard MIDI File. RBS's own
 * parser tests use it as a *negative* fixture (proof RBS rejects real SMF
 * bytes under a .rbs filename) — here it's the *positive* fixture: a
 * real-world .mid file the SMF importer must handle without crashing,
 * producing either a playable pattern or a loud ImportReport.
 *
 * The export→import tick-fidelity round trip (within one 16th note) is
 * covered at the unit level in src/__tests__/SmfExporter.test.ts, which can
 * assert exact tick values — this spec covers the browser-facing import UX.
 */
test.describe('SMF import E2E', () => {
  test('imports a real-world .mid file without crashing, shows a report', async ({ page }) => {
    await initializeHyphonAudio(page);
    await importSmfFixture(page, E2E_SMF_FIXTURE);

    // The app is still alive and responsive after import (no crash / white screen).
    await expect(page.getByRole('button', { name: 'Start Playback', exact: true })).toBeVisible();
  });

  test('SMF import report shows a non-negative note count and no thrown errors', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await initializeHyphonAudio(page);

    const importTrigger = page.getByRole('button', { name: /Import Standard MIDI \.mid file/i });
    await importTrigger.scrollIntoViewIfNeeded();
    await importTrigger.click();
    await page.getByLabel('Upload .mid file').setInputFiles(E2E_SMF_FIXTURE);

    await expect(page.getByTestId('smf-import-report')).toBeVisible({ timeout: 30_000 });
    const notesImportedText = await page.getByTestId('smf-notes-imported').textContent();
    expect(Number(notesImportedText)).toBeGreaterThanOrEqual(0);

    expect(pageErrors).toEqual([]);
  });

  test('rejects a .mid file selected in the RBS import dialog (RBS stays .rbs-only)', async ({ page }) => {
    await initializeHyphonAudio(page);

    const rbsImportTrigger = page.getByRole('button', { name: /Import ReBirth RB-338 \.rbs file/i });
    await rbsImportTrigger.scrollIntoViewIfNeeded();
    await rbsImportTrigger.click();
    await expect(page.getByRole('dialog', { name: /import rebirth/i })).toBeVisible();

    // The RBS file input only accepts .rbs — the browser itself won't offer
    // a .mid file through it, so this asserts the accept attribute directly.
    const rbsFileInput = page.getByLabel('Upload .rbs file');
    await expect(rbsFileInput).toHaveAttribute('accept', '.rbs');
  });
});
