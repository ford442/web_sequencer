import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  engineStatusIndicators,
  initializeHyphonAudio,
  openRackModule,
  selectOscillatorFamily,
} from './helpers/boot';

/**
 * Triage of the 2026-10-07 live-site bug wave (#1389–#1397).
 *
 * The owner filed these against the test.1ink.us build dated 2026-06-15. This
 * spec reproduces each report's steps against a FRESH `dist/` and asserts the
 * EXPECTED behaviour, so a green test means "does not reproduce on this build"
 * and a red test is a real bug on main (marked `REPRODUCES ON MAIN` below).
 *
 * Screenshots go to the per-test output dir under `test-results/`
 * (gitignored); each is referenced by filename in the comment above its test.
 *
 * Not covered here, on purpose:
 *   #1394 — storage.noahcohn.com:8000 ERR_SSL_PROTOCOL_ERROR is the cloud
 *           host's TLS configuration, not code in this repo. Nothing to assert.
 *   #1397 — feature request (note-coloured LED beside the live keyboard).
 *           There is no behaviour to assert yet.
 */

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

const WORKLET_BOTH_ZERO_RE = /inputs and outputs cannot be both zero/i;
const ENGINE_FALLBACK_RE =
  /missing (wasm )?export|exports? (are |is )?missing|timed? ?out after 8000|8000 ?ms|init(ialization)? timeout/i;
const PCF_FAILURE_RE =
  /MIME type|Failed to load module script|Unable to load a worklet's module|PcfEffect\].*(Failed|bypass)|PCF.*bypass/i;

type Rect = { x: number; y: number; w: number; h: number };

/** Bounding box once it has stopped moving (scrollIntoView can still be animating). */
async function settledBox(target: Locator): Promise<Rect> {
  let last = '';
  let stable = 0;
  for (let i = 0; i < 100; i++) {
    const b = await target.boundingBox();
    if (b) {
      const key = [b.x, b.y, b.width, b.height].map((n) => n.toFixed(1)).join(',');
      stable = key === last ? stable + 1 : 0;
      last = key;
      if (stable >= 4) return { x: b.x, y: b.y, w: b.width, h: b.height };
    }
    await target.page().waitForTimeout(50);
  }
  throw new Error('element never stopped moving');
}

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

// ---------------------------------------------------------------------------
// One boot for the console/network/UI checks. Listeners are attached BEFORE
// navigation so init-time console output is not missed. The checks share one
// page and run in file order (single worker), passive ones first, PLAY and key
// presses last. Deliberately NOT `mode: 'serial'`: one reproduced bug must not
// skip the verdicts for the issues after it. (A failure restarts the worker, so
// the remaining tests re-boot — slower, but every issue gets a verdict.)
// ---------------------------------------------------------------------------

