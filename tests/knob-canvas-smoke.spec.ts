import { expect, test, type Locator } from '@playwright/test';
import { initializeHyphonAudio } from './helpers/boot';

// Mirrors KNOB_MATERIAL.palette.background (#0d0f13); kept literal so evaluate() stays browser-serializable.
const KNOB_BACKGROUND_RGB = [13, 15, 19] as const;
const NON_BACKGROUND_DELTA_TOLERANCE = 6;
const PIXEL_SAMPLE_GRID_DIVISOR = 12;

async function sampleKnobCanvasPixels(
    knobCanvas: Locator,
    options: {
        backgroundRgb: readonly [number, number, number];
        deltaTolerance: number;
        gridDivisor: number;
    }
): Promise<number> {
    return knobCanvas.evaluate(
        (canvas, { backgroundRgb, deltaTolerance, gridDivisor }) => {
            const ctx = canvas.getContext('2d');
            if (!ctx) return 0;
            let nonBgCount = 0;
            const step = Math.max(
                1,
                Math.floor(Math.min(canvas.width, canvas.height) / gridDivisor)
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
        },
        {
            backgroundRgb: options.backgroundRgb,
            deltaTolerance: options.deltaTolerance,
            gridDivisor: options.gridDivisor,
        }
    );
}

test('hardware knob renders on forced Canvas2D fallback', async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'gpu', {
            configurable: true,
            get: () => undefined,
        });
    });

    await initializeHyphonAudio(page);

    const knobCanvas = page.locator('[data-testid^="hardware-knob-canvas-"]').first();
    await expect(knobCanvas).toBeVisible({ timeout: 30_000 });

    await expect
        .poll(
            async () =>
                sampleKnobCanvasPixels(knobCanvas, {
                    backgroundRgb: KNOB_BACKGROUND_RGB,
                    deltaTolerance: NON_BACKGROUND_DELTA_TOLERANCE,
                    gridDivisor: PIXEL_SAMPLE_GRID_DIVISOR,
                }),
            { timeout: 10_000 }
        )
        .toBeGreaterThan(0);
});

test.fixme('hardware knob canvas tracks live automated value on Canvas2D fallback', async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'gpu', {
            configurable: true,
            get: () => undefined,
        });
    });

    await initializeHyphonAudio(page);

    const cutoffCanvas = page.getByTestId('hardware-knob-canvas-filterCutoff');
    await expect(cutoffCanvas).toBeVisible({ timeout: 30_000 });

    await page.evaluate(() => {
        const hooks = (window as unknown as {
            __HYPHON_E2E__?: { setLiveAutomatedValue: (t: string, p: string, v: number) => void };
        }).__HYPHON_E2E__;
        hooks?.setLiveAutomatedValue('synthA', 'filterCutoff', 0.15);
    });

    await expect(page.getByText('AUTO').first()).toBeVisible({ timeout: 5_000 });

    await expect
        .poll(
            async () =>
                sampleKnobCanvasPixels(cutoffCanvas, {
                    backgroundRgb: KNOB_BACKGROUND_RGB,
                    deltaTolerance: NON_BACKGROUND_DELTA_TOLERANCE,
                    gridDivisor: PIXEL_SAMPLE_GRID_DIVISOR,
                }),
            { timeout: 10_000 }
        )
        .toBeGreaterThan(0);

    const lowSample = await sampleKnobCanvasPixels(cutoffCanvas, {
        backgroundRgb: KNOB_BACKGROUND_RGB,
        deltaTolerance: NON_BACKGROUND_DELTA_TOLERANCE,
        gridDivisor: PIXEL_SAMPLE_GRID_DIVISOR,
    });

    await page.evaluate(() => {
        const hooks = (window as unknown as {
            __HYPHON_E2E__?: { setLiveAutomatedValue: (t: string, p: string, v: number) => void };
        }).__HYPHON_E2E__;
        hooks?.setLiveAutomatedValue('synthA', 'filterCutoff', 0.95);
    });

    await expect
        .poll(
            async () => {
                const high = await sampleKnobCanvasPixels(cutoffCanvas, {
                    backgroundRgb: KNOB_BACKGROUND_RGB,
                    deltaTolerance: NON_BACKGROUND_DELTA_TOLERANCE,
                    gridDivisor: PIXEL_SAMPLE_GRID_DIVISOR,
                });
                return high !== lowSample;
            },
            { timeout: 10_000 }
        )
        .toBe(true);
});
