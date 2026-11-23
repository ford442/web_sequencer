import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { dismissHelpTips } from './helpers/boot';
import { ReleaseGuard, formatFindings } from './helpers/release-guard';
import {
    VIEWPORTS,
    auditLayout,
    blurryCanvases,
    installClsObserver,
    readCls,
    settle,
    type Viewport,
} from './helpers/visual';

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
        await expect.poll(async () => (await stage.boundingBox())?.height).toBeCloseTo(720, 0);
        expect(await stripOffset()).toBeCloseTo(before, 0);

        await page.getByTestId('chassis-mode-pcf').click();
        await expect.poll(async () => (await stage.boundingBox())?.height).toBeCloseTo(320, 0);
        await expect(page.locator('.hyphon-chassis__keybed')).toBeVisible();
    });

    test('PCF opens a side secondary and the panel holds the stage target size (#1584)', async ({ page }) => {
        const stage = page.getByTestId('chassis-stage');
        await page.getByTestId('chassis-mode-pcf').click();
        const secondary = page.getByTestId('chassis-secondary');
        await expect(secondary).toBeVisible();
        await expect(secondary).toHaveAttribute('data-placement', 'side');
        await expect.poll(async () => (await stage.boundingBox())?.height).toBeCloseTo(320, 0);

        // Primary and secondary split the stage side by side; the panel matches the stage.
        const [stageBox, primaryBox, secondaryBox, panelBox] = await Promise.all([
            stage.boundingBox(),
            page.getByTestId('chassis-primary').boundingBox(),
            secondary.boundingBox(),
            page.locator('.hyphon-chassis__panel').boundingBox(),
        ]);
        expect(panelBox!.width).toBeCloseTo(stageBox!.width, 0);
        expect(panelBox!.height).toBeCloseTo(stageBox!.height, 0);
        expect(secondaryBox!.x).toBeGreaterThan(primaryBox!.x + primaryBox!.width - 1);
        expect(secondaryBox!.y).toBeCloseTo(primaryBox!.y, 0);

        // #1586: the real filter plate + patch bay, against the page's offline patch.
        await expect(page.getByTestId('chassis-primary').getByTestId('chassis-pcf-plate')).toBeVisible();
        await expect(secondary.getByTestId('chassis-patch-deck')).toBeVisible();
        await expect(page.getByTestId('pcf-panel')).toHaveAttribute('data-surface', 'chassis');
        await expect(secondary.getByRole('application', { name: /audio routing graph/i })).toBeVisible();

        await page.getByTestId('chassis-mode-osc').click();
        await expect(secondary).toHaveCount(0);
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


/* ────────────────────────────────────────────────────────────────────────────────────────────
 * Release 3/5: viewport × state visual-regression matrix.
 *
 * Runs against `vite preview` of dist/ by default, or a deployed build with
 *   DEPLOY_SMOKE_URL=https://host/hyphon-staging/ pnpm exec playwright test tests/visual-showcase.spec.ts
 * (every URL is relative, so a sub-folder deployment works).
 *
 * Two kinds of check, on purpose:
 *   1. LAYOUT FACTS (all browsers): no horizontal page scroll, no clipped header control, header
 *      never overlaps the scrolling region, touch targets >= 32px on a coarse pointer, zero
 *      unexpected console errors / failed requests. These are measured, not diffed, so they hold
 *      across Chromium, Firefox and WebKit without per-engine tolerance.
 *   2. PIXEL BASELINES (Linux, Chromium + Firefox): `toHaveScreenshot` against files committed in
 *      tests/__screenshots__/visual-showcase.spec.ts/<project>/. Regenerate on purpose with
 *      `pnpm run test:visual:update` (run on Linux; CI renders on ubuntu). WebKit has layout facts
 *      only until its baselines are generated on a runner that can launch it.
 *
 * Screenshots are always attached to the report too, which is what the "State of the App" grid reads.
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

const VISUAL_OUT = process.env.VISUAL_OUT ?? 'visual-report';
const COMPARE_PIXELS = process.platform === 'linux';
const SCREENSHOT_OPTS = {
    animations: 'disabled',
    caret: 'hide',
    // Anti-aliasing and GPU-less canvas rasterisation differ by a few pixels run to run; a layout
    // regression moves thousands.
    maxDiffPixelRatio: 0.02,
} as const;

/** Console / network findings that a state triggers ON PURPOSE. Everything else must be zero. */
const INTENTIONAL: Record<string, RegExp[]> = {
    always: [
        // Firefox / WebKit have no navigator.gpu at all; Chromium without an adapter is allowlisted in release-guard.
        /\[EngineFallback\] webgpu: .*navigator\.gpu unavailable/,
    ],
    'no-webgpu': [/\[EngineFallback\] webgpu: /],
    'wasm-fallback': [
        /\[EngineFallback\] /,
        /hyphon_native.*\.wasm/,
        /Failed to load resource/,
        /Failed to fetch/,
        /ERR_FAILED/,
    ],
};

type Captured = { state: string; viewport: string; browser: string; intentional: string[]; layout: unknown };
const captured: Captured[] = [];

test.afterAll(() => {
    if (captured.length === 0) return;
    mkdirSync(VISUAL_OUT, { recursive: true });
    writeFileSync(join(VISUAL_OUT, `states-${test.info().project.name}.json`), JSON.stringify(captured, null, 2));
});

async function newPage(
    browser: import('@playwright/test').Browser,
    vp: Viewport,
    opts: { dpr?: number; init?: (page: Page) => Promise<void> } = {},
): Promise<{ context: BrowserContext; page: Page; guard: ReleaseGuard }> {
    const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: opts.dpr ?? 1,
        hasTouch: vp.touch,
        reducedMotion: 'reduce',
        // Off by default (a deployed build must have a valid certificate). Only for a sandbox whose egress proxy
        // re-signs TLS and whose Firefox does not trust that CA: VISUAL_IGNORE_HTTPS_ERRORS=1.
        ignoreHTTPSErrors: process.env.VISUAL_IGNORE_HTTPS_ERRORS === '1',
    });
    const guard = new ReleaseGuard();
    guard.attach(context);
    const page = await context.newPage();
    await opts.init?.(page);
    return { context, page, guard };
}

