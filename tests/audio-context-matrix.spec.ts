import { test, expect, type Page } from '@playwright/test';
import type { AudioContextProbeResult } from '../src/e2e/audioContextProbe';

/**
 * AudioContext negotiation matrix.
 *
 * Constructs the context through the production `createAudioContext` (via the
 * `?e2e=1` probe hook) and compares the factory's record with what the live
 * context exposes. Browser-specific support is a documented fallback, never a
 * failure: sampleRate may be ignored, `renderQuantumSize` / `sinkId` exist only
 * on Chromium. No exact `baseLatency` and no audible-output assertions, and no
 * physical audio device is needed (a dummy/null sink is enough).
 *
 * The context is built and resumed inside a real click listener (user
 * activation), and every context is closed in afterEach.
 */

type ProbeRequest = {
  sampleRatePref: 'native' | 44100 | 48000;
  extras?: { renderSizeHintPref?: 'default' | 'hardware' | 128 | 256; sinkId?: string | null };
};

type E2eHooks = {
  probeAudioContext: (req: ProbeRequest) => Promise<AudioContextProbeResult>;
  closeProbeContexts: () => Promise<number>;
};

declare global {
  interface Window {
    __HYPHON_E2E__?: Partial<E2eHooks>;
    __audioProbe?: Promise<AudioContextProbeResult>;
  }
}

/** Run the factory from a genuine click so resume() has user activation. */
async function probeFromClick(page: Page, req: ProbeRequest): Promise<AudioContextProbeResult> {
  await page.evaluate((r) => {
    document.addEventListener(
      'click',
      () => {
        window.__audioProbe = window.__HYPHON_E2E__!.probeAudioContext!(r);
      },
      { once: true, capture: true },
    );
  }, req);
  await page.mouse.click(8, 8);
  return page.evaluate(() => window.__audioProbe!);
}

