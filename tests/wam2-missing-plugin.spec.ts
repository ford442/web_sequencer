import { test, expect } from '@playwright/test';
import { initializeHyphonAudio } from './helpers/boot';

/**
 * Phase B acceptance: a song that references a plugin we do not have must load,
 * bypass that slot, and leave the transport running. The failure this guards
 * against is not a crash — it is the app quietly substituting a different engine,
 * or the whole graph going silent, because one slot could not mount.
 *
 * Driven through the real host in the page (via the `?e2e=1` hooks registered in
 * main.tsx) rather than a unit mock, so the graph, worklets and transport are all
 * genuinely live. The hooks exist because a spec cannot `import('/src/...')`:
 * that specifier only resolves under the Vite dev server, and CI runs these
 * against the built `dist/` through `pnpm preview`.
 */

type Wam2Probe = {
  restoreWam2SongState?: (payload: unknown) => Promise<void> | null;
  getWam2SlotTelemetry?: () => { slotId: string; status: string; lastError?: string }[] | null;
  getWam2SlotBypassGain?: (slotId: string) => number | null;
  getWam2SlotDescriptor?: (slotId: string) => unknown;
  getAudioContextTime?: () => number | null;
};

const SLOT_ID = 'e2e-missing-slot';

test.describe('WAM2 missing plugin', () => {
  test('song with an unavailable plugin still plays', async ({ page }) => {
    await initializeHyphonAudio(page);

    const hasHost = await page.evaluate(() => {
      const probe = (window as { __HYPHON_E2E__?: Wam2Probe }).__HYPHON_E2E__;
      return Boolean(probe?.getWam2SlotTelemetry && probe.getWam2SlotTelemetry() !== null);
    });
    test.skip(!hasHost, 'No WAM2 host mounted in this build');

    const outcome = await page.evaluate(async (slotId) => {
      const probe = (window as { __HYPHON_E2E__?: Wam2Probe }).__HYPHON_E2E__!;
      await probe.restoreWam2SongState!({
        schema: 1,
        plugins: [
          {
            slotId,
            // Deliberately not in the allowlist.
            packageId: 'definitely.not.installed',
            version: '9.9.9',
            integrity: { alg: 'sha256', value: 'f'.repeat(64) },
            placement: 'trackInsert',
            attachToNodeId: 'masterSaturation',
            interceptFromNodeId: 'synthABus',
            paramState: {},
          },
        ],
      });
      const slot = probe.getWam2SlotTelemetry!()?.find((s) => s.slotId === slotId);
      return {
        status: slot?.status ?? null,
        lastError: slot?.lastError ?? null,
        // The dry path must be open, or this insert would mute the track it sits in.
        bypassGain: probe.getWam2SlotBypassGain!(slotId),
        // Never a substitute.
        descriptor: probe.getWam2SlotDescriptor!(slotId),
      };
    }, SLOT_ID);

    expect(outcome.status).toBe('missing');
    expect(outcome.lastError).toContain('not in the allowlist');
    expect(outcome.bypassGain).toBe(1);
    expect(outcome.descriptor).toBeNull();

    const play = page.getByRole('button', { name: 'Start Playback', exact: true });
    await expect(play).toBeVisible();
    await play.click();
    await expect(
      page.getByRole('button', { name: 'Stop Playback', exact: true }),
    ).toBeVisible({ timeout: 15_000 });

    // The audio clock is actually advancing — not merely a toggled button.
    const t0 = await page.evaluate(
      () => (window as { __HYPHON_E2E__?: Wam2Probe }).__HYPHON_E2E__!.getAudioContextTime!(),
    );
    await expect
      .poll(
        () =>
          page.evaluate(
            () => (window as { __HYPHON_E2E__?: Wam2Probe }).__HYPHON_E2E__!.getAudioContextTime!(),
          ),
        { timeout: 10_000 },
      )
      .toBeGreaterThan(t0 ?? 0);
  });
});
