import { test, expect } from '@playwright/test';
import { initializeHyphonAudio, openRackModule } from './helpers/boot';

/**
 * E2E: 303 voice selection ("303 Voices" architecture).
 * Rack mounts only the selected track — helpers call openRackModule first.
 */

test('303 voice switch: SYNTH B toggles between stock and JC303 voices', async ({ page }) => {
    await initializeHyphonAudio(page);

    const synthBModule = await openRackModule(page, 'SYNTH B');

    await synthBModule.getByLabel(/Select 303-saw waveform/i).click();

    const voiceGroup = synthBModule.getByRole('group', { name: /303 voice selection/i });
    await expect(voiceGroup).toBeVisible({ timeout: 10_000 });

    const jc303Btn = voiceGroup.getByRole('button', { name: /Select Authentic JC303 voice/i });
    await jc303Btn.click();

    await expect(jc303Btn).toHaveAttribute('aria-pressed', 'true');
    const stockBtn = voiceGroup.getByRole('button', { name: /Select Stock Open303 voice/i });
    await expect(stockBtn).toHaveAttribute('aria-pressed', 'false');
    await expect(voiceGroup.getByLabel('JC303 engine family active')).toBeVisible();

    const header = page.locator('header');
    const statusPill = header.getByRole('status');
    await expect(statusPill).toBeVisible({ timeout: 5_000 });
    await expect(statusPill).toContainText('JC303');

    await stockBtn.click();
    await expect(stockBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(jc303Btn).toHaveAttribute('aria-pressed', 'false');
    await expect(voiceGroup.getByLabel('Open303 engine family active')).toBeVisible();
});

test('303 voice switch: BASS 2 shows the Voice303Selector always', async ({ page }) => {
    await initializeHyphonAudio(page);

    const bass2Module = await openRackModule(page, 'BASS 2');

    const voiceGroup = bass2Module.getByRole('group', { name: /303 voice selection/i });
    await expect(voiceGroup).toBeVisible({ timeout: 10_000 });

    const jc303Btn = voiceGroup.getByRole('button', { name: /Select Authentic JC303 voice/i });
    await jc303Btn.click();
    await expect(jc303Btn).toHaveAttribute('aria-pressed', 'true');

    const header = page.locator('header');
    await expect(header.getByRole('status')).toContainText('JC303');
});

test('303 voice switch: SYNTH A, SYNTH B and BASS 2 select independently', async ({ page }) => {
    await initializeHyphonAudio(page);

    const synthAModule = await openRackModule(page, 'SYNTH A');
    await synthAModule.getByLabel(/Select 303-saw waveform/i).click();
    const groupA = synthAModule.getByRole('group', { name: /303 voice selection/i });
    await expect(groupA).toBeVisible({ timeout: 10_000 });
    await groupA.getByRole('button', { name: /Select Authentic JC303 voice/i }).click();
    await expect(groupA.getByRole('button', { name: /Select Authentic JC303 voice/i }))
        .toHaveAttribute('aria-pressed', 'true');

    const synthBModule = await openRackModule(page, 'SYNTH B');
    await synthBModule.getByLabel(/Select 303-saw waveform/i).click();
    const groupB = synthBModule.getByRole('group', { name: /303 voice selection/i });
    await expect(groupB).toBeVisible({ timeout: 10_000 });
    // SYNTH B stays on default stock voice.
    await expect(groupB.getByRole('button', { name: /Select Stock Open303 voice/i }))
        .toHaveAttribute('aria-pressed', 'true');
    await expect(groupB.getByRole('button', { name: /Select Authentic JC303 voice/i }))
        .toHaveAttribute('aria-pressed', 'false');

    const bass2Module = await openRackModule(page, 'BASS 2');
    const groupB2 = bass2Module.getByRole('group', { name: /303 voice selection/i });
    await expect(groupB2).toBeVisible({ timeout: 10_000 });
    await groupB2.getByRole('button', { name: /Select Experimental 01 voice/i }).click();
    await expect(groupB2.getByRole('button', { name: /Select Experimental 01 voice/i }))
        .toHaveAttribute('aria-pressed', 'true');

    // Re-open SYNTH A and confirm its independent JC303 selection stuck.
    const synthAAgain = await openRackModule(page, 'SYNTH A');
    await expect(
        synthAAgain.getByRole('group', { name: /303 voice selection/i })
            .getByRole('button', { name: /Select Authentic JC303 voice/i }),
    ).toHaveAttribute('aria-pressed', 'true');
});

test('303 voice list: every voice exposes a tooltip description', async ({ page }) => {
    await initializeHyphonAudio(page);

    const bass2Module = await openRackModule(page, 'BASS 2');
    const voiceGroup = bass2Module.getByRole('group', { name: /303 voice selection/i });
    await expect(voiceGroup).toBeVisible({ timeout: 10_000 });

    const voiceButtons = voiceGroup.getByRole('button', { name: /^Select .+ voice$/ });
    const count = await voiceButtons.count();
    expect(count).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < count; i++) {
        const title = await voiceButtons.nth(i).getAttribute('title');
        expect(title, `voice button ${i} tooltip`).toBeTruthy();
    }
});

test('Prophecy engine: status pill appears when prophecy-saw waveform is selected', async ({ page }) => {
    await initializeHyphonAudio(page);

    const synthAModule = await openRackModule(page, 'SYNTH A');
    await synthAModule.getByLabel(/Select prophecy-saw waveform/i).click();

    const prophecyGroup = synthAModule.getByRole('group', { name: /Prophecy parameters/i });
    await expect(prophecyGroup).toBeVisible({ timeout: 10_000 });

    const header = page.locator('header');
    await expect(header.getByRole('status')).toContainText('PROPHECY');
});
