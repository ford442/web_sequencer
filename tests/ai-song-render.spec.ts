import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { initializeHyphonAudio } from './helpers/boot';
import { EXIT, renderAISongInPage, type RenderOptions } from '../scripts/ai-song-render/render';
import { analyzeAudio, firstOnsetSeconds, parseWav, stepsPerBar } from '../src/agent/audioMetrics';

/**
 * `pnpm run ai-song:render` (#1386): an agent imports an AI song, renders it
 * and reads metrics instead of listening. These specs drive
 * `window.__HYPHON_AGENT__` through `renderAISongInPage` — the exact code the
 * CLI runs — against the built app.
 *
 * The render specs are Chromium-only: the CLI only ever launches Chromium,
 * and the live 303 capture needs a running audio clock, which Firefox lacks
 * on a runner without an audio sink (see tests/global-setup.ts).
 */

const fixture = (name: string) => readFileSync(`test-fixtures/ai-song/${name}.json`, 'utf8');
/** A fixture as an object to edit (the importer validates whatever comes back). */
const editable = (name: string) => JSON.parse(fixture(name)) as Record<string, unknown>;
const ALL: RenderOptions = { formats: ['wav', 'rbs', 'mid', 'xm'], stems: false, strict: true };
const ascii = (bytes: Uint8Array, start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));

