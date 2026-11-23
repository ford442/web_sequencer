import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { dismissHelpTips } from './helpers/boot';
import { startPlaybackAndAwaitClock } from './helpers/rbs-e2e';
import { ReleaseGuard, formatFindings } from './helpers/release-guard';

/**
 * Fast production smoke (#1653, Release 2/5). Chromium only, one boot per flow
 * group, budgeted well under 5 minutes.
 *
 * Runs against EITHER
 *   - `vite preview` of `dist/` (the default, via playwright.config.ts), or
 *   - a deployed build: `DEPLOY_SMOKE_URL=https://host/hyphon/ pnpm exec playwright test tests/release-smoke.spec.ts`
 *
 * It fails on anything a user would be affected by but a functional assertion
 * would not notice:
 *   - any console.error / uncaught page error        (allowlist: helpers/release-guard.ts)
 *   - any HTTP response >= 400 or failed request      (allowlist: helpers/release-guard.ts)
 *   - crossOriginIsolated !== true (pthread wasm cannot start without it)
 *   - a native engine resolving to a JS fallback instead of hyphon_native
 *     (Open303 / Prophecy / drum kit silently drop to JS when the glue and wasm
 *     do not match — the page still "works", it just sounds wrong)
 *
 * Writes `release-smoke-report/` (report.json + screenshots) for the
 * "State of the App" report. Override the directory with RELEASE_SMOKE_OUT.
 */

const DEPLOY_URL = process.env.DEPLOY_SMOKE_URL?.replace(/\/?$/, '/');
const OUT_DIR = process.env.RELEASE_SMOKE_OUT ?? 'release-smoke-report';
const BASE_URL = DEPLOY_URL ?? 'http://127.0.0.1:5173/';

test.describe.configure({ mode: 'serial' });
test.skip(({ browserName }) => browserName !== 'chromium', 'release smoke is Chromium-only (WebKit/Firefox are covered by the matrix)');
// The shared page is created manually, so `use.baseURL` does not apply to it:
// every navigation below is an absolute URL built from BASE_URL.
const url = (query = '') => new URL(query ? `./?${query}` : './', BASE_URL).href;

/** Backends that mean "running on hyphon_native" (see hyphonNativeBackendName + the engines' registerResolution calls). */
const NATIVE_BACKENDS = new Set(['wasm-native', 'wasm-native-st', 'wasm-worklet', 'open303']);
/**
 * Subsystems that MUST resolve to a native backend after INITIALIZE SYSTEM. A fallback registers
 * `fallback` / `js` / `webaudio` instead, which is not in NATIVE_BACKENDS and fails the check.
 */
const REQUIRED_NATIVE = ['open303', 'jc303', 'prophecy', 'macro', 'drumkit'] as const;
/**
 * Subsystems whose degradation is decided by the HOST having a GPU adapter, not by the build.
 * Headless CI runners have none, so WebGPU → WASM/2D fallback is expected there and is NOT a
 * native-engine fallback. They are still recorded in the report (summary.engineHealth).
 */
const GPU_DEPENDENT = new Set(['webgpu', 'oscillators', 'gpu-knobs', 'gpu-highfid', 'webgpu-compute']);

type EngineHealth = {
  nativeStatus: 'pending' | 'ready' | 'failed';
  resolutions: Record<string, string | null>;
  fallbacks: { subsystem: string; requestedBackend: string; reason: string }[];
  degradations: { id: string; subsystem: string; message: string; reason: string | null }[];
};

const guard = new ReleaseGuard();
const flowLog: { step: string; ms: number }[] = [];
const downloads: Record<string, { filename: string; bytes: number; head: string }> = {};
const summary: Record<string, unknown> = {};
let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  mkdirSync(OUT_DIR, { recursive: true });
  context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  guard.attach(context);
  page = await context.newPage();
});

