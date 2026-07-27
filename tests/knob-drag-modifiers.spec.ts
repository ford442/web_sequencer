import { expect, test } from '@playwright/test';
import { initializeHyphonAudio, readSliderValue, verticalDragKnob } from './helpers/knob-e2e';

test.describe('knob drag modifiers', () => {
    test.fixme('shift coarse drag moves ~10× faster than normal; alt fine ~10× slower', async ({ page }) => {
        await initializeHyphonAudio(page);

        const cutoff = page.getByRole('slider', { name: /^CUTOFF/i }).first();
        await expect(cutoff).toBeVisible({ timeout: 30_000 });

        const start = await readSliderValue(cutoff);

        await verticalDragKnob(page, cutoff, 50);
        const afterNormal = await readSliderValue(cutoff);
        const normalDelta = afterNormal - start;
        expect(normalDelta).toBeGreaterThan(0);

        // Return toward start so the next gesture has headroom.
        await verticalDragKnob(page, cutoff, -45);

        const mid = await readSliderValue(cutoff);
        await verticalDragKnob(page, cutoff, 50, { shift: true });
        const afterCoarse = await readSliderValue(cutoff);
        const coarseDelta = afterCoarse - mid;

        expect(coarseDelta / normalDelta).toBeGreaterThan(6);
        expect(coarseDelta / normalDelta).toBeLessThan(14);

        await verticalDragKnob(page, cutoff, -45);

        const mid2 = await readSliderValue(cutoff);
        await verticalDragKnob(page, cutoff, 50, { alt: true });
        const afterFine = await readSliderValue(cutoff);
        const fineDelta = afterFine - mid2;

        expect(normalDelta / fineDelta).toBeGreaterThan(6);
        expect(normalDelta / fineDelta).toBeLessThan(14);
    });

    test.fixme('pressing shift mid-drag does not jump value until pointer moves', async ({ page }) => {
        await initializeHyphonAudio(page);

        const cutoff = page.getByRole('slider', { name: /^CUTOFF/i }).first();
        await expect(cutoff).toBeVisible({ timeout: 30_000 });

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
