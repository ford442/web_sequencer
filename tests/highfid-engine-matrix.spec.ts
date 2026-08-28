import { test, expect } from '@playwright/test';
import { initializeHyphonAudio, openRackModule } from './helpers/boot';

/**
 * Cross-browser matrix: high-fid offline voice selection + GPU/CPU fallback (#978).
 */

test.describe('High-fid 303 engine matrix', () => {
  test('lists offline high-fid voices with Offline badge on BASS 2', async ({ page }) => {
    await initializeHyphonAudio(page);
    const bass2 = await openRackModule(page, 'BASS 2');
    const voiceGroup = bass2.getByRole('group', { name: /303 voice selection/i });
    await expect(voiceGroup).toBeVisible({ timeout: 15_000 });

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
    await initializeHyphonAudio(page);
    const bass2 = await openRackModule(page, 'BASS 2');
    const voiceGroup = bass2.getByRole('group', { name: /303 voice selection/i });
    await expect(voiceGroup).toBeVisible({ timeout: 15_000 });

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
    await initializeHyphonAudio(page);
    const bass2 = await openRackModule(page, 'BASS 2');
    const voiceGroup = bass2.getByRole('group', { name: /303 voice selection/i });
    await expect(voiceGroup).toBeVisible({ timeout: 15_000 });

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
      const hasNoGpu = await noGpuBadge.isVisible().catch(() => false);
      if (hasNoGpu) {
        await expect(voiceGroup.getByRole('status')).toContainText(
          /fallback|High-Fidelity CPU|highfid-cpu/i,
        );
      }
    } else {
      await expect(noGpuBadge).toBeVisible({ timeout: 5_000 });
      await expect(voiceGroup.getByRole('status')).toContainText(
        /fallback|High-Fidelity CPU|highfid-cpu/i,
      );
    }
  });

  test('live high-fid voice is selectable and stays audible or degrades to stock', async ({ page }) => {
    await initializeHyphonAudio(page);
    const bass2 = await openRackModule(page, 'BASS 2');
    const voiceGroup = bass2.getByRole('group', { name: /303 voice selection/i });
    await expect(voiceGroup).toBeVisible({ timeout: 15_000 });

    const liveBtn = voiceGroup.getByRole('button', {
      name: /Select Live High-Fidelity voice/i,
    });
    await expect(liveBtn).toBeVisible();
    await expect(liveBtn).toContainText('Live');
    // The realtime voice must not carry the offline-only badge.
    await expect(liveBtn).not.toContainText('Offline');

    await liveBtn.click();
    await expect(liveBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(
      voiceGroup.getByLabel('High-fidelity live engine family active'),
    ).toBeVisible();
    await expect(voiceGroup.getByRole('status')).toContainText(/live diode ladder/i);

    // Either the diode ladder is carrying audio, or the CPU gate handed it back
    // to stock with a stated reason — both are correct, an unexplained silent
    // step-down is not. Requires the ?e2e=1 hooks installed by the boot helper.
    const state = await page.evaluate(async () => {
      await new Promise((r) => setTimeout(r, 1500));
      const w = window as unknown as {
        __HYPHON_E2E__?: {
          getLiveHighFidState?: () => {
            requested: string | null;
            active: boolean | null;
            reason: string | null;
          };
        };
      };
      return w.__HYPHON_E2E__?.getLiveHighFidState?.() ?? null;
    });
    if (state) {
      expect(state.requested).toBe('live-highfid');
      if (state.active === false) {
        expect(state.reason ?? '').not.toHaveLength(0);
      }
    }
  });

  test('stock ↔ jc303 switch still works alongside high-fid voices', async ({ page }) => {
    await initializeHyphonAudio(page);
    const bass2 = await openRackModule(page, 'BASS 2');
    const voiceGroup = bass2.getByRole('group', { name: /303 voice selection/i });
    await expect(voiceGroup).toBeVisible({ timeout: 15_000 });

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
