import { test, expect } from '@playwright/test';

/**
 * E2E: 303 voice selection scenario ("303 Voices" architecture)
 *
 * The Voice303Selector (src/components/Voice303Selector.tsx) renders one
 * button per available voice from the TB303_MODELS registry
 * (src/engines/TB303Models.ts). These specs intentionally avoid hardcoding
 * the full voice list — they derive expectations from the registry ids that
 * are stable ('stock-open303', 'jc303') so the specs keep passing as the
 * catalog grows.
 *
 * Tests that:
 * 1. Setting a 303 waveform (303-saw) on SYNTH B reveals the 303 Voice list
 * 2. Picking "Authentic JC303" switches the voice, updates aria-pressed and
 *    the engine-family badge, and shows JC303 in the Transport status pill
 * 3. SYNTH A / SYNTH B / BASS 2 select voices independently
 * 4. Every listed voice carries a tooltip description
 *
 * TODO: Unskip when Playwright browsers are installed in the target environment.
 * Specs are registry-driven (no hardcoded voice list) and cover multi-voice
 * independent selection — they run in CI via `.github/workflows/playwright-e2e.yml`
 * once unskipped.
 */

/** Shared boot sequence: initialise the audio system and wait for the UI. */
async function initApp(page: import('@playwright/test').Page): Promise<void> {
    await page.goto('/');

    const startBtn = page.getByRole('button', { name: 'INITIALIZE SYSTEM' });
    await startBtn.waitFor({ state: 'visible', timeout: 90000 });
    await expect(startBtn).toBeEnabled({ timeout: 90000 });
    await startBtn.click({ force: true });
    await startBtn.waitFor({ state: 'hidden', timeout: 30000 });

    await expect(page.getByRole('button', { name: 'Start Playback' })).toBeVisible({ timeout: 60000 });
}

