import { test, expect } from '@playwright/test';
import { initializeHyphonAudio } from './helpers/boot';

/**
 * Note length / auto-delete on overlapping steps.
 *
 * When a note's length spans later steps, MainSequencer skips rendering those
 * covered step cells (skipCount) — so step-partA-2 leaves the DOM rather than
 * flipping aria-pressed.
 */
test('verify note length controls and auto-delete', async ({ page }) => {
    await initializeHyphonAudio(page);

    const step0 = page.getByTestId('step-partA-0');
    const step2 = page.getByTestId('step-partA-2');

    await step0.waitFor({ state: 'visible', timeout: 30_000 });
    await step0.scrollIntoViewIfNeeded();

    for (const step of [step0, step2]) {
        if ((await step.getAttribute('aria-pressed')) !== 'true') {
            await step.click();
        }
        await expect(step).toHaveAttribute('aria-pressed', 'true');
    }

    await step0.click({ button: 'right' });

    const dialog = page.getByRole('dialog').filter({ hasText: 'NOTE PROPERTIES' });
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    const duration = dialog.locator('#note-duration');
    await expect(duration).toBeVisible();

    await duration.evaluate((el) => {
        const input = el as HTMLInputElement;
        const proto = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,
            'value',
        );
        proto?.set?.call(input, '4');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // Covered steps are omitted from the SVG grid when length > 1.
    await expect(page.getByTestId('step-partA-2')).toHaveCount(0, { timeout: 10_000 });
    await expect(step0).toHaveAttribute('aria-pressed', 'true');
    // Length badge rendered on the extended step cell.
    await expect(step0.locator('text')).toContainText('4x');
});