test.describe('AudioContext factory negotiation', () => {
  test.beforeEach(async ({ page }) => {
    // The hook is registered at module load: no need to boot the engine.
    await page.goto('/?e2e=1');
    await page.waitForFunction(() => typeof window.__HYPHON_E2E__?.probeAudioContext === 'function');
  });

  test.afterEach(async ({ page }) => {
    if (page.isClosed()) return;
    await page.evaluate(() => window.__HYPHON_E2E__?.closeProbeContexts?.()).catch(() => undefined);
  });

  test('device-native rate is reported as-is', async ({ page }) => {
    const r = await probeFromClick(page, { sampleRatePref: 'native' });
    expect(r.requestedSampleRate).toBeNull();
    expect(r.sampleRateFallback).toBeNull();
    expect(r.actualSampleRate).toBe(r.contextSampleRate);
    expect(r.contextSampleRate).toBeGreaterThan(0);
    expect(['running', 'suspended']).toContain(r.stateAfterResume);
  });

  for (const rate of [44100, 48000] as const) {
    test(`sample-rate preference ${rate}`, async ({ page, browserName }) => {
      const r = await probeFromClick(page, { sampleRatePref: rate });
      expect(r.requestedSampleRate).toBe(rate);
      // The record always mirrors the live context.
      expect(r.actualSampleRate).toBe(r.contextSampleRate);

      if (browserName === 'chromium') {
        expect(r.contextSampleRate).toBe(rate);
        expect(r.sampleRateFallback).toBeNull();
      } else if (r.contextSampleRate === rate) {
        expect(r.sampleRateFallback).toBeNull();
      } else {
        // Documented fallback: browser ignored/refused the rate — it must say so.
        test.info().annotations.push({
          type: 'fallback',
          description: `${browserName} gave ${r.contextSampleRate} for ${rate}: ${r.sampleRateFallback}`,
        });
        expect(r.sampleRateFallback).toMatch(/^(browser-ignored-sampleRate|ctor-threw-sampleRate):/);
      }
    });
  }

  test('default renderSizeHint omits the option', async ({ page, browserName }) => {
    const r = await probeFromClick(page, { sampleRatePref: 'native', extras: { renderSizeHintPref: 'default' } });
    expect(r.requestedRenderSizeHint).toBeNull();
    expect(r.optionFallback).toBeNull();
    expect(r.renderQuantumSize).toBe(r.contextRenderQuantumSize);
    if (browserName === 'chromium') {
      expect(r.hasRenderQuantumMember).toBe(true);
      expect(r.renderQuantumSize).toBe(128);
    }
  });

  for (const pref of ['hardware', 128, 256] as const) {
    test(`explicit renderSizeHint ${pref}`, async ({ page, browserName }) => {
      const r = await probeFromClick(page, { sampleRatePref: 'native', extras: { renderSizeHintPref: pref } });

      if (!r.hasRenderQuantumMember) {
        // Firefox / WebKit: the option must be omitted, never claimed as honoured.
        expect(browserName).not.toBe('chromium');
        expect(r.requestedRenderSizeHint).toBeNull();
        expect(r.renderQuantumSize).toBeNull();
        expect(r.optionFallback).toBeNull();
        expect(r.actualSampleRate).toBe(r.contextSampleRate);
        return;
      }

      expect(r.requestedRenderSizeHint).toBe(pref);
      if (r.optionFallback) {
        // Chromium rejected the hint: documented fallback to the default quantum.
        test.info().annotations.push({ type: 'fallback', description: r.optionFallback });
        expect(r.optionFallback).toMatch(/^ctor-threw-options:renderSizeHint/);
      }
      // Factory record == what the context actually runs at.
      expect(r.renderQuantumSize).not.toBeNull();
      expect(r.renderQuantumSize).toBe(r.contextRenderQuantumSize);
      if (pref === 128 && !r.optionFallback) expect(r.renderQuantumSize).toBe(128);
      // A numeric hint is only a hint: record what was negotiated, don't demand equality.
      if (typeof pref === 'number') {
        test.info().annotations.push({
          type: 'negotiated',
          description: `renderSizeHint ${pref} -> quantum ${r.renderQuantumSize}`,
        });
      }
    });
  }

  test('sinkId is reflected accurately or reported as fallback/unsupported', async ({ page, browserName }) => {
    const r = await probeFromClick(page, { sampleRatePref: 'native', extras: { sinkId: 'default' } });

    if (!r.hasSinkIdMember) {
      // Firefox / WebKit (no AudioContext.sinkId): option omitted, nothing claimed.
      expect(browserName).not.toBe('chromium');
      expect(r.constructorSinkId).toBeNull();
      expect(r.contextSinkId).toBeNull();
      expect(r.optionFallback).toBeNull();
      return;
    }

    if (r.constructorSinkId !== null) {
      // Claimed honoured → the context must report that same sink. The default device is spelled
      // '' by some Chromium builds and 'default' by newer ones, so compare after normalising.
      const norm = (id: string | null) => (id === 'default' ? '' : id);
      expect(norm(r.contextSinkId)).toBe(norm(r.constructorSinkId));
    } else {
      // Not claimed. Either unsupported (no option passed) or surfaced as fallback.
      expect(r.optionFallback === null || /sinkId/.test(r.optionFallback)).toBe(true);
    }
  });

  test('unknown output device falls back instead of claiming the sink', async ({ page }) => {
    const bogus = 'hyphon-e2e-nonexistent-device';
    const r = await probeFromClick(page, { sampleRatePref: 'native', extras: { sinkId: bogus } });

    // Never reports a sink we did not get.
    if (r.constructorSinkId !== null) {
      expect(r.contextSinkId).toBe(bogus);
    } else if (r.hasSinkIdMember) {
      expect(r.optionFallback).toMatch(/^ctor-threw-options:.*sinkId/);
    } else {
      expect(r.optionFallback).toBeNull();
    }
    // Either way a usable context came up.
    expect(r.contextSampleRate).toBeGreaterThan(0);
  });
});
