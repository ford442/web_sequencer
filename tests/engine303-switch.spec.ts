import { test, expect } from '@playwright/test';
import {
  initializeHyphonAudio,
  openRackModule,
  selectOscillatorFamily,
  select303Voice,
  engineStatusIndicators,
  domClick,
} from './helpers/boot';

/**
 * E2E: 303 voice selection ("303 Voices" architecture).
 * Oscillator family + voice clicks use force:true — knob REC hitboxes overlap
 * the compact selectors inside HardwareModule.
 */

test('303 voice switch: SYNTH B toggles between stock and JC303 voices', async ({ page }) => {
    await initializeHyphonAudio(page);

    const synthBModule = await openRackModule(page, 'SYNTH B');
    await selectOscillatorFamily(synthBModule, 'open303');

    const voiceGroup = synthBModule.getByRole('group', { name: /303 voice selection/i });
    await select303Voice(synthBModule, /Select Authentic JC303 voice/i);

    const jc303Btn = voiceGroup.getByRole('button', { name: /Select Authentic JC303 voice/i });
    const stockBtn = voiceGroup.getByRole('button', { name: /Select Stock Open303 voice/i });
    await expect(stockBtn).toHaveAttribute('aria-pressed', 'false');
    await expect(voiceGroup.getByLabel('JC303 engine family active')).toBeVisible();
    await expect(engineStatusIndicators(page)).toContainText('JC303');

    await domClick(stockBtn);
    await expect(stockBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(jc303Btn).toHaveAttribute('aria-pressed', 'false');
    await expect(voiceGroup.getByLabel('Open303 engine family active')).toBeVisible();
});

test('303 voice switch: BASS 2 shows the Voice303Selector always', async ({ page }) => {
    await initializeHyphonAudio(page);

    const bass2Module = await openRackModule(page, 'BASS 2');
    await select303Voice(bass2Module, /Select Authentic JC303 voice/i);
    await expect(engineStatusIndicators(page)).toContainText('JC303');
});

test('303 voice switch: SYNTH A, SYNTH B and BASS 2 select independently', async ({ page }) => {
    await initializeHyphonAudio(page);

    const synthAModule = await openRackModule(page, 'SYNTH A');
    await selectOscillatorFamily(synthAModule, 'open303');
    await select303Voice(synthAModule, /Select Authentic JC303 voice/i);

    const synthBModule = await openRackModule(page, 'SYNTH B');
    await selectOscillatorFamily(synthBModule, 'open303');
    const groupB = synthBModule.getByRole('group', { name: /303 voice selection/i });
    await expect(groupB.getByRole('button', { name: /Select Stock Open303 voice/i }))
        .toHaveAttribute('aria-pressed', 'true');
    await expect(groupB.getByRole('button', { name: /Select Authentic JC303 voice/i }))
        .toHaveAttribute('aria-pressed', 'false');

    const bass2Module = await openRackModule(page, 'BASS 2');
    await select303Voice(bass2Module, /Select Experimental 01 voice/i);

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
    await selectOscillatorFamily(synthAModule, 'prophecy');

    const prophecyGroup = synthAModule.getByRole('group', { name: /Prophecy parameters/i });
    await expect(prophecyGroup).toBeVisible({ timeout: 10_000 });

    await expect(engineStatusIndicators(page)).toContainText('PROPHECY');
});
