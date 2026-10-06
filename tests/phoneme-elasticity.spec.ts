import { test, expect, type Page } from '@playwright/test';
import { initializeHyphonAudio } from './helpers/boot';

/**
 * Sampler + Phoneme Painter elasticity path (#1273 Part B).
 *
 * Program a sampler step, Alt+click it to open the painter, squish / stretch
 * the phoneme with the pill handle and the keyboard, save, and reopen: the
 * value must come back from the pattern. That it is audible is covered by
 * src/__tests__/phonemeElasticity.integration.test.ts (real worklet + wasm).
 */

async function openPainter(page: Page) {
    const step = page.getByTestId('step-sampler-0');
    await step.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'nearest' }));
    await step.click({ modifiers: ['Alt'] });
    const painter = page.getByRole('dialog', { name: /PHONEME PAINTER/ });
    await expect(painter).toBeVisible({ timeout: 10_000 });
    return painter;
}

test('phoneme elasticity is editable in the painter and saved on the sampler step', async ({ page }) => {
    await initializeHyphonAudio(page);

    const step = page.getByTestId('step-sampler-0');
    await step.waitFor({ state: 'visible', timeout: 30_000 });
    await step.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'nearest' }));
    if ((await step.getAttribute('aria-pressed')) !== 'true') await step.click();
    await expect(step).toHaveAttribute('aria-pressed', 'true');

    let painter = await openPainter(page);
    // The labelled role=button wrapper is zero-size (the block inside is
    // absolutely positioned), so pointer input goes to the visible block and
    // keys bubble up to the wrapper's handler.
    const pill = painter.getByRole('button', { name: /^AA phoneme, / });
    const block = painter.getByRole('button', { name: 'AA phoneme', exact: true });
    await expect(pill).toHaveAccessibleName(/elasticity 100%/);
    await block.click();
    await expect(pill).toHaveAttribute('aria-pressed', 'true');

    // Pointer path: drag the squish/stretch strip right (120 px = full range).
    const handle = painter.locator('[data-testid^="elasticity-handle-"]');
    const box = await handle.boundingBox();
    if (!box) throw new Error('elasticity handle not laid out');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 24, box.y + box.height / 2, { steps: 4 });
    await page.mouse.up();
    await expect(handle).toHaveAttribute('data-elasticity', '1.20');

    // Keyboard path: ] stretches by 5 %.
    await block.focus();
    await page.keyboard.press(']');
    await expect(painter.getByRole('slider', { name: 'Elasticity' })).toHaveValue('125');

    await painter.getByRole('button', { name: 'Save changes' }).click();
    await expect(painter).toBeHidden();

    painter = await openPainter(page);
    await expect(painter.getByRole('button', { name: /^AA phoneme, / })).toHaveAccessibleName(/elasticity 125%/);
    await painter.getByRole('button', { name: 'Cancel changes' }).click();
});
