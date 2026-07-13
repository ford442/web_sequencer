import type { Page, Locator } from '@playwright/test';

export async function initializeHyphonAudio(page: Page): Promise<void> {
    await page.goto('/');
    const startBtn = page.getByRole('button', { name: 'INITIALIZE SYSTEM' });
    await startBtn.waitFor({ state: 'visible', timeout: 90_000 });
    await startBtn.click({ force: true });
    await startBtn.waitFor({ state: 'hidden', timeout: 30_000 });
}

export async function readSliderValue(slider: Locator): Promise<number> {
    const raw = await slider.getAttribute('aria-valuenow');
    return Number(raw ?? 0);
}

/**
 * Vertical drag on a hardware knob (up = increase). Uses the accessibility
 * slider overlay position as the knob center — the parent module captures input.
 */
export async function verticalDragKnob(
    page: Page,
    slider: Locator,
    deltaYPixels: number,
    options: { shift?: boolean; alt?: boolean } = {}
): Promise<void> {
    const box = await slider.boundingBox();
    if (!box) throw new Error('Knob slider has no bounding box');

    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const endY = cy - deltaYPixels;

    if (options.shift) await page.keyboard.down('Shift');
    if (options.alt) await page.keyboard.down('Alt');

    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx, endY, { steps: 10 });
    await page.mouse.up();

    if (options.alt) await page.keyboard.up('Alt');
    if (options.shift) await page.keyboard.up('Shift');
}
