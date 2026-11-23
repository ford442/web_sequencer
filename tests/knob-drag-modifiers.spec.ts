import { expect, test } from '@playwright/test';
import { initializeHyphonAudio, readSliderValue, verticalDragKnob } from './helpers/knob-e2e';

test.describe('knob drag modifiers', () => {
    test('shift coarse drag moves ~10× faster than normal; alt fine ~10× slower', async ({ page }) => {
        await initializeHyphonAudio(page);

        const cutoff = page.getByRole('slider', { name: /^CUTOFF/i }).first();
        await expect(cutoff).toBeVisible({ timeout: 30_000 });

        // aria-valuenow is an integer percent and clamps at 0..100, so a single drag length cannot
        // measure all three speeds: each pass uses a length that stays inside the range and is long
        // enough for rounding to be <5%, and the comparison is in value-per-pixel. Home resets the
        // knob to 0 so every pass has the full range above it.
        const ratePerPixel = async (px: number, modifier: { shift?: boolean; alt?: boolean }) => {
            await cutoff.focus();
            await cutoff.press('Home');
            const start = await readSliderValue(cutoff);
            await verticalDragKnob(page, cutoff, px, modifier);
            return (await readSliderValue(cutoff) - start) / px;
        };

        const normal = await ratePerPixel(20, {});
        expect(normal).toBeGreaterThan(0);

        const coarse = await ratePerPixel(6, { shift: true });
        expect(coarse / normal).toBeGreaterThan(6);
        expect(coarse / normal).toBeLessThan(14);

        const fine = await ratePerPixel(150, { alt: true });
        expect(fine).toBeGreaterThan(0);
        expect(normal / fine).toBeGreaterThan(6);
        expect(normal / fine).toBeLessThan(14);
    });

    test('pressing shift mid-drag does not jump value until pointer moves', async ({ page }) => {
        await initializeHyphonAudio(page);

        const cutoff = page.getByRole('slider', { name: /^CUTOFF/i }).first();
        await expect(cutoff).toBeVisible({ timeout: 30_000 });

        await cutoff.scrollIntoViewIfNeeded();
        const box = await cutoff.boundingBox();
        if (!box) throw new Error('no bounding box');

        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;

        await page.mouse.move(cx, cy);
        await page.mouse.down();
        await page.mouse.move(cx, cy - 30, { steps: 6 });
        const beforeShift = await readSliderValue(cutoff);

        await page.keyboard.down('Shift');
        await page.waitForTimeout(80);
        const afterShiftPress = await readSliderValue(cutoff);

        expect(afterShiftPress).toBe(beforeShift);

        await page.mouse.move(cx, cy - 60, { steps: 6 });
        const afterCoarseMove = await readSliderValue(cutoff);
        expect(afterCoarseMove).toBeGreaterThan(afterShiftPress);

        await page.keyboard.up('Shift');
        await page.mouse.up();
    });
});
