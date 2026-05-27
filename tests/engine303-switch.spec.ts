import { test, expect } from '@playwright/test';

/**
 * E2E: 303 engine switch scenario
 *
 * Tests that:
 * 1. Setting a 303 waveform (303-saw) on SYNTH B reveals the Engine303Selector
 * 2. Clicking "Authentic JC303" switches the engine and shows the JC303 badge
 *    in the RackNode title bar
 * 3. The EngineStatusPill in the Transport header reflects the active engine
 * 4. Switching back to "Custom Open303" removes the badge
 *
 * TODO: Fix Playwright environment setup for full audio context initialisation.
 * Temporarily skipped like other E2E specs until the CI environment is stable.
 */
test.skip('303 engine switch: SYNTH B toggles between open303 and jc303', async ({ page }) => {
    // 1. Navigate and initialise
    await page.goto('/');

    const startBtn = page.getByRole('button', { name: 'INITIALIZE SYSTEM' });
    await startBtn.waitFor({ state: 'visible', timeout: 90000 });
    await expect(startBtn).toBeEnabled({ timeout: 90000 });
    await startBtn.click({ force: true });
    await startBtn.waitFor({ state: 'hidden', timeout: 30000 });

    await expect(page.getByRole('button', { name: 'Start Playback' })).toBeVisible({ timeout: 60000 });

    // 2. Open the SYNTH B module overlay by clicking the waveform selector area
    //    (the Engine303Selector only appears when a 303 waveform is active)
    const synthBModule = page.locator('[class*="rounded"]', { hasText: 'SYNTH B' }).first();
    await expect(synthBModule).toBeVisible({ timeout: 10000 });

    // 3. Select a 303-saw waveform on SYNTH B to reveal the Engine303Selector
    const waveformBtn303Saw = synthBModule.getByLabel(/Select 303-saw waveform/i);
    await waveformBtn303Saw.click();

    // 4. The Engine303Selector should now be visible
    const engineGroup = synthBModule.getByRole('group', { name: /303 engine selection/i });
    await expect(engineGroup).toBeVisible({ timeout: 5000 });

    // 5. Click "Authentic JC303" to switch engine
    const jc303Btn = engineGroup.getByRole('button', { name: /Authentic JC303/i });
    await jc303Btn.click();

    // 6. Verify aria-pressed state updated
    await expect(jc303Btn).toHaveAttribute('aria-pressed', 'true');
    const open303Btn = engineGroup.getByRole('button', { name: /Custom Open303/i });
    await expect(open303Btn).toHaveAttribute('aria-pressed', 'false');

    // 7. The JC303 badge should appear in the rack module title bar
    const jc303Badge = synthBModule.getByLabel('JC303 engine active');
    await expect(jc303Badge).toBeVisible({ timeout: 3000 });

    // 8. The EngineStatusPill in the TransportToolbar should show the engine
    const header = page.locator('header');
    const statusPill = header.getByRole('status');
    await expect(statusPill).toBeVisible({ timeout: 3000 });
    await expect(statusPill).toContainText('JC303');

    // 9. Switch back to Custom Open303 and verify badge disappears
    await open303Btn.click();
    await expect(jc303Badge).not.toBeVisible({ timeout: 3000 });
    await expect(jc303Btn).toHaveAttribute('aria-pressed', 'false');
    await expect(open303Btn).toHaveAttribute('aria-pressed', 'true');
});

test.skip('303 engine switch: BASS 2 shows Engine303Selector always', async ({ page }) => {
    // 1. Navigate and initialise
    await page.goto('/');

    const startBtn = page.getByRole('button', { name: 'INITIALIZE SYSTEM' });
    await startBtn.waitFor({ state: 'visible', timeout: 90000 });
    await expect(startBtn).toBeEnabled({ timeout: 90000 });
    await startBtn.click({ force: true });
    await startBtn.waitFor({ state: 'hidden', timeout: 30000 });

    await expect(page.getByRole('button', { name: 'Start Playback' })).toBeVisible({ timeout: 60000 });

    // 2. BASS 2 always shows the Engine303Selector (no waveform prerequisite)
    const bass2Module = page.locator('[class*="rounded"]', { hasText: 'BASS 2' }).first();
    await expect(bass2Module).toBeVisible({ timeout: 10000 });

    const engineGroup = bass2Module.getByRole('group', { name: /303 engine selection/i });
    await expect(engineGroup).toBeVisible({ timeout: 5000 });

    // 3. Switch to JC303 and verify
    const jc303Btn = engineGroup.getByRole('button', { name: /Authentic JC303/i });
    await jc303Btn.click();
    await expect(jc303Btn).toHaveAttribute('aria-pressed', 'true');

    // 4. The EngineStatusPill should update
    const header = page.locator('header');
    const statusPill = header.getByRole('status');
    await expect(statusPill).toContainText('JC303');
});

test.skip('Prophecy engine: status pill appears when prophecy-saw waveform is selected', async ({ page }) => {
    // 1. Navigate and initialise
    await page.goto('/');

    const startBtn = page.getByRole('button', { name: 'INITIALIZE SYSTEM' });
    await startBtn.waitFor({ state: 'visible', timeout: 90000 });
    await expect(startBtn).toBeEnabled({ timeout: 90000 });
    await startBtn.click({ force: true });
    await startBtn.waitFor({ state: 'hidden', timeout: 30000 });

    await expect(page.getByRole('button', { name: 'Start Playback' })).toBeVisible({ timeout: 60000 });

    // 2. Select prophecy-saw waveform on SYNTH A
    const synthAModule = page.locator('[class*="rounded"]', { hasText: 'SYNTH A' }).first();
    const prophecySawBtn = synthAModule.getByLabel(/Select prophecy-saw waveform/i);
    await prophecySawBtn.click();

    // 3. The Prophecy parameters panel should appear
    const prophecyGroup = synthAModule.getByRole('group', { name: /Prophecy parameters/i });
    await expect(prophecyGroup).toBeVisible({ timeout: 5000 });

    // 4. The EngineStatusPill should show PROPHECY for SYNTH A
    const header = page.locator('header');
    const statusPill = header.getByRole('status');
    await expect(statusPill).toContainText('PROPHECY');
});
