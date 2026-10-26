import { test, expect } from '@playwright/test';
import { initializeHyphonAudio } from './helpers/boot';
import { startPlaybackAndAwaitClock } from './helpers/rbs-e2e';

/**
 * Arrangement hello-world (#1342): program a kick on step 1, open ARR, add a
 * KICK clip of that pattern, arm the linear player and PLAY. The timeline
 * playhead must move, and the kick must be dispatched on the clip's first
 * song step (the e2e probe logs drum triggers with their song position).
 */
test('ARR: add a kick clip, play the arrangement, playhead moves, kick on clip start', async ({ page }) => {
    await initializeHyphonAudio(page);

    const kick = page.getByTestId('step-kick-0');
    await kick.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'nearest' }));
    if ((await kick.getAttribute('aria-pressed')) !== 'true') {
        await kick.click();
    }
    await expect(kick).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('button', { name: 'Toggle Arrangement' }).click();
    const timeline = page.getByRole('region', { name: 'Arrangement timeline' });
    await expect(timeline).toBeVisible();

    await timeline.getByRole('button', { name: 'Add KICK clip' }).click();
    const clip = timeline.getByRole('button', { name: /^KICK clip, pattern 1, at 1\.1\.1/ });
    await expect(clip).toHaveAttribute('aria-pressed', 'true');

    // Trim it to one beat from the keyboard (beat snap: 7 × −4 steps). The
    // default kick pattern is four-on-the-floor, so a kick on song step 4 or 8
    // would mean the trim is ignored.
    for (let i = 0; i < 7; i++) await clip.press('Shift+ArrowLeft');
    await expect(clip).toHaveAccessibleName(/4 steps/);

    const arm = timeline.getByRole('button', { name: 'Play the arrangement' });
    await arm.click();
    await expect(arm).toHaveAttribute('aria-pressed', 'true');

    await page.evaluate(() => { window.__HYPHON_E2E_DRUM_HITS__ = []; });
    await startPlaybackAndAwaitClock(page);

    // Collect playhead positions in-page so no step is missed between round trips.
    const playhead = page.getByTestId('arrangement-playhead');
    await playhead.evaluate((el) => {
        const steps: number[] = [];
        (window as Window & { __ARR_SEEN__?: number[] }).__ARR_SEEN__ = steps;
        new MutationObserver(() => {
            const s = Number((el as HTMLElement).dataset.step ?? -1);
            if (s >= 0 && steps[steps.length - 1] !== s) steps.push(s);
        }).observe(el, { attributes: true, attributeFilter: ['data-step'] });
    });
    await expect
        .poll(() => playhead.evaluate((el) => Number((el as HTMLElement).dataset.step ?? -1)), {
            timeout: 20_000,
            intervals: [100, 250],
        })
        .toBeGreaterThanOrEqual(10);

    const seen = await page.evaluate(() => (window as Window & { __ARR_SEEN__?: number[] }).__ARR_SEEN__ ?? []);
    expect(seen.length).toBeGreaterThanOrEqual(6);
    // Moves forward through the song (it is 32 steps long, so no wrap yet).
    expect(seen.every((s, i) => i === 0 || s > seen[i - 1])).toBe(true);

    const kicks = await page.evaluate(() =>
        (window.__HYPHON_E2E_DRUM_HITS__ ?? []).filter((h) => h.track === 'kick').map((h) => h.songStep),
    );
    expect(kicks).toContain(0);
    // Trimmed to 4 steps: nothing from the rest of the pattern.
    expect(kicks.filter((s) => s % 32 >= 4)).toEqual([]);

    await page.getByRole('button', { name: 'Stop Playback' }).click();
});
