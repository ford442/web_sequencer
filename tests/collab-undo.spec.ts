import { expect, test, type Page } from '@playwright/test';
import { initializeHyphonAudio } from './helpers/boot';
import { verticalDragKnob } from './helpers/knob-e2e';

/**
 * Per-editor undo over the shared project doc (#1597 P2), in two tabs of one
 * browser on `?collab=local` (BroadcastChannel room):
 *
 *   tab A paints 8 steps and drags a knob; tab B moves a clip;
 *   tab A undoes twice and redoes once.
 *
 * Both tabs must agree on the song after every step, and each tab's undo only
 * ever walks its own edits: A's two undos take back A's knob and paint (B's
 * clip stays where B put it), and B's undo takes back B's move only.
 *
 * Only tab A starts the audio engine: two live AudioContexts with the pthread
 * voice module crash renderers (see playwright.config.ts). Tab B is a control
 * surface that never presses INITIALIZE; it is driven from the keyboard, which
 * reaches its focused controls under the start overlay.
 */

const QUERY = 'e2e=1&collab=local';

interface CollabSong {
    pattern: { openHat: { steps: unknown[] } };
    arrangement: { clips: Array<{ id: string; track: string; startStep: number }> };
}

const readSong = (page: Page) => page.evaluate(() => window.__HYPHON_COLLAB__!.readSong() as unknown as CollabSong);
const history = (page: Page) =>
    page.evaluate(() => window.__HYPHON_COLLAB__!.history().map((e) => ({ label: e.label, done: e.done, editor: e.editor })));
const songJson = (page: Page) => page.evaluate(() => JSON.stringify(window.__HYPHON_COLLAB__!.readSong()));

async function waitForCollab(page: Page): Promise<void> {
    await page.waitForFunction(() => !!window.__HYPHON_COLLAB__, null, { timeout: 60_000 });
}

/** Open-hat steps that are on, among `steps`. */
async function paintedSteps(page: Page, steps: number[]): Promise<number[]> {
    const song = await readSong(page);
    return steps.filter((i) => song.pattern.openHat.steps[i] !== null);
}

test.describe('two tabs on ?collab=local', () => {
    test('paint, knob, clip move; undo twice, redo once: tabs agree, each undoes only its own edits', async ({ browser }) => {
        const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
        try {
            const a = await context.newPage();
            await initializeHyphonAudio(a, { query: QUERY });
            await waitForCollab(a);

            const b = await context.newPage();
            await b.goto(`/?${QUERY}`);
            await waitForCollab(b);
            const bId = await b.evaluate(() => window.__HYPHON_COLLAB__!.clientId);
            await expect.poll(() => a.evaluate(() => window.__HYPHON_COLLAB__!.peers())).toContain(bId);
            await expect.poll(() => songJson(b)).toBe(await songJson(a));

            // Tab A paints eight empty open-hat steps (eight quick presses: one step).
            const steps = (await readSong(a)).pattern.openHat.steps
                .map((step, i) => (step === null ? i : -1))
                .filter((i) => i >= 0)
                .slice(0, 8);
            expect(steps).toHaveLength(8);
            for (const i of steps) {
                const cell = a.getByTestId(`step-openHat-${i}`);
                await cell.focus();
                await a.keyboard.press('Enter');
            }
            await expect.poll(() => paintedSteps(b, steps)).toEqual(steps);

            // Tab A drags the first CUTOFF knob up.
            await a.waitForTimeout(700);
            const cutoff = a.getByRole('slider', { name: /^CUTOFF/i }).first();
            const cutoffStart = await cutoff.getAttribute('aria-valuenow');
            await verticalDragKnob(a, cutoff, 60);
            await expect(cutoff).not.toHaveAttribute('aria-valuenow', cutoffStart ?? '');
            const cutoffDragged = await cutoff.getAttribute('aria-valuenow');

            // Tab B adds a KICK clip, then moves it one beat right.
            await b.getByRole('button', { name: 'Toggle Arrangement' }).evaluate((el: HTMLElement) => el.click());
            const timeline = b.getByRole('region', { name: 'Arrangement timeline' });
            await expect(timeline).toBeVisible();
            await timeline.getByRole('button', { name: 'Add KICK clip' }).evaluate((el: HTMLElement) => el.click());
            const clip = timeline.getByRole('button', { name: /^KICK clip/ }).first();
            await expect(clip).toBeVisible();
            await b.waitForTimeout(700);
            await clip.focus();
            await b.keyboard.press('ArrowRight');
            const kickStart = async (page: Page) =>
                (await readSong(page)).arrangement.clips.find((c) => c.track === 'kick')?.startStep;
            await expect.poll(() => kickStart(a)).toBeGreaterThan(0);
            const movedTo = await kickStart(a);

            expect((await history(a)).map((e) => e.label)).toEqual([
                'paint 8 steps (Open hat)',
                expect.stringMatching(/^Synth A: Cutoff \d+ → \d+$/),
            ]);
            expect((await history(b)).map((e) => e.label)).toEqual(['add clip', 'move clip']);

            // Tab A: undo twice — its knob, then its paint. B's clip stays.
            await a.locator('body').focus();
            await a.keyboard.press('ControlOrMeta+z');
            await a.keyboard.press('ControlOrMeta+z');
            await expect(cutoff).toHaveAttribute('aria-valuenow', cutoffStart ?? '');
            for (const page of [a, b]) {
                await expect.poll(() => paintedSteps(page, steps)).toEqual([]);
                await expect.poll(() => kickStart(page)).toBe(movedTo);
            }

            // Tab A: redo once — the paint comes back everywhere; the knob stays undone.
            await a.keyboard.press('ControlOrMeta+Shift+z');
            for (const page of [a, b]) await expect.poll(() => paintedSteps(page, steps)).toEqual(steps);
            await expect(cutoff).toHaveAttribute('aria-valuenow', cutoffStart ?? '');
            expect(cutoffDragged).not.toBe(cutoffStart);
            await expect.poll(() => songJson(b)).toBe(await songJson(a));
            expect((await history(a)).map((e) => e.done)).toEqual([true, false]);

            // Tab B's undo takes back its own clip move, and nothing of A's.
            await b.locator('body').focus();
            await b.keyboard.press('ControlOrMeta+z');
            for (const page of [a, b]) {
                await expect.poll(() => kickStart(page)).toBe(0);
                await expect.poll(() => paintedSteps(page, steps)).toEqual(steps);
            }
            await expect.poll(() => songJson(b)).toBe(await songJson(a));
        } finally {
            await context.close();
        }
    });
});