test.afterAll(async () => {
  const report = {
    baseUrl: BASE_URL,
    mode: DEPLOY_URL ? 'deployed' : 'preview',
    ...summary,
    downloads,
    flowLog,
    ...guard.report(),
  };
  writeFileSync(join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
  await context?.close();
});

async function shot(name: string): Promise<void> {
  await page.screenshot({ path: join(OUT_DIR, `${name}.png`) });
}

/** Run one named flow step, time it, and fail it on any console/network finding it caused. */
async function step<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  const out = await test.step(name, fn);
  flowLog.push({ step: name, ms: Date.now() - t0 });
  const fresh = guard.drain();
  // Throw (not expect().toEqual) so the failure is the readable list, not the list plus a diff of it.
  if (fresh.length > 0) throw new Error(`${fresh.length} console/network finding(s) during "${name}":\n${formatFindings(fresh)}`);
  return out;
}

async function engineHealth(): Promise<EngineHealth> {
  return page.evaluate(() => {
    const hooks = (window as unknown as { __HYPHON_E2E__?: { getEngineHealth?: () => unknown } }).__HYPHON_E2E__;
    if (!hooks?.getEngineHealth) throw new Error('?e2e=1 hook getEngineHealth is missing from this build');
    return hooks.getEngineHealth();
  }) as Promise<EngineHealth>;
}

/** Cold load → INITIALIZE SYSTEM → transport visible. Real click: it unlocks the AudioContext. */
async function boot(query: string): Promise<void> {
  await page.goto(url(query), { waitUntil: 'domcontentloaded' });
  // First, so a host missing COOP/COEP is reported as THE cause rather than as a pile of
  // downstream wasm/SharedArrayBuffer errors.
  const isolated = await page.evaluate(() => self.crossOriginIsolated);
  summary.crossOriginIsolated = isolated;
  expect(isolated, 'crossOriginIsolated is false: the host is not sending COOP same-origin + COEP require-corp, so SharedArrayBuffer (pthread hyphon_native) cannot start').toBe(true);
  const overlay = page.getByTestId('start-overlay');
  const start = page.getByTestId('initialize-system');
  await overlay.waitFor({ state: 'visible', timeout: 90_000 });
  await expect(start).toBeEnabled({ timeout: 120_000 });
  await start.click();
  await overlay.waitFor({ state: 'hidden', timeout: 30_000 });
  await expect(page.getByText('INITIALIZING AUDIO ENGINE')).toBeHidden({ timeout: 120_000 });
  await expect(page.getByRole('button', { name: 'Start Playback', exact: true })).toBeVisible({ timeout: 30_000 });
  const whatsNew = page.getByRole('button', { name: /Dismiss what's new/i });
  if (await whatsNew.isVisible().catch(() => false)) await whatsNew.click().catch(() => undefined);
  await dismissHelpTips(page);
}

const cell = (id: string) => page.getByTestId(id);
/** Sequencer cells are SVG: scroll into view, then use the keyboard path the app documents (Enter). */
async function activate(id: string): Promise<void> {
  const c = cell(id);
  await c.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'nearest' }));
  await expect(c, `${id} must start inactive`).toHaveAttribute('aria-pressed', 'false');
  await c.press('Enter');
  await expect(c, `${id} did not activate`).toHaveAttribute('aria-pressed', 'true');
}

async function expectDownload(label: string, trigger: () => Promise<void>, magic: string, minBytes: number): Promise<void> {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 180_000 }), trigger()]);
  const buf = readFileSync(await dl.path());
  downloads[label] = { filename: dl.suggestedFilename(), bytes: buf.length, head: buf.subarray(0, 24).toString('latin1') };
  expect(buf.length, `${label} export is empty`).toBeGreaterThan(minBytes);
  expect(buf.subarray(0, magic.length).toString('latin1'), `${label} export has the wrong signature`).toBe(magic);
  return void (await dl.saveAs(join(OUT_DIR, dl.suggestedFilename())));
}

