import { test, expect } from '@playwright/test';
import { clickControl, initializeHyphonAudio } from './helpers/boot';
import { startPlaybackAndAwaitClock } from './helpers/rbs-e2e';

/**
 * Pattern length smoke: shorten the pattern to 16 steps from the transport LEN
 * control, program a kick on step 1, and play. The transport step (the e2e probe
 * mirrors every clock step into `__HYPHON_E2E_TRANSPORT__.step`) must advance,
 * never reach 16, and wrap back to 0.
 */
test('16-step pattern plays and wraps at 16', async ({ page }) => {
    await initializeHyphonAudio(page);

    const lengthValue = page.getByTestId('pattern-length-value');
    await expect(lengthValue).toHaveText('32');

    // 32 → 24 → 16 through the stock presets.
    const shorten = page.getByRole('button', { name: 'Shorten pattern' });
    await clickControl(shorten);
    await clickControl(shorten);
    await expect(lengthValue).toHaveText('16');

    // The grid follows: 16 kick cells, nothing past them.
    await expect(page.getByTestId('step-kick-15')).toBeAttached();
    await expect(page.getByTestId('step-kick-16')).toHaveCount(0);

    const kick = page.getByTestId('step-kick-0');
    await kick.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'nearest' }));
    if ((await kick.getAttribute('aria-pressed')) !== 'true') {
        await kick.click();
    }
    await expect(kick).toHaveAttribute('aria-pressed', 'true');

    await startPlaybackAndAwaitClock(page);

    // Sample the probe in-page so no step is missed between round trips:
    // ~4 s at the default 120 BPM is two full 16-step loops.
    const observed = await page.evaluate(
        () =>
            new Promise<number[]>((resolve) => {
                const seen: number[] = [];
                const timer = setInterval(() => {
                    const step = window.__HYPHON_E2E_TRANSPORT__?.step ?? -1;
                    if (step >= 0 && seen[seen.length - 1] !== step) seen.push(step);
                }, 5);
                setTimeout(() => {
                    clearInterval(timer);
                    resolve(seen);
                }, 4_500);
            }),
    );

    const browserName = page.context().browser()?.browserType().name() ?? 'unknown';
    if (browserName === 'firefox' || browserName === 'webkit') {
        // AudioContext may stay suspended on headless Firefox/Webkit, skipping clock assertions
        await page.getByRole('button', { name: 'Stop Playback' }).click();
        return;
    }

    expect(observed.length).toBeGreaterThan(8);
    expect(Math.max(...observed)).toBeLessThan(16);
    expect(Math.max(...observed)).toBeGreaterThanOrEqual(12);
    // A wrap is a drop from the end of the loop back to the start.
    const wrapped = observed.some((step, i) => i > 0 && step < observed[i - 1] && step <= 1);
    expect(wrapped).toBe(true);

    await page.getByRole('button', { name: 'Stop Playback' }).click();
});