test.skip('303 voice switch: SYNTH B toggles between stock and JC303 voices', async ({ page }) => {
    await initApp(page);

    // 1. Open the SYNTH B module (the Voice303Selector only appears when a
    //    303 waveform is active)
    const synthBModule = page.locator('[class*="rounded"]', { hasText: 'SYNTH B' }).first();
    await expect(synthBModule).toBeVisible({ timeout: 10000 });

    // 2. Select a 303-saw waveform on SYNTH B to reveal the 303 Voice list
    const waveformBtn303Saw = synthBModule.getByLabel(/Select 303-saw waveform/i);
    await waveformBtn303Saw.click();

    // 3. The Voice303Selector should now be visible
    const voiceGroup = synthBModule.getByRole('group', { name: /303 voice selection/i });
    await expect(voiceGroup).toBeVisible({ timeout: 5000 });

    // 4. Pick "Authentic JC303"
    const jc303Btn = voiceGroup.getByRole('button', { name: /Select Authentic JC303 voice/i });
    await jc303Btn.click();

    // 5. Verify aria-pressed state updated and the family badge flipped
    await expect(jc303Btn).toHaveAttribute('aria-pressed', 'true');
    const stockBtn = voiceGroup.getByRole('button', { name: /Select Stock Open303 voice/i });
    await expect(stockBtn).toHaveAttribute('aria-pressed', 'false');
    await expect(voiceGroup.getByLabel('JC303 engine family active')).toBeVisible();

    // 6. The EngineStatusPill in the TransportToolbar should show the engine
    const header = page.locator('header');
    const statusPill = header.getByRole('status');
    await expect(statusPill).toBeVisible({ timeout: 3000 });
    await expect(statusPill).toContainText('JC303');

    // 7. Switch back to the stock voice and verify state returns
    await stockBtn.click();
    await expect(stockBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(jc303Btn).toHaveAttribute('aria-pressed', 'false');
    await expect(voiceGroup.getByLabel('Open303 engine family active')).toBeVisible();
});

test.skip('303 voice switch: BASS 2 shows the Voice303Selector always', async ({ page }) => {
    await initApp(page);

    // 1. BASS 2 always shows the Voice303Selector (no waveform prerequisite)
    const bass2Module = page.locator('[class*="rounded"]', { hasText: 'BASS 2' }).first();
    await expect(bass2Module).toBeVisible({ timeout: 10000 });

    const voiceGroup = bass2Module.getByRole('group', { name: /303 voice selection/i });
    await expect(voiceGroup).toBeVisible({ timeout: 5000 });

    // 2. Switch to JC303 and verify
    const jc303Btn = voiceGroup.getByRole('button', { name: /Select Authentic JC303 voice/i });
    await jc303Btn.click();
    await expect(jc303Btn).toHaveAttribute('aria-pressed', 'true');

    // 3. The EngineStatusPill should update
    const header = page.locator('header');
    const statusPill = header.getByRole('status');
    await expect(statusPill).toContainText('JC303');
});

test.skip('303 voice switch: SYNTH A, SYNTH B and BASS 2 select independently', async ({ page }) => {
    await initApp(page);

    // 1. Put SYNTH A and SYNTH B on 303 waveforms so all three voice lists show
    const synthAModule = page.locator('[class*="rounded"]', { hasText: 'SYNTH A' }).first();
    await synthAModule.getByLabel(/Select 303-saw waveform/i).click();
    const synthBModule = page.locator('[class*="rounded"]', { hasText: 'SYNTH B' }).first();
    await synthBModule.getByLabel(/Select 303-saw waveform/i).click();
    const bass2Module = page.locator('[class*="rounded"]', { hasText: 'BASS 2' }).first();

    const groupA = synthAModule.getByRole('group', { name: /303 voice selection/i });
    const groupB = synthBModule.getByRole('group', { name: /303 voice selection/i });
    const groupB2 = bass2Module.getByRole('group', { name: /303 voice selection/i });
    await expect(groupA).toBeVisible({ timeout: 5000 });
    await expect(groupB).toBeVisible({ timeout: 5000 });
    await expect(groupB2).toBeVisible({ timeout: 5000 });

    // 2. Pick a different voice on each part
    await groupA.getByRole('button', { name: /Select Authentic JC303 voice/i }).click();
    await groupB2.getByRole('button', { name: /Select Experimental 01 voice/i }).click();
    // SYNTH B stays on the default stock voice.

    // 3. Each part reflects only its own selection
    await expect(groupA.getByRole('button', { name: /Select Authentic JC303 voice/i }))
        .toHaveAttribute('aria-pressed', 'true');
    await expect(groupB.getByRole('button', { name: /Select Stock Open303 voice/i }))
        .toHaveAttribute('aria-pressed', 'true');
    await expect(groupB.getByRole('button', { name: /Select Authentic JC303 voice/i }))
        .toHaveAttribute('aria-pressed', 'false');
    await expect(groupB2.getByRole('button', { name: /Select Experimental 01 voice/i }))
        .toHaveAttribute('aria-pressed', 'true');
});

test.skip('303 voice list: every voice exposes a tooltip description', async ({ page }) => {
    await initApp(page);

    const bass2Module = page.locator('[class*="rounded"]', { hasText: 'BASS 2' }).first();
    const voiceGroup = bass2Module.getByRole('group', { name: /303 voice selection/i });
    await expect(voiceGroup).toBeVisible({ timeout: 5000 });

    // Registry-driven: every rendered voice button must carry a non-empty
    // title (the model description), whatever the current catalog size.
    const voiceButtons = voiceGroup.getByRole('button', { name: /^Select .+ voice$/ });
    const count = await voiceButtons.count();
    expect(count).toBeGreaterThanOrEqual(2); // at minimum stock + jc303
    for (let i = 0; i < count; i++) {
        const title = await voiceButtons.nth(i).getAttribute('title');
        expect(title, `voice button ${i} tooltip`).toBeTruthy();
    }
});

test.skip('Prophecy engine: status pill appears when prophecy-saw waveform is selected', async ({ page }) => {
    await initApp(page);

    // 1. Select prophecy-saw waveform on SYNTH A
    const synthAModule = page.locator('[class*="rounded"]', { hasText: 'SYNTH A' }).first();
    const prophecySawBtn = synthAModule.getByLabel(/Select prophecy-saw waveform/i);
    await prophecySawBtn.click();

    // 2. The Prophecy parameters panel should appear
    const prophecyGroup = synthAModule.getByRole('group', { name: /Prophecy parameters/i });
    await expect(prophecyGroup).toBeVisible({ timeout: 5000 });

    // 3. The EngineStatusPill should show PROPHECY for SYNTH A
    const header = page.locator('header');
    const statusPill = header.getByRole('status');
    await expect(statusPill).toContainText('PROPHECY');
});
