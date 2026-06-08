import { expect, test } from '@playwright/test';

test('hardware knob renders on forced Canvas2D fallback', async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'gpu', {
            configurable: true,
            get: () => undefined,
        });
    });

    await page.goto('/');

    const startBtn = page.getByRole('button', { name: 'INITIALIZE SYSTEM' });
    await startBtn.waitFor({ state: 'visible', timeout: 90000 });
    await expect(startBtn).toBeEnabled({ timeout: 90000 });
    await startBtn.click({ force: true });
    await startBtn.waitFor({ state: 'hidden', timeout: 30000 });

    const knobCanvas = page.locator('[data-testid^="hardware-knob-canvas-"]').first();
    await expect(knobCanvas).toBeVisible({ timeout: 30000 });

    await expect
        .poll(
            async () =>
                knobCanvas.evaluate((canvas) => {
                    const ctx = canvas.getContext('2d');
                    if (!ctx) return 0;
                    const bg = [13, 15, 19]; // #0d0f13 from KNOB_MATERIAL.palette.background
                    let nonBgCount = 0;
                    const step = Math.max(1, Math.floor(Math.min(canvas.width, canvas.height) / 12));
                    for (let y = 0; y < canvas.height; y += step) {
                        for (let x = 0; x < canvas.width; x += step) {
                            const px = ctx.getImageData(x, y, 1, 1).data;
                            const delta = Math.abs(px[0] - bg[0]) + Math.abs(px[1] - bg[1]) + Math.abs(px[2] - bg[2]);
                            if (delta > 6) nonBgCount++;
                        }
                    }
                    return nonBgCount;
                }),
            { timeout: 10000 }
        )
        .toBeGreaterThan(0);
});
