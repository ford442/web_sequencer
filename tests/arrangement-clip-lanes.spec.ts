import { test, expect } from '@playwright/test';
import { initializeHyphonAudio } from './helpers/boot';
import { startPlaybackAndAwaitClock } from './helpers/rbs-e2e';

/**
 * Clip-local automation (#1494): drop a LEAD clip, draw a filter sweep on the
 * clip's own lane, play the arrangement. The timeline playhead must move and
 * the automated CUTOFF control must follow the clip lane.
 */
test('ARR: draw a clip lane, play, playhead and the automated control move', async ({ page }) => {
    await initializeHyphonAudio(page);

    await page.getByRole('button', { name: 'Toggle Arrangement' }).click();
    const timeline = page.getByRole('region', { name: 'Arrangement timeline' });
    await expect(timeline).toBeVisible();

    await timeline.getByRole('button', { name: 'Add LEAD clip' }).click();
    const clip = timeline.getByRole('button', { name: /^LEAD clip, pattern \d+, at 1\.1\.1/ });
    await expect(clip).toHaveAttribute('aria-pressed', 'true');

    const panel = timeline.getByRole('group', { name: 'Clip automation' });
    await panel.getByRole('button', { name: '+ LANE' }).click();
    const editor = panel.getByRole('img', { name: /Curve editor for Cutoff/ });
    await expect(editor).toBeVisible();

    // A rising sweep: closed at the clip's left edge, open at its right edge.
    const box = await editor.boundingBox();
    if (!box) throw new Error('curve editor has no box');
    await editor.click({ position: { x: 10, y: box.height - 24 } });
    await editor.click({ position: { x: box.width - 10, y: 14 } });
    await expect(panel.getByRole('button', { name: /Cutoff · 2pts/ })).toBeVisible();
    await expect(clip).toHaveAccessibleName(/automated$/);

    const arm = timeline.getByRole('button', { name: 'Play the arrangement' });
    await arm.click();
    await expect(arm).toHaveAttribute('aria-pressed', 'true');

    // Record what the CUTOFF control shows on every change, in-page.
    await page.evaluate(() => {
        const seen: number[] = [];
        (window as Window & { __CUTOFF_SEEN__?: number[] }).__CUTOFF_SEEN__ = seen;
        const record = () => {
            const knob = document.querySelector('[role="slider"][aria-label="CUTOFF (automated)"]');
            const v = Number(knob?.getAttribute('aria-valuenow'));
            if (knob && Number.isFinite(v) && seen[seen.length - 1] !== v) seen.push(v);
        };
        new MutationObserver(record).observe(document.body, {
            subtree: true,
            attributes: true,
            attributeFilter: ['aria-valuenow', 'aria-label'],
        });
    });

    await startPlaybackAndAwaitClock(page);

    const playhead = page.getByTestId('arrangement-playhead');
    await expect
        .poll(() => playhead.evaluate((el) => Number((el as HTMLElement).dataset.step ?? -1)), {
            timeout: 20_000,
            intervals: [100, 250],
        })
        .toBeGreaterThanOrEqual(10);

    const automated = page.getByRole('slider', { name: 'CUTOFF (automated)' }).first();
    await expect(automated).toBeAttached();
    await expect
        .poll(
            () => page.evaluate(() => new Set((window as Window & { __CUTOFF_SEEN__?: number[] }).__CUTOFF_SEEN__ ?? []).size),
            { timeout: 20_000, intervals: [250, 500] },
        )
        .toBeGreaterThanOrEqual(3);

    await page.getByRole('button', { name: 'Stop Playback' }).click();
});
