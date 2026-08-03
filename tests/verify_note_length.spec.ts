import { test, expect } from '@playwright/test';
import { initializeHyphonAudio } from './helpers/boot';

/**
 * Note length / auto-delete on overlapping steps.
 * Previously skipped due to StartOverlay flake (#1036).
 */
test('verify note length controls and auto-delete', async ({ page }) => {
    await initializeHyphonAudio(page);

    await expect(page.getByText('HYPHON').first()).toBeVisible();

    const step0 = page.getByRole('button', { name: 'Lead step 1', exact: true });
    const step2 = page.getByRole('button', { name: 'Lead step 3', exact: true });

    await step0.waitFor({ state: 'visible', timeout: 30_000 });

    await step0.click();
    await step2.click();

    await expect(step0.locator('.step-glow')).toBeVisible();
    await expect(step2.locator('.step-glow')).toBeVisible();

    await step0.click({ button: 'right' });

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(page.getByText('NOTE PROPERTIES')).toBeVisible();

    const slider = dialog.locator('input[type="range"]');
    await slider.fill('4');
    await slider.dispatchEvent('input');
    await slider.dispatchEvent('change');

    await expect(page.getByText('4 Steps')).toBeVisible();

    await expect(step2.locator('.step-glow')).not.toBeVisible();
    await expect(step0.locator('.step-glow')).toBeVisible();
});
