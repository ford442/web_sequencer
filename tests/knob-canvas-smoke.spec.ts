import { expect, test } from '@playwright/test';

// Mirrors KNOB_MATERIAL.palette.background (#0d0f13); kept literal so evaluate() stays browser-serializable.
const KNOB_BACKGROUND_RGB = [13, 15, 19] as const;
const NON_BACKGROUND_DELTA_TOLERANCE = 6;
const PIXEL_SAMPLE_GRID_DIVISOR = 12;

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
                knobCanvas.evaluate((canvas, { backgroundRgb, deltaTolerance }) => {
                    const ctx = canvas.getContext('2d');
                    if (!ctx) return 0;
                    let nonBgCount = 0;
                    const step = Math.max(
                        1,
                        Math.floor(Math.min(canvas.width, canvas.height) / PIXEL_SAMPLE_GRID_DIVISOR)
                    );
                    for (let y = 0; y < canvas.height; y += step) {
                        for (let x = 0; x < canvas.width; x += step) {
                            const px = ctx.getImageData(x, y, 1, 1).data;
                            const delta =
                                Math.abs(px[0] - backgroundRgb[0]) +
                                Math.abs(px[1] - backgroundRgb[1]) +
                                Math.abs(px[2] - backgroundRgb[2]);
                            if (delta > deltaTolerance) nonBgCount++;
                        }
                    }
                    return nonBgCount;
                }, { backgroundRgb: KNOB_BACKGROUND_RGB, deltaTolerance: NON_BACKGROUND_DELTA_TOLERANCE }),
            { timeout: 10000 }
        )
        .toBeGreaterThan(0);
});
