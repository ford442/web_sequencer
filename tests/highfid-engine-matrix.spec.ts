import { test, expect } from '@playwright/test';

/**
 * Cross-browser matrix: high-fid offline voice selection + GPU/CPU fallback (#978).
 *
 * - Chromium: may show GPU path when WebGPU is available (no "No GPU" badge).
 * - Firefox / WebKit: WebGPU typically absent — expect CPU fallback badge + status.
 */

async function initApp(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');

  const startBtn = page.getByRole('button', { name: 'INITIALIZE SYSTEM' });
  await startBtn.waitFor({ state: 'visible', timeout: 90000 });
  await expect(startBtn).toBeEnabled({ timeout: 90000 });
  await startBtn.click({ force: true });
  await startBtn.waitFor({ state: 'hidden', timeout: 30000 });

  await expect(
    page.getByRole('button', { name: 'Start Playback', exact: true }),
  ).toBeVisible({ timeout: 60000 });
}

function bass2VoiceGroup(page: import('@playwright/test').Page) {
  const bass2Module = page.locator('[class*="rounded"]', { hasText: 'BASS 2' }).first();
  return bass2Module.getByRole('group', { name: /303 voice selection/i });
}

test.describe('High-fid 303 engine matrix', () => {
  test('lists offline high-fid voices with Offline badge on BASS 2', async ({ page }) => {
    await initApp(page);

    const voiceGroup = bass2VoiceGroup(page);
    await expect(voiceGroup).toBeVisible({ timeout: 10000 });

    const hfCpu = voiceGroup.getByRole('button', {
      name: /Select High-Fidelity CPU \(offline\) voice/i,
    });
    const gpuHf = voiceGroup.getByRole('button', {
      name: /Select GPU High-Fidelity \(offline\) voice/i,
    });

    await expect(hfCpu).toBeVisible();
    await expect(gpuHf).toBeVisible();
    await expect(hfCpu).toContainText('Offline');
    await expect(gpuHf).toContainText('Offline');
  });

  test('selecting highfid-cpu shows HIFID family badge', async ({ page }) => {
    await initApp(page);

    const voiceGroup = bass2VoiceGroup(page);
    const hfCpu = voiceGroup.getByRole('button', {
      name: /Select High-Fidelity CPU \(offline\) voice/i,
    });
    await hfCpu.click();

    await expect(hfCpu).toHaveAttribute('aria-pressed', 'true');
    await expect(
      voiceGroup.getByLabel('High-fidelity offline engine family active'),
    ).toBeVisible();
    await expect(voiceGroup.getByRole('status')).toContainText(/offline engine/i);
  });

  test('gpu-highfid selection survives without crash', async ({ page, browserName }) => {
    await initApp(page);

    const voiceGroup = bass2VoiceGroup(page);
    const gpuHf = voiceGroup.getByRole('button', {
      name: /Select GPU High-Fidelity \(offline\) voice/i,
    });
    await gpuHf.click();

    await expect(gpuHf).toHaveAttribute('aria-pressed', 'true');
    await expect(
      voiceGroup.getByLabel('High-fidelity offline engine family active'),
    ).toBeVisible();

    const noGpuBadge = voiceGroup.getByLabel(
      'WebGPU unavailable; GPU high-fidelity will fall back to CPU',
    );

    if (browserName === 'chromium') {
      // Chromium in CI may or may not expose WebGPU — either path is valid.
      const hasNoGpu = await noGpuBadge.isVisible().catch(() => false);
      if (hasNoGpu) {
        await expect(voiceGroup.getByRole('status')).toContainText(
          /fallback|High-Fidelity CPU|highfid-cpu/i,
        );
      }
    } else {
      // Firefox / WebKit: expect CPU fallback indicator.
      await expect(noGpuBadge).toBeVisible({ timeout: 5000 });
      await expect(voiceGroup.getByRole('status')).toContainText(
        /fallback|High-Fidelity CPU|highfid-cpu/i,
      );
    }
  });

  test('stock ↔ jc303 switch still works alongside high-fid voices', async ({ page }) => {
    await initApp(page);

    const voiceGroup = bass2VoiceGroup(page);
    const jc303Btn = voiceGroup.getByRole('button', { name: /Select Authentic JC303 voice/i });
    const stockBtn = voiceGroup.getByRole('button', { name: /Select Stock Open303 voice/i });

    await jc303Btn.click();
    await expect(jc303Btn).toHaveAttribute('aria-pressed', 'true');
    await expect(voiceGroup.getByLabel('JC303 engine family active')).toBeVisible();

    await stockBtn.click();
    await expect(stockBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(voiceGroup.getByLabel('Open303 engine family active')).toBeVisible();
  });
});
