import { expect, test } from '@playwright/test';

/**
 * Expandable hardware chassis review (#1580). `?visual-review=1` renders the
 * showcase alone (no audio boot), so this runs in seconds.
 *
 * Gate = computed styles + layout; screenshots of the light and dark surfaces
 * are attached as artifacts only (baselines churn across runners — see the
 * #1589 expansion in docs/dispatch/2026-11-09-issue-1589-expanded.md).
 */
test.describe('chassis showcase', () => {
    test.skip(({ browserName }) => browserName !== 'chromium', 'visual review runs on chromium only');

    test.beforeEach(async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto('/?visual-review=1');
        await expect(page.getByRole('heading', { name: 'HYPHON VISUAL REVIEW' })).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
    });

    test('white chassis tokens apply only under data-chassis', async ({ page }) => {
        const chassis = page.locator('section[data-chassis="white"]');
        await expect(chassis).toHaveCount(1);
        const tokens = await chassis.evaluate((el) => {
            const cs = getComputedStyle(el);
            return {
                print: cs.getPropertyValue('--chassis-print').trim(),
                body: cs.getPropertyValue('--chassis-body').trim(),
                backgroundImage: cs.backgroundImage,
            };
        });
        expect(tokens.print).toBe('#b3262e');
        expect(tokens.body).toBe('#eceef0');
        expect(tokens.backgroundImage).toContain('linear-gradient');

        // The legacy dark shell on the same page is untouched.
        const dark = await page.locator('.hyphon-rack-shell').first().evaluate((el) => {
            const cs = getComputedStyle(el);
            return { token: cs.getPropertyValue('--chassis-print').trim(), bg: cs.backgroundImage };
        });
        expect(dark.token).toBe('');
        expect(dark.bg).toContain('rgb(0, 0, 0)');
    });

    test('mode keys morph the stage while the LED strip and key bed stay anchored', async ({ page }) => {
        const stage = page.getByTestId('chassis-stage');
        const strip = page.locator('.hyphon-chassis__strip');
        // Offset of the LED strip from the top of the body (scroll-independent).
        const stripOffset = () => strip.evaluate((el) => (
            el.getBoundingClientRect().top - el.closest('section')!.getBoundingClientRect().top
        ));
        const before = await stripOffset();
        await expect.poll(async () => (await stage.boundingBox())?.height).toBeCloseTo(380, 0);

        await page.getByTestId('chassis-mode-vd').click();
        await expect(page.getByTestId('chassis-mode-badge')).toContainText('VD');
        await expect.poll(async () => (await stage.boundingBox())?.height).toBeCloseTo(520, 0);
        expect(await stripOffset()).toBeCloseTo(before, 0);

        await page.getByTestId('chassis-mode-pcf').click();
        await expect.poll(async () => (await stage.boundingBox())?.height).toBeCloseTo(320, 0);
        await expect(page.locator('.hyphon-chassis__keybed')).toBeVisible();
    });

    test('oscillator family swaps the public/osc panel art', async ({ page }) => {
        const art = page.getByTestId('chassis-showcase').getByTestId('oscillator-panel-art');
        await expect(art).toHaveAttribute('data-osc-type', 'javascript');
        await page.getByRole('group', { name: 'Oscillator family' }).getByRole('button', { name: /PRO/ }).click();
        await expect(art).toHaveAttribute('data-osc-type', 'prophecy');
        const img = art.locator('img');
        await expect(img).toHaveAttribute('src', /osc\/prophecy\.webp$/);
        await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    });

    test('chassis knobs render a lit cap (canvas is not blank) — screenshots attached', async ({ page }, testInfo) => {
        const surface = page.getByTestId('chassis-white-surface');
        const canvas = surface.locator('canvas').last();
        await expect(canvas).toBeVisible();
        // 2D fallback or WebGPU — either way the canvas has painted pixels.
        await expect.poll(() => canvas.evaluate((el: HTMLCanvasElement) => el.width > 0 && el.height > 0)).toBe(true);

        for (const [name, testId] of [
            ['chassis-osc', 'chassis-showcase'],
            ['knobs-light-dark', 'chassis-knob-showcase'],
            ['panel-art', 'chassis-art-showcase'],
        ] as const) {
            await testInfo.attach(name, {
                body: await page.getByTestId(testId).screenshot({ animations: 'disabled' }),
                contentType: 'image/png',
            });
        }
    });
});