test.describe('ai-song:render — agent render hook', () => {
    test.describe.configure({ mode: 'serial' });

    let page: Page;
    test.beforeAll(async ({ browser, browserName }) => {
        test.skip(browserName !== 'chromium', 'the CLI renders in Chromium');
        page = await browser.newPage();
        await initializeHyphonAudio(page, { query: 'agent=1', allowConsoleNoise: true });
    });
    test.afterAll(async () => {
        await page?.close();
    });

    test('minimal.json → a non-silent mix of the song length, and valid .rbs / .mid / .xm', async () => {
        const { report, files } = await renderAISongInPage(page, fixture('minimal'), ALL);
        expect(report.errors).toEqual([]);
        expect(report.exitCode).toBe(EXIT.ok);

        const mix = files.find((f) => f.path === 'mix.wav')!;
        const wav = parseWav(mix.bytes);
        // 32 steps at 128 BPM: 32 × 60 / 128 / 4 = 3.75 s.
        expect(wav.channels[0].length / wav.sampleRate).toBeCloseTo(3.75, 2);
        expect(report.metrics!.grid.expectedSeconds).toBeCloseTo(3.75, 6);
        expect(report.metrics!.master.silent).toBe(false);
        expect(report.metrics!.master.integratedLufs).not.toBeNull();

        const rbs = files.find((f) => f.path === 'song.rbs')!.bytes;
        expect(ascii(rbs, 0, 4)).toBe('CAT ');
        expect(ascii(rbs, 8, 12)).toBe('RB40');
        expect(ascii(files.find((f) => f.path === 'song.mid')!.bytes, 0, 4)).toBe('MThd');
        expect(ascii(files.find((f) => f.path === 'song.xm')!.bytes, 0, 17)).toBe('Extended Module: ');
        expect(report.files.sort()).toEqual(['mix.wav', 'song.mid', 'song.rbs', 'song.xm']);
    });

    test('full.json → the synthA stem centroid rises and falls with the cutoff lane', async () => {
        // The lane climbs over steps 0–16 and falls over 16–32; at 3/4 (12-step
        // bars) bar 2 holds the top of the sweep.
        const { report } = await renderAISongInPage(page, fixture('full'), { ...ALL, formats: ['wav'], stems: true });
        expect(report.exitCode).toBe(EXIT.ok);
        expect(report.render!.report.automation.applied).toContain('synthA.filterCutoff');
        const [bar1, bar2, bar3] = report.metrics!.stems.partA.bars.map((b) => b.centroidHz!);
        expect(bar2).toBeGreaterThan(bar1 * 1.3);
        expect(bar2).toBeGreaterThan(bar3 * 1.1);

        // Without the lane the same notes hold still: the movement is the lane's.
        const flat = JSON.stringify({ ...editable('full'), automation: [] });
        const still = (await renderAISongInPage(page, flat, { ...ALL, formats: ['wav'], stems: true })).report;
        const centroids = still.metrics!.stems.partA.bars.map((b) => b.centroidHz!);
        expect(Math.max(...centroids) / Math.min(...centroids)).toBeLessThan(1.3);
    });

    test('strict mode: a kick lane fails the import with the warning in the report', async () => {
        const song = editable('minimal');
        song.automation = [{ target: 'kick', parameter: 'decay', steps: Array.from({ length: 16 }, (_, i) => i * 8) }];

        const strict = await renderAISongInPage(page, JSON.stringify(song), ALL);
        expect(strict.report.exitCode).toBe(EXIT.validation);
        expect(strict.report.import.ok).toBe(false);
        expect(strict.report.import.warnings).toEqual([expect.stringContaining('kick.decay is saved but never plays')]);
        expect(strict.report.errors).toEqual([expect.stringMatching(/^strict: automation kick\.decay/)]);
        expect(strict.files).toEqual([]);

        const loose = await renderAISongInPage(page, JSON.stringify(song), { ...ALL, formats: ['wav'], strict: false });
        expect(loose.report.exitCode).toBe(EXIT.ok);
        expect(loose.report.import.warnings).toHaveLength(1);
    });

    test('an invalid song exits with a validation error and renders nothing', async () => {
        const { report, files } = await renderAISongInPage(page, '{"meta": {}}', ALL);
        expect(report.exitCode).toBe(EXIT.validation);
        expect(report.errors[0]).toMatch(/^meta\.title: /);
        expect(files).toEqual([]);
    });

    test('a song with nothing to play exits silent', async () => {
        const song = editable('minimal');
        song.tracks = { synthA: { notes: [], params: { waveform: '303-saw' } } };
        const { report } = await renderAISongInPage(page, JSON.stringify(song), { ...ALL, formats: ['wav'] });
        expect(report.exitCode).toBe(EXIT.silent);
        expect(report.metrics!.master.silent).toBe(true);
        expect(report.errors).toEqual([expect.stringMatching(/^mix\.wav is silent/)]);
    });

    test('jc303: a cutoff lane moves the live JC303 voice the way it moves open303', async () => {
        // The offline mix never runs a 303 engine, so this records the live lead
        // voice: the lane reaches it through AutomationScheduler → open303-processor
        // → jc303_set_param (or open303_set_param).
        const song = fixture('full');
        const grid = { stepSeconds: 15 / 96, stepsPerBar: stepsPerBar([3, 4]) };
        for (const engine303 of ['open303', 'jc303'] as const) {
            const capture = await page.evaluate(async ([json, engine]) => {
                const agent = window.__HYPHON_AGENT__!;
                const imported = await agent.importAISong(json, { engine303: engine });
                if (!imported.ok) throw new Error(imported.errors.join('; '));
                return agent.captureLive({ track: 'synthA', seconds: 6 });
            }, [song, engine303] as const);
            expect(capture.source).toBe('open303-lead303');

            const wav = parseWav(new Uint8Array(Buffer.from(capture.base64, 'base64')));
            const onset = firstOnsetSeconds(wav.channels, wav.sampleRate);
            expect(onset, `${engine303}: the live voice is silent`).not.toBeNull();
            const [bar1, bar2, bar3] = analyzeAudio(wav.channels, wav.sampleRate, { ...grid, offsetSeconds: onset! })
                .bars.map((b) => b.centroidHz ?? 0);
            expect(bar2, `${engine303} centroid per bar: ${bar1} / ${bar2} / ${bar3} Hz`).toBeGreaterThan(bar1 * 1.5);
            expect(bar2, `${engine303} centroid per bar: ${bar1} / ${bar2} / ${bar3} Hz`).toBeGreaterThan(bar3 * 1.5);
        }
    });
});

test.describe('agent render hook surface', () => {
    test('exists with ?agent=1 and is absent without ?agent / ?e2e', async ({ page }) => {
        await page.goto('/?agent=1');
        await page.waitForFunction(() => window.__HYPHON_AGENT__?.version === 1, undefined, { timeout: 90_000 });

        await page.goto('/');
        await page.getByTestId('start-overlay').waitFor({ state: 'visible', timeout: 90_000 });
        // The bridge is a lazy chunk mounted at app render; give it the time it
        // takes with the flag, then some.
        await page.waitForTimeout(3_000);
        expect(await page.evaluate(() => typeof window.__HYPHON_AGENT__)).toBe('undefined');
        const loaded = await page.evaluate(() =>
            performance.getEntriesByType('resource').some((e) => /AgentBridge/.test(e.name)),
        );
        expect(loaded).toBe(false);
    });
});