test.describe('live-site issue triage — fresh dist boot', () => {
  let page: Page;
  const consoleLines: string[] = [];
  const pageErrors: string[] = [];
  const requests: { url: string; resourceType: string }[] = [];
  const responses: { url: string; status: number; contentType: string }[] = [];

  test.beforeAll(async ({ browser }, testInfo) => {
    const context = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
    });
    page = await context.newPage();
    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        consoleLines.push(`[${msg.type()}] ${msg.text()}`);
      }
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('request', (req) =>
      requests.push({ url: req.url(), resourceType: req.resourceType() }),
    );
    page.on('response', (res) => {
      responses.push({
        url: res.url(),
        status: res.status(),
        contentType: res.headers()['content-type'] ?? '',
      });
    });
    await initializeHyphonAudio(page);
  });

  test.afterAll(async () => {
    await page?.context().close();
  });

  // #1391 -------------------------------------------------------------------
  test('#1391 no "inputs and outputs cannot be both zero" during init', () => {
    const hits = [...consoleLines, ...pageErrors].filter((l) => WORKLET_BOTH_ZERO_RE.test(l));
    expect(hits, `console/page errors:\n${hits.join('\n')}`).toEqual([]);
  });

  // #1393 -------------------------------------------------------------------
  test('#1393 PCF worklet is served as JavaScript, never as a raw .ts URL', () => {
    const rawTs = requests.filter((r) => /\.tsx?(\?|#|$)/.test(new URL(r.url).pathname + new URL(r.url).search));
    expect(
      rawTs.map((r) => r.url),
      'no request may target a raw TypeScript file in a built dist',
    ).toEqual([]);

    const pcf = responses.filter((r) => /pcf-processor/i.test(r.url));
    for (const r of pcf) {
      expect(r.status, r.url).toBe(200);
      expect(r.contentType, r.url).toMatch(/javascript/i);
    }

    const hits = [...consoleLines, ...pageErrors].filter((l) => PCF_FAILURE_RE.test(l));
    expect(hits, `PCF/MIME console lines:\n${hits.join('\n')}`).toEqual([]);
  });

  // #1395 -------------------------------------------------------------------
  // REPRODUCES ON MAIN — see issue #1395. Chromium, Firefox and WebKit all
  // agree: at the default 1280x720 viewport the SUS and REL knobs' REC "R" dots
  // sit on top of the oscillator selector buttons (303 / PRO). The other
  // reported symptoms do NOT reproduce: knobs paint, labels sit under their
  // knobs. Left failing on purpose; see the issue comment for the hypothesis.
  // Screenshot: 1395-synth-a-lead.png
  test('#1395 Synth A // LEAD panel: knobs, labels and oscillator selector are laid out', async () => {
    const synthA = await openRackModule(page, 'SYNTH A');
    await page.waitForTimeout(1_000); // let the knob canvases paint
    await synthA.screenshot({ path: test.info().outputPath('1395-synth-a-lead.png') });

    const selector = synthA.getByRole('group', { name: 'Oscillator type selection' });
    await expect(selector).toBeVisible();

    const layout = await synthA.evaluate((root, selectorLabel) => {
      const rect = (el: Element): Rect => {
        const b = el.getBoundingClientRect();
        return { x: b.x, y: b.y, w: b.width, h: b.height };
      };
      type Rect = { x: number; y: number; w: number; h: number };
      const sel = root.querySelector(`[role="group"][aria-label="${selectorLabel}"]`);
      const knobs = [...root.querySelectorAll('[role="slider"]')].map((slider) => {
        const label = (slider.getAttribute('aria-label') ?? '').replace(/ \(automated\)$/, '');
        const sr = rect(slider);
        const sc = { x: sr.x + sr.w / 2, y: sr.y + sr.h / 2 };
        const scope = slider.parentElement ?? root;
        const nearest = (els: Element[]) =>
          els.sort(
            (a, b) =>
              Math.hypot(rect(a).x + rect(a).w / 2 - sc.x, rect(a).y - sc.y) -
              Math.hypot(rect(b).x + rect(b).w / 2 - sc.x, rect(b).y - sc.y),
          )[0];
        const labelEl = nearest(
          [...scope.querySelectorAll('span')].filter((s) => s.textContent?.trim() === label),
        );
        const recEl = nearest(
          [...scope.querySelectorAll('button')].filter(
            (b) => b.getAttribute('aria-label') === `Record Automation for ${label}`,
          ),
        );
        return {
          label,
          slider: sr,
          labelRect: labelEl ? rect(labelEl) : null,
          recRect: recEl ? rect(recEl) : null,
          selectorRect: sel ? rect(sel) : null,
        };
      });
      const canvases = [...root.querySelectorAll('[data-testid^="hardware-knob-canvas-"]')].map(
        (c) => {
          const canvas = c as HTMLCanvasElement;
          let painted = 0;
          const ctx = canvas.getContext('2d');
          if (ctx && canvas.width && canvas.height) {
            const step = Math.max(1, Math.floor(Math.min(canvas.width, canvas.height) / 12));
            for (let y = 0; y < canvas.height; y += step) {
              for (let x = 0; x < canvas.width; x += step) {
                const d = ctx.getImageData(x, y, 1, 1).data;
                if (Math.abs(d[0] - 13) + Math.abs(d[1] - 15) + Math.abs(d[2] - 19) > 6) painted++;
              }
            }
          }
          return { rect: rect(canvas), painted };
        },
      );
      return { root: rect(root), knobs, canvases, selectorRect: sel ? rect(sel) : null };
    }, 'Oscillator type selection');

    // A normal knob grid: several knobs, each with a real-size control.
    expect(layout.knobs.length, 'knob count in Synth A panel').toBeGreaterThanOrEqual(4);
    expect(layout.canvases.length, 'knob canvases').toBeGreaterThan(0);
    expect(
      layout.canvases.some((c) => c.painted > 0),
      'at least one knob canvas must contain non-background pixels (knobs, not just "R" dots)',
    ).toBe(true);

    const problems: string[] = [];
    for (const k of layout.knobs) {
      if (k.slider.w < 24 || k.slider.h < 24) {
        problems.push(`${k.label}: knob hit-area collapsed to ${k.slider.w.toFixed(0)}x${k.slider.h.toFixed(0)}`);
      }
      if (!k.labelRect) {
        problems.push(`${k.label}: no label element found`);
        continue;
      }
      const knobCx = k.slider.x + k.slider.w / 2;
      const knobCy = k.slider.y + k.slider.h / 2;
      const labelCx = k.labelRect.x + k.labelRect.w / 2;
      if (Math.abs(labelCx - knobCx) > Math.max(8, k.slider.w / 2)) {
        problems.push(`${k.label}: label centre ${labelCx.toFixed(0)} is not under knob centre ${knobCx.toFixed(0)}`);
      }
      if (k.labelRect.y < knobCy) {
        problems.push(`${k.label}: label (${k.labelRect.y.toFixed(0)}) sits above knob centre (${knobCy.toFixed(0)})`);
      }
      if (k.recRect) {
        const recCx = k.recRect.x + k.recRect.w / 2;
        if (Math.abs(recCx - knobCx) > Math.max(8, k.slider.w / 2)) {
          problems.push(`${k.label}: REC dot is not over its knob`);
        }
      }
      // The oscillator selector must not sit on top of a knob label or REC dot.
      for (const [what, r] of [['label', k.labelRect], ['REC dot', k.recRect]] as const) {
        if (r && layout.selectorRect && overlapArea(r, layout.selectorRect) > 4) {
          problems.push(`${k.label}: ${what} overlaps the oscillator selector`);
        }
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });

  // #1392 -------------------------------------------------------------------
  test('#1392 303 and Prophecy engines init without missing-export / 8000ms-timeout fallback', async () => {
    // Exercise both engines: the reported failures happen when the worklet
    // for the engine is first created, not at page boot.
    const synthA = await openRackModule(page, 'SYNTH A');
    await selectOscillatorFamily(synthA, 'open303');
    await selectOscillatorFamily(synthA, 'prophecy');
    await expect(
      synthA.getByRole('group', { name: /Prophecy parameters/i }),
    ).toBeVisible({ timeout: 10_000 });

    // Give the 8000 ms engine-init timeout a chance to fire if it is going to.
    await page.waitForTimeout(9_000);

    const hits = consoleLines.filter((l) => ENGINE_FALLBACK_RE.test(l));
    expect(hits, `fallback console lines:\n${hits.join('\n')}`).toEqual([]);

    // A degraded engine surfaces as an amber "<subsystem> degraded: …" button
    // in the status group. WebGPU / gpu-knobs / oscillators degrade on any
    // machine without a GPU adapter (e.g. CI) and are not what #1392 is about;
    // the 303 and Prophecy engines must not degrade.
    const degraded = engineStatusIndicators(page).getByRole('button', {
      name: /(303|prophecy).*degraded|degraded.*(303|prophecy)/i,
    });
    await expect(degraded).toHaveCount(0);
    await engineStatusIndicators(page).screenshot({
      path: test.info().outputPath('1392-engine-status.png'),
    });
  });

  // #1389 -------------------------------------------------------------------
  // Runs late: PLAY / STOP mutates transport state.
  test('#1389 sequencer advances: step highlight moves within 2 s of PLAY at 120 BPM', async () => {
    const play = page.getByRole('button', { name: 'Start Playback', exact: true });
    await play.click();
    await expect(page.getByRole('button', { name: 'Stop Playback', exact: true })).toBeVisible();

    // Sample which step carries the playhead class; a stuck sequencer shows
    // at most one distinct index (or none).
    const seen = new Set<number>();
    const started = Date.now();
    while (Date.now() - started < 2_000) {
      const idx = await page.evaluate(() => {
        const el = document.querySelector('.is-current');
        if (!el || !el.parentElement) return -1;
        return [...el.parentElement.children].indexOf(el);
      });
      if (idx >= 0) seen.add(idx);
      await page.waitForTimeout(40);
    }
    const transportStep = await page.evaluate(
      () => (window as unknown as { __HYPHON_E2E__?: { getAutomationPlaybackStep(): number } })
        .__HYPHON_E2E__?.getAutomationPlaybackStep(),
    );
    await page.screenshot({ path: test.info().outputPath('1389-playing.png') });
    await page.getByRole('button', { name: 'Stop Playback', exact: true }).click();

    expect(
      seen.size,
      `distinct highlighted steps in 2 s: [${[...seen].join(',')}], transport step=${transportStep}`,
    ).toBeGreaterThanOrEqual(2);
  });

  // #1390 -------------------------------------------------------------------
  // Screenshots: 1390-C5-held.png, 1390-E5-held.png
  test('#1390 live keyboard keys show a pressed state while held (C5, E5)', async () => {
    for (const note of ['C5', 'E5']) {
      // The keys sit inside an aria-hidden <svg>, so role queries skip them.
      const key = page.locator(`g[role="button"][aria-label="Play ${note}"]`);
      await key.scrollIntoViewIfNeeded();
      const box = await settledBox(key);
      // Lower part of a white key — the black keys cover the upper part.
      const at = { x: box.x + box.w / 2, y: box.y + box.h * 0.85 };
      const clip = { x: box.x, y: box.y, width: box.w, height: box.h };

      await expect(key).toHaveAttribute('aria-pressed', 'false');
      const before = await page.screenshot({ clip });

      await page.mouse.move(at.x, at.y);
      await page.mouse.down();
      try {
        await expect(key, `${note} aria-pressed while held`).toHaveAttribute('aria-pressed', 'true');
        const during = await page.screenshot({
          clip,
          path: test.info().outputPath(`1390-${note}-held.png`),
        });
        expect(
          during.equals(before),
          `${note}: pixels must change while the key is held`,
        ).toBe(false);
      } finally {
        await page.mouse.up();
      }
      await expect(key).toHaveAttribute('aria-pressed', 'false');
    }
  });
});

// ---------------------------------------------------------------------------
// #1396 — splash. Needs the splash only (not the booted app), and a
// deterministic "API present, no adapter" environment on every browser.
// ---------------------------------------------------------------------------

// Reproduced on main before 6799ab24 (splash read "WEBGPU: READY" because
// AppOverlays derived it from `'gpu' in navigator`); passes with that fix.
// Screenshot: 1396-splash.png
test('#1396 splash never claims WebGPU is available when requestAdapter() resolves null; no stray "SY" badge', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'gpu', {
      configurable: true,
      get: () => ({ requestAdapter: () => Promise.resolve(null) }),
    });
  });
  await page.goto('/?e2e=1');
  const overlay = page.getByTestId('start-overlay');
  await overlay.waitFor({ state: 'visible', timeout: 90_000 });
  // Let any async adapter probe settle before reading the status line.
  await page.waitForTimeout(3_000);
  await page.screenshot({ path: test.info().outputPath('1396-splash.png') });

  const check = overlay.getByRole('status');
  // textContent, not innerText: WebKit returns "" for innerText on this node.
  const text = ((await check.textContent()) ?? '').replace(/\s+/g, ' ');
  expect(text, 'splash SYSTEM CHECK text').toContain('WEBGPU:');
  expect(text, 'splash SYSTEM CHECK text').not.toMatch(/WEBGPU:\s*(READY|DETECTED)/i);
  expect(text, 'splash SYSTEM CHECK text').toMatch(/WEBGPU:\s*(NOT AVAILABLE|UNAVAILABLE)/i);

  await expect(page.getByText('SY', { exact: true })).toHaveCount(0);
});