/** The transport's play / stop button: the header one from 640px up, the dock one on a phone (only one is rendered visible). */
const playToggle = (page: Page) => page.getByRole('button', { name: /^(start|stop) playback$/i });

async function openApp(page: Page, query = 'e2e=1'): Promise<void> {
    await page.goto(query ? `./?${query}` : './');
    await page.getByTestId('start-overlay').waitFor({ state: 'visible', timeout: 90_000 });
    await page.evaluate(() => document.fonts.ready);
}

async function enterApp(page: Page): Promise<void> {
    const start = page.getByTestId('initialize-system');
    await expect(start).toBeEnabled({ timeout: 180_000 });
    await start.click();
    await page.getByTestId('start-overlay').waitFor({ state: 'hidden', timeout: 30_000 });
    await expect(page.getByText('INITIALIZING AUDIO ENGINE')).toBeHidden({ timeout: 120_000 });
    await expect(playToggle(page)).toBeVisible({ timeout: 30_000 });
    // First-run chrome (What's New, help pins) is a legitimate state but not what a layout baseline is about.
    const whatsNew = page.getByRole('button', { name: /Dismiss what's new/i });
    if (await whatsNew.isVisible().catch(() => false)) await whatsNew.click().catch(() => undefined);
    await dismissHelpTips(page);
    await settle(page);
}

/** Layout facts every captured state must satisfy. */
async function expectSoundLayout(page: Page, vp: Viewport, label: string): Promise<unknown> {
    const audit = await auditLayout(page);
    expect.soft(audit.pageOverflowX, `${label}: horizontal page scroll`).toBe(0);
    expect.soft(audit.headerClipped, `${label}: header controls clipped by the window edge`).toEqual([]);
    expect.soft(audit.bottomBarClipped, `${label}: bottom-bar controls clipped by the window edge`).toEqual([]);
    expect.soft(audit.headerOverlapsMain, `${label}: header overlaps the scrolling region`).toBe(false);
    if (audit.coarse) expect.soft(audit.smallTargets, `${label}: touch targets under 32px`).toEqual([]);
    if (vp.width < 600) expect.soft(page.getByTestId('phone-notice'), `${label}: phone notice`).toBeVisible();
    else expect.soft(page.getByTestId('phone-notice'), `${label}: phone notice must not show on a tablet`).toHaveCount(0);
    return audit;
}

async function snapshot(page: Page, testInfo: import('@playwright/test').TestInfo, name: string): Promise<void> {
    const png = await page.screenshot({ animations: 'disabled', caret: 'hide' });
    await testInfo.attach(name, { body: png, contentType: 'image/png' });
    // Also keep a plain file per browser: scripts/visual-report.mjs builds the "State of the App" grid from these.
    const dir = join(VISUAL_OUT, testInfo.project.name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${name}.png`), png);
    // WebKit baselines are not generated yet (it cannot launch on the machine that made the others).
    if (COMPARE_PIXELS && testInfo.project.name !== 'webkit') {
        await expect(page).toHaveScreenshot(`${name}.png`, SCREENSHOT_OPTS);
    }
}

function assertNoUnexpected(guard: ReleaseGuard, state: string, testInfo: import('@playwright/test').TestInfo) {
    const patterns = [...INTENTIONAL.always, ...(INTENTIONAL[state] ?? [])];
    const fresh = guard.drain();
    const intentional = fresh.filter((f) => patterns.some((re) => re.test(f.detail)));
    const unexpected = fresh.filter((f) => !intentional.includes(f));
    void testInfo.attach(`console-intentional-${state}`, {
        body: JSON.stringify(intentional.map((f) => `${f.kind}: ${f.detail}`), null, 2),
        contentType: 'application/json',
    });
    expect(unexpected, `unexpected console/network findings in "${state}":\n${formatFindings(unexpected)}`).toEqual([]);
    return intentional.map((f) => `${f.kind}: ${f.detail}`);
}

test.describe('viewport matrix', () => {
    test.describe.configure({ mode: 'serial' });

    for (const vp of VIEWPORTS) {
        test.describe(vp.name, () => {
            test(`boot overlay @ ${vp.name}`, async ({ browser }, testInfo) => {
                const { context, page, guard } = await newPage(browser, vp);
                try {
                    await openApp(page);
                    await expect(page.getByTestId('initialize-system')).toBeEnabled({ timeout: 180_000 });
                    await settle(page);
                    // The boot card must be fully on screen, whatever the size.
                    const card = await page.getByTestId('initialize-system').boundingBox();
                    expect(card!.x).toBeGreaterThanOrEqual(0);
                    expect(card!.x + card!.width).toBeLessThanOrEqual(vp.width);
                    const layout = await expectSoundLayout(page, vp, `boot ${vp.name}`);
                    await snapshot(page, testInfo, `boot-${vp.name}`);
                    captured.push({ state: 'boot', viewport: vp.name, browser: testInfo.project.name, intentional: assertNoUnexpected(guard, 'boot', testInfo), layout });
                } finally {
                    await context.close();
                }
            });

            test(`main sequencer, then playing @ ${vp.name}`, async ({ browser, browserName }, testInfo) => {
                const { context, page, guard } = await newPage(browser, vp);
                try {
                    await openApp(page);
                    await enterApp(page);
                    const layout = await expectSoundLayout(page, vp, `main ${vp.name}`);
                    await snapshot(page, testInfo, `main-${vp.name}`);
                    captured.push({ state: 'main', viewport: vp.name, browser: testInfo.project.name, intentional: assertNoUnexpected(guard, 'main', testInfo), layout });

                    // Firefox without an audio sink never starts its AudioContext clock (tests/global-setup.ts):
                    // the playing phase would only measure the missing sink, so it is skipped there, loudly.
                    if (browserName === 'firefox' && process.env.HYPHON_E2E_NO_AUDIO_SINK === '1') {
                        testInfo.annotations.push({ type: 'skipped-phase', description: 'playing: no audio sink for Firefox on this host' });
                        return;
                    }
                    // Playing: not a pixel baseline (the playhead moves), but the layout must hold and
                    // a current step must light up.
                    await playToggle(page).click();
                    await expect(playToggle(page)).toHaveAccessibleName(/^stop playback$/i);
                    await expect(page.locator('.svg-step.is-current').first()).toBeAttached({ timeout: 15_000 });
                    const playing = await expectSoundLayout(page, vp, `playing ${vp.name}`);
                    await testInfo.attach(`playing-${vp.name}`, { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
                    await playToggle(page).click();
                    captured.push({ state: 'playing', viewport: vp.name, browser: testInfo.project.name, intentional: assertNoUnexpected(guard, 'playing', testInfo), layout: playing });
                } finally {
                    await context.close();
                }
            });
        });
    }
});

/** States that are not about size: two viewports each (a desktop and a tablet) keep the baseline set reviewable. */
const STATE_VIEWPORTS = VIEWPORTS.filter((v) => v.name === '1280x720' || v.name === '768x1024');

test.describe('designed states', () => {
    for (const vp of STATE_VIEWPORTS) {
        test(`wasm load failure @ ${vp.name}`, async ({ browser }, testInfo) => {
            const { context, page, guard } = await newPage(browser, vp, {
                init: async (p) => { await p.route(/hyphon_native.*\.wasm$/, (r) => r.abort()); },
            });
            try {
                await openApp(page);
                await expect(page.getByTestId('initialize-system')).toBeEnabled({ timeout: 180_000 });
                // The boot card says so in words, and still lets the person in on the JS engines.
                await expect(page.getByTestId('start-overlay')).toContainText(/JS FALLBACK/);
                await settle(page);
                await expectSoundLayout(page, vp, `wasm-fail boot ${vp.name}`);
                await snapshot(page, testInfo, `state-wasm-fallback-boot-${vp.name}`);
                await enterApp(page);
                await expect(page.getByLabel('Engine degradation warnings')).toContainText(/hyphon-native|fallback/i);
                await snapshot(page, testInfo, `state-wasm-fallback-main-${vp.name}`);
                assertNoUnexpected(guard, 'wasm-fallback', testInfo);
            } finally {
                await context.close();
            }
        });

        test(`no WebGPU: CPU fallback notice @ ${vp.name}`, async ({ browser }, testInfo) => {
            const { context, page, guard } = await newPage(browser, vp, {
                init: async (p) => {
                    await p.addInitScript(() => {
                        try { Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true }); } catch { /* already absent */ }
                    });
                },
            });
            try {
                await openApp(page);
                await enterApp(page);
                const banner = page.getByLabel('Engine degradation warnings');
                await expect(banner).toBeVisible();
                await expect(banner).toContainText(/webgpu/i);
                await expectSoundLayout(page, vp, `no-webgpu ${vp.name}`);
                await snapshot(page, testInfo, `state-no-webgpu-${vp.name}`);
                assertNoUnexpected(guard, 'no-webgpu', testInfo);
            } finally {
                await context.close();
            }
        });

        test(`audio context blocked @ ${vp.name}`, async ({ browser, browserName }, testInfo) => {
            test.skip(browserName !== 'chromium', 'forcing a permanently suspended context hangs the non-Chromium engine boot; covered by tests/audio-context-matrix.spec.ts');
            const { context, page, guard } = await newPage(browser, vp, {
                init: async (p) => {
                    await p.addInitScript(() => {
                        Object.defineProperty(BaseAudioContext.prototype, 'state', { get: () => 'suspended', configurable: true });
                        AudioContext.prototype.resume = () => Promise.reject(new DOMException('blocked by autoplay policy', 'NotAllowedError'));
                    });
                },
            });
            try {
                // No ?e2e=1: that flag replaces resume() with a non-blocking stub and would hide the state.
                await openApp(page, '');
                await enterApp(page);
                // Actionable text stays in view, not folded behind "details".
                await expect(page.getByLabel('Engine degradation warnings').getByText(/Audio is suspended/).first()).toBeVisible();
                await expectSoundLayout(page, vp, `audio-blocked ${vp.name}`);
                await snapshot(page, testInfo, `state-audio-blocked-${vp.name}`);
                assertNoUnexpected(guard, 'no-webgpu', testInfo);
            } finally {
                await context.close();
            }
        });

        test(`empty arrangement and empty sample bank @ ${vp.name}`, async ({ browser }, testInfo) => {
            const { context, page, guard } = await newPage(browser, vp);
            try {
                await openApp(page);
                await enterApp(page);
                await page.getByRole('button', { name: 'Toggle Arrangement' }).click();
                const arrangement = page.getByRole('region', { name: 'Arrangement timeline' });
                await expect(arrangement).toBeVisible();
                // The panel must start BELOW the header: a taller (wrapped) header used to end up underneath
                // it, covering the very button that opens it.
                const [headerBox, panelBox] = await Promise.all([
                    page.locator('.transport-toolbar').boundingBox(),
                    arrangement.boundingBox(),
                ]);
                expect(panelBox!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height - 1);
                await expect(page.getByRole('button', { name: 'Toggle Arrangement' })).toBeVisible();
                await settle(page);
                await snapshot(page, testInfo, `state-arrangement-empty-${vp.name}`);
                await page.getByRole('button', { name: 'Toggle Arrangement' }).click();

                await page.getByRole('rowheader', { name: /SMP 1/ }).dispatchEvent('click');
                await page.locator('.hyphon-rack-shell').first().scrollIntoViewIfNeeded();
                await settle(page);
                await snapshot(page, testInfo, `state-sample-bank-empty-${vp.name}`);
                assertNoUnexpected(guard, 'main', testInfo);
            } finally {
                await context.close();
            }
        });

        test(`Voice Designer, TTS models missing @ ${vp.name}`, async ({ browser }, testInfo) => {
            const { context, page, guard } = await newPage(browser, vp);
            try {
                await openApp(page);
                await enterApp(page);
                await page.getByRole('rowheader', { name: /SMP 1/ }).dispatchEvent('click');
                const open = page.getByRole('button', { name: /Open Voice Editor/i }).first();
                await open.scrollIntoViewIfNeeded();
                // The knob REC overlay can sit over this button's centre (see tests/helpers/boot.ts clickControl).
                await open.dispatchEvent('click');
                const dialog = page.getByRole('dialog', { name: /Voice Designer/i });
                await expect(dialog).toBeVisible();
                await settle(page);
                const box = await dialog.boundingBox();
                expect(box!.x).toBeGreaterThanOrEqual(0);
                expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width + 1);
                await snapshot(page, testInfo, `state-voice-designer-${vp.name}`);
                assertNoUnexpected(guard, 'main', testInfo);
            } finally {
                await context.close();
            }
        });

        test(`missing WAM plugin is reported, not silent @ ${vp.name}`, async ({ browser }, testInfo) => {
            const { context, page, guard } = await newPage(browser, vp);
            try {
                await openApp(page);
                await enterApp(page);
                await page.evaluate(async () => {
                    const hooks = (window as unknown as { __HYPHON_E2E__?: { restoreWam2SongState?: (p: unknown) => Promise<void> | null } }).__HYPHON_E2E__;
                    await hooks?.restoreWam2SongState?.({
                        schema: 1,
                        plugins: [{
                            slotId: 'visual-missing-slot', packageId: 'definitely.not.installed', version: '9.9.9',
                            integrity: { alg: 'sha256', value: 'f'.repeat(64) }, placement: 'trackInsert',
                            attachToNodeId: 'masterSaturation', interceptFromNodeId: 'synthABus', paramState: {},
                        }],
                    });
                });
                // The person is told in words, in the toast and in the banner.
                await expect(page.getByLabel('Engine degradation warnings')).toContainText(/wam2/i);
                await expectSoundLayout(page, vp, `wam-missing ${vp.name}`);
                await snapshot(page, testInfo, `state-wam-missing-${vp.name}`);
                assertNoUnexpected(guard, 'main', testInfo);
            } finally {
                await context.close();
            }
        });
    }
});

test.describe('rendering quality', () => {
    const desktop = VIEWPORTS.find((v) => v.name === '1280x720')!;

    for (const dpr of [1, 2]) {
        test(`knob and meter canvases are crisp at devicePixelRatio ${dpr}`, async ({ browser }) => {
            const { context, page } = await newPage(browser, desktop, { dpr });
            try {
                await openApp(page);
                await enterApp(page);
                const actualDpr = await page.evaluate(() => window.devicePixelRatio);
                // This headless Firefox build ignores deviceScaleFactor; say so rather than assert on nothing.
                test.skip(actualDpr !== dpr, `browser did not apply devicePixelRatio ${dpr} (got ${actualDpr})`);
                const total = await page.locator('canvas:visible').count();
                expect(total, 'expected the rack knobs to be on screen').toBeGreaterThan(0);
                expect(await blurryCanvases(page)).toEqual([]);
                // A DPR change mid-session (dragging the window between monitors) must not leave stale backing stores.
                await page.setViewportSize({ width: 1100, height: 700 });
                await expect.poll(() => blurryCanvases(page), { timeout: 5_000 }).toEqual([]);
            } finally {
                await context.close();
            }
        });
    }

    test('no layout shift once fonts and images have loaded', async ({ browser, browserName }) => {
        test.skip(browserName !== 'chromium', 'the layout-shift API is Chromium-only');
        const { context, page } = await newPage(browser, desktop, { init: installClsObserver });
        try {
            await openApp(page);
            await enterApp(page);
            await page.evaluate(() => document.fonts.ready);
            await page.waitForTimeout(1_000);
            const cls = await readCls(page);
            expect(cls, 'layout-shift observer did not run').not.toBeNull();
            // Google's "good" threshold is 0.1; the boot sequence replaces a card with the whole app, so
            // hold the score to the same bar rather than excusing it.
            expect(cls!).toBeLessThan(0.1);
        } finally {
            await context.close();
        }
    });

    test('3D studio canvas follows the window size', async ({ browser, browserName }) => {
        test.skip(browserName !== 'chromium', 'WebGL in headless Firefox/WebKit CI is not reliable');
        const { context, page } = await newPage(browser, desktop);
        try {
            await openApp(page);
            await enterApp(page);
            await page.getByRole('button', { name: 'Toggle 3D Studio View' }).click();
            const canvas = page.locator('canvas').first();
            await expect(canvas).toBeVisible({ timeout: 60_000 });
            const before = await canvas.boundingBox();
            await page.setViewportSize({ width: 900, height: 600 });
            await expect.poll(async () => (await canvas.boundingBox())?.width ?? 0, { timeout: 10_000 }).toBeLessThanOrEqual(900);
            const after = await canvas.boundingBox();
            expect(after!.width).toBeLessThan(before!.width);
            const sized = await canvas.evaluate((c: HTMLCanvasElement) => ({ w: c.width, cssW: c.getBoundingClientRect().width, dpr: window.devicePixelRatio }));
            expect(sized.w).toBeGreaterThanOrEqual(Math.floor(sized.cssW * sized.dpr) - 1);
        } finally {
            await context.close();
        }
    });
});

test.describe('interaction feedback', () => {
    const desktop = VIEWPORTS.find((v) => v.name === '1280x720')!;

    test('step buttons: hover, active, focus and playing each look different', async ({ browser }) => {
        const { context, page } = await newPage(browser, { ...desktop, touch: false });
        try {
            await openApp(page);
            await enterApp(page);
            const cap = (id: string) => page.locator(`[data-testid="${id}"] .step-cap`);
            const style = (id: string) => cap(id).evaluate((el) => {
                const cs = getComputedStyle(el);
                return `${cs.fill}|${cs.fillOpacity}|${cs.stroke}|${cs.strokeWidth}|${cs.strokeOpacity}`;
            });

            // Headless Firefox on a host with no pointing device reports (hover: none): the hover rule is
            // correctly off there, so there is nothing to measure.
            test.skip(!(await page.evaluate(() => matchMedia('(hover: hover)').matches)), 'this browser reports no hover capability');
            const idle = (await page.locator('.svg-step[aria-pressed="false"]').first().getAttribute('data-testid'))!;
            const baseline = await style(idle);
            await page.locator(`[data-testid="${idle}"]`).hover();
            const hovered = await style(idle);
            expect(hovered, 'hovering a step must change how it looks').not.toBe(baseline);

            // Active (pressed) vs inactive.
            const [pressed, notPressed] = await Promise.all([
                page.locator('.svg-step[aria-pressed="true"]').first().locator('.step-cap').evaluate((el) => getComputedStyle(el).fill),
                page.locator('.svg-step[aria-pressed="false"]').first().locator('.step-cap').evaluate((el) => getComputedStyle(el).fill),
            ]);
            expect(pressed).not.toBe(notPressed);

            // Keyboard focus shows a ring on the cap.
            await page.mouse.move(0, 0);
            await page.locator(`[data-testid="${idle}"]`).focus();
            await expect.poll(async () => parseFloat(await cap(idle).evaluate((el) => getComputedStyle(el).strokeWidth)), {
                message: 'a focused step draws a >=2px ring',
            }).toBeGreaterThanOrEqual(2);

            // Playing: the current step is outlined white.
            await playToggle(page).click();
            const current = page.locator('.svg-step.is-current .step-cap').first();
            await expect(current).toBeAttached({ timeout: 15_000 });
            await expect.poll(() => current.evaluate((el) => getComputedStyle(el).stroke)).toMatch(/255, 255, 255/);
            await playToggle(page).click();
        } finally {
            await context.close();
        }
    });

    test('keyboard users see a focus ring on every control they Tab to', async ({ browser }) => {
        const { context, page } = await newPage(browser, { ...desktop, touch: false });
        try {
            await openApp(page);
            await enterApp(page);
            // Steps animate `all 0.1s`; read settled values, not a frame mid-transition.
            await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; }' });
            await page.mouse.move(0, 0);
            await page.locator('body').click({ position: { x: 1, y: 300 } });
            const unringed: string[] = [];
            for (let i = 0; i < 40; i++) {
                await page.keyboard.press('Tab');
                // Compare how the focused control (and, for SVG, its drawn children) look with and without focus:
                // a ring is any change in outline / shadow / border / stroke / filter. Judged on computed style,
                // not on class names, so a control that merely *claims* a ring cannot pass.
                const info = await page.evaluate(() => {
                    const el = document.activeElement as HTMLElement | SVGElement | null;
                    if (!el || el === document.body) return null;
                    const sig = () => {
                        const nodes: Element[] = [el, ...(el instanceof SVGElement ? [...el.querySelectorAll('rect, path, circle, text')] : [])];
                        return nodes
                            .map((n) => {
                                const cs = getComputedStyle(n);
                                return [cs.outlineStyle, cs.outlineWidth, cs.outlineColor, cs.boxShadow, cs.borderTopColor, cs.borderBottomColor, cs.filter, cs.stroke, cs.strokeWidth, cs.fill, cs.textShadow, cs.backgroundColor].join('|');
                            })
                            .join('/');
                    };
                    const focused = sig();
                    const label = el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 20) || el.getAttribute('placeholder') || el.tagName;
                    el.blur();
                    const blurred = sig();
                    el.focus();
                    return { ring: focused !== blurred, label: `${el.tagName.toLowerCase()}[${label}]` };
                });
                if (info && !info.ring) unringed.push(info.label);
            }
            expect(unringed, 'focusable controls with no visible focus indicator').toEqual([]);
        } finally {
            await context.close();
        }
    });
});