test('cold load (no test flags): isolated, boots, transport plays and stops', async () => {
  await step('cold load → INITIALIZE SYSTEM', async () => {
    // No ?e2e=1 here: this is the exact URL a user opens, service worker included.
    await boot('');
    await shot('01-boot');
  });

  await step('play / stop transport', async () => {
    await startPlaybackAndAwaitClock(page);
    await shot('02-playing');
    await page.getByRole('button', { name: 'Stop Playback' }).click();
    await expect(page.getByRole('button', { name: 'Start Playback', exact: true })).toBeVisible();
  });

  await step('served build identity', async () => {
    const res = await context.request.get(new URL('native-artifacts.json', BASE_URL).href);
    expect(res.ok(), 'native-artifacts.json must be served (build:release writes it)').toBe(true);
    const manifest = (await res.json()) as { sources?: { gitHead?: string } };
    summary.servedCommit = manifest.sources?.gitHead ?? null;
    expect(summary.servedCommit, 'served build has no gitHead').toBeTruthy();
  });
});

test.describe('core flows (?e2e=1 hooks)', () => {
  test.beforeAll(async () => {
    await boot('e2e=1');
  });

  test('native engines are on hyphon_native, not a JS fallback', async () => {
    await step('engine resolution', async () => {
      await expect
        .poll(async () => (await engineHealth()).nativeStatus, { timeout: 30_000, message: 'hyphon_native probe never settled' })
        .toBe('ready');
      // Voices register their resolution as their worklet comes up; give the late ones a moment.
      await expect
        .poll(
          async () => {
            const h = await engineHealth();
            return REQUIRED_NATIVE.filter((s) => !NATIVE_BACKENDS.has(h.resolutions[s] ?? '')).map(
              (s) => `${s}=${h.resolutions[s]}`,
            );
          },
          { timeout: 30_000, message: 'a native engine did not resolve to hyphon_native' },
        )
        .toEqual([]);
      const health = await engineHealth();
      summary.engineHealth = health;
      expect(
        health.fallbacks.filter((f) => !GPU_DEPENDENT.has(f.subsystem)),
        'engines reported a JS fallback',
      ).toEqual([]);
      expect(
        health.degradations.filter((d) => !GPU_DEPENDENT.has(d.subsystem) && d.subsystem !== 'tts'),
        'active engine degradations',
      ).toEqual([]);
    });
  });

  test('toggle steps on synth, drum and sampler tracks', async () => {
    await step('toggle steps', async () => {
      // Clicking an ACTIVE step selects it (it does not erase), so only off → on is asserted.
      await activate('step-partA-3');
      await activate('step-kick-5');
      await activate('step-sampler-2');
    });
  });

  test('switch pattern slots; slots hold independent patterns', async () => {
    await step('pattern slots', async () => {
      const slot = (n: number) => page.getByRole('button', { name: `Pattern Slot ${n}` }).first();
      await expect(slot(1)).toHaveAttribute('aria-pressed', 'true');
      await activate('step-partB-9'); // lives in slot 1
      await slot(2).click();
      await expect(slot(2)).toHaveAttribute('aria-pressed', 'true');
      await expect(slot(1)).toHaveAttribute('aria-pressed', 'false');
      await activate('step-partA-10'); // lives in slot 2 (SYNTH A row)
      await slot(1).click();
      await expect(slot(1)).toHaveAttribute('aria-pressed', 'true');
      await expect(cell('step-partA-10'), 'slot 2 edit leaked into slot 1').toHaveAttribute('aria-pressed', 'false');
      await slot(2).click();
      await expect(cell('step-partA-10'), 'slot 2 lost its edit').toHaveAttribute('aria-pressed', 'true');
      await slot(1).click();
    });
  });

  test('change a synth knob', async () => {
    await step('synth knob', async () => {
      await expect(page.getByRole('rowheader', { name: /Select Lead track, Selected/i })).toBeVisible();
      const cutoff = page.getByRole('slider', { name: /^CUTOFF/i }).first();
      await cutoff.scrollIntoViewIfNeeded();
      const before = Number(await cutoff.getAttribute('aria-valuenow'));
      await cutoff.focus();
      await cutoff.press('ArrowUp');
      await cutoff.press('ArrowUp');
      await expect(cutoff).toHaveAttribute('aria-valuenow', String(before + 10));
    });
  });

  test('song / arrangement mode toggles; XM export is a real file', async () => {
    await step('song mode', async () => {
      await page.getByRole('button', { name: 'Toggle Song Mode' }).click();
      await expect(page.getByText('SONG ARRANGER')).toBeVisible();
      const loop = page.getByRole('button', { name: /Loop (Song|Pattern) Mode Active/ });
      await expect(loop).toHaveAccessibleName('Loop Pattern Mode Active');
      await loop.click();
      await expect(loop).toHaveAccessibleName('Loop Song Mode Active');
      await loop.click();
      await expect(loop).toHaveAccessibleName('Loop Pattern Mode Active');
    });

    await step('export XM', async () => {
      await expectDownload(
        'xm',
        () => page.getByRole('button', { name: 'Export as XM file' }).click(),
        'Extended Module: ',
        1_000,
      );
      await shot('03-export-xm-done');
      await page.getByRole('button', { name: 'Close Song Mode' }).click();
    });

    await step('arrangement timeline', async () => {
      await page.getByRole('button', { name: 'Toggle Arrangement' }).click();
      await expect(page.getByRole('region', { name: 'Arrangement timeline' })).toBeVisible();
      await page.getByRole('button', { name: 'Toggle Arrangement' }).click();
      await expect(page.getByRole('region', { name: 'Arrangement timeline' })).toBeHidden();
    });
  });

  test('audio export (dry stems ZIP) is a real file', async () => {
    await step('export stems', async () => {
      await page.getByRole('button', { name: 'Export dry stems as ZIP' }).click();
      const dialog = page.getByRole('dialog', { name: /export/i });
      await expect(dialog).toBeVisible();
      // Current pattern only: the point is the offline render + zip path, not a long bounce.
      await dialog.getByLabel(/Use song arrangement/).uncheck();
      await expectDownload('stems', () => dialog.getByRole('button', { name: 'Download ZIP' }).click(), 'PK', 10_000);
      await expect(dialog).toBeHidden({ timeout: 30_000 });
      await shot('04-export-stems-done');
    });
  });

  test('save, reload, load restores the session', async () => {
    const saved = join(OUT_DIR, 'session.json');
    await step('save project JSON', async () => {
      await activate('step-partB-20');
      await expectDownload('session', () => page.getByRole('button', { name: 'Save project to JSON' }).click(), '{', 1_000);
      const dl = downloads.session;
      expect(dl.filename).toMatch(/\.json$/);
      copyFileSync(join(OUT_DIR, dl.filename), saved);
      JSON.parse(readFileSync(saved, 'utf8')); // valid JSON, not a truncated write
    });

    await step('reload: fresh state', async () => {
      guard.reloading = true; // in-flight fetches are legitimately aborted by the navigation
      try {
        await boot('e2e=1');
      } finally {
        guard.reloading = false;
      }
      await expect(cell('step-partB-20'), 'precondition: reload starts from the default session').toHaveAttribute(
        'aria-pressed',
        'false',
      );
    });

    await step('load project JSON restores state', async () => {
      const [chooser] = await Promise.all([
        page.waitForEvent('filechooser'),
        page.getByRole('button', { name: 'Load project from JSON' }).click(),
      ]);
      await chooser.setFiles(saved);
      await expect(cell('step-partB-20'), 'session did not restore after load').toHaveAttribute('aria-pressed', 'true', {
        timeout: 30_000,
      });
      await shot('05-session-restored');
    });
  });

  test('TTS initialises when models are present (skipped otherwise)', async () => {
    // Models are gitignored and downloaded separately (download_models.sh). A host without them
    // answers with the SPA's HTML page, so check the content type, not only the status.
    const res = await context.request.get(new URL('assets/onnx/tts.json', BASE_URL).href);
    const present = res.ok() && /json/i.test(res.headers()['content-type'] ?? '');
    summary.ttsModelsPresent = present;
    test.skip(!present, 'TTS models are not deployed here (assets/onnx/tts.json)');
    await step('TTS ready', async () => {
      await expect
        .poll(async () => (await engineHealth()).degradations.filter((d) => d.subsystem === 'tts'), { timeout: 60_000 })
        .toEqual([]);
    });
  });
});
