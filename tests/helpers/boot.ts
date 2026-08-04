import { expect, type Page, type Locator } from '@playwright/test';

/**
 * Shared Hyphon E2E boot helper (#1036).
 *
 * - Navigates with ?e2e=1 so window.__HYPHON_E2E__ introspection is registered.
 * - Dismisses StartOverlay via data-testid with a real click (AudioContext unlock).
 * - Waits for LoadingOverlay + transport before returning.
 * - Optionally asserts no hard AudioContext / WebGPU init failures during boot.
 *
 * Rack modules: use {@link openRackModule} — Rack mounts only `selectedTrack`.
 */

/**
 * Fail boot on real AudioContext / WebGPU *init* failures — not expected
 * EngineFallback messages when the VM/CI runner has no GPU adapter.
 */
const CONSOLE_FAIL_RE =
  /Failed to (start|create|resume).*AudioContext|AudioContext.*(not allowed|suspended permanently)|InvalidStateError.*AudioContext|WebGPU.*(device lost|validation error|uncaptured)/i;
const CONSOLE_IGNORE_RE =
  /Download the React DevTools|\[devtools\]|Supertonic TTS failed|rust-wasm|rust_audio|EngineFallback|requestAdapter\(\) returned null|worklet ready timeout/i;

export type BootOptions = {
  /** Extra query string without leading `?`. Default: `e2e=1`. */
  query?: string;
  /** Skip console-error assertion. */
  allowConsoleNoise?: boolean;
};

export async function initializeHyphonAudio(
  page: Page,
  options: BootOptions = {},
): Promise<void> {
  const errors: string[] = [];
  const onConsole = (msg: { type: () => string; text: () => string }) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (CONSOLE_IGNORE_RE.test(text)) return;
    if (CONSOLE_FAIL_RE.test(text)) errors.push(text);
  };
  const onPageError = (err: Error) => {
    if (CONSOLE_IGNORE_RE.test(err.message)) return;
    errors.push(err.message);
  };

  if (!options.allowConsoleNoise) {
    page.on('console', onConsole);
    page.on('pageerror', onPageError);
  }

  const qs = options.query ?? 'e2e=1';
  await page.goto(`/?${qs}`);

  const overlay = page.getByTestId('start-overlay');
  const startBtn = page.getByTestId('initialize-system');

  // 90s: cold Pyodide / hyphon_native.wasm warm-up on CI runners.
  await overlay.waitFor({ state: 'visible', timeout: 90_000 });
  await expect(startBtn).toBeEnabled({ timeout: 90_000 });

  // Real gesture required for AudioContext.resume() — especially WebKit.
  await startBtn.click();

  await overlay.waitFor({ state: 'hidden', timeout: 30_000 });

  // LoadingOverlay covers the rack until initializeAudio finishes. Waiting only
  // for Start Playback is insufficient (header stays mounted under the overlay).
  await expect(page.getByText('INITIALIZING AUDIO ENGINE')).toBeHidden({
    timeout: 120_000, // cold WASM / worklet warm-up on CI
  });

  await expect(
    page.getByRole('button', { name: 'Start Playback', exact: true }),
  ).toBeVisible({ timeout: 30_000 });

  // Dismiss non-blocking UI chrome that can steal clicks / confuse snapshots.
  const dismissWhatsNew = page.getByRole('button', { name: /Dismiss what's new/i });
  if (await dismissWhatsNew.isVisible().catch(() => false)) {
    await dismissWhatsNew.click().catch(() => undefined);
  }
  // HelpTip first-use pins (pointer-events-auto) sit over rack controls.
  await dismissHelpTips(page);
  const closeToast = page.getByRole('button', { name: 'Close notification' });
  while (await closeToast.count()) {
    await closeToast.first().click().catch(() => undefined);
    if (!(await closeToast.count())) break;
  }

  if (!options.allowConsoleNoise && errors.length > 0) {
    throw new Error(
      `Boot console/page errors (AudioContext/WebGPU):\n${errors.join('\n')}`,
    );
  }
}

/** Dismiss any pinned HelpTip / What's New "Dismiss" buttons. */
export async function dismissHelpTips(page: Page): Promise<void> {
  for (let i = 0; i < 8; i++) {
    const dismiss = page.getByRole('button', { name: 'Dismiss', exact: true });
    const n = await dismiss.count();
    if (n === 0) break;
    await dismiss.first().click({ force: true }).catch(() => undefined);
  }
}

/**
 * Native DOM click — bypasses Playwright hit-testing entirely.
 *
 * Kept for the rare control that is genuinely occluded, but prefer a real
 * `click()`: HardwareModule no longer swallows pointerdowns aimed at its DOM
 * overlays (#1035), so module controls respond to real user input and the specs
 * should exercise that path rather than a synthetic event a user cannot produce.
 */
export async function domClick(locator: Locator): Promise<void> {
  await locator.evaluate((el) => {
    if (el instanceof HTMLElement) el.click();
  });
}

/**
 * Sequencer row labels → rack modules. The Rack mounts ONLY `modules[selectedTrack]`,
 * so tests must select the track before querying a HardwareModule.
 */
export const RACK_TRACK_SELECT = {
  'SYNTH A': /Select Lead track/i,
  'SYNTH B': /Select Bass track/i,
  'BASS 2': /Select Bass2 track/i,
  Lead: /Select Lead track/i,
  Bass: /Select Bass track/i,
  Bass2: /Select Bass2 track/i,
} as const;

export type RackTrackKey = keyof typeof RACK_TRACK_SELECT;

/** OscillatorTypeSelector badge text → family (see OSCILLATOR_THEMES). */
export const OSC_FAMILY_BADGE = {
  open303: '303',
  jc303: 'JC',
  prophecy: 'PRO',
  rust: 'RS',
  javascript: 'JS',
} as const;

export type OscFamilyKey = keyof typeof OSC_FAMILY_BADGE;

/** Click the sequencer rowheader so the matching HardwareModule mounts in the rack. */
export async function selectRackTrack(page: Page, track: RackTrackKey): Promise<void> {
  const pattern = RACK_TRACK_SELECT[track];
  const row = page.getByRole('rowheader', { name: pattern });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.scrollIntoViewIfNeeded();
  await row.click();
}

/** Locate a rack HardwareModule by title fragment (e.g. `SYNTH B`, `BASS 2`). */
export function rackModule(page: Page, titleFragment: string) {
  return page.locator('.hyphon-rack-surface', { hasText: titleFragment }).first();
}

/** Select track (if needed) then return its mounted HardwareModule. */
export async function openRackModule(page: Page, track: RackTrackKey) {
  await selectRackTrack(page, track);
  const fragment =
    track === 'SYNTH A' || track === 'Lead'
      ? 'SYNTH A'
      : track === 'SYNTH B' || track === 'Bass'
        ? 'SYNTH B'
        : 'BASS 2';
  const mod = rackModule(page, fragment);
  await expect(mod).toBeVisible({ timeout: 15_000 });
  await mod.scrollIntoViewIfNeeded();
  return mod;
}

/**
 * Click a point on `target` that the element actually owns.
 *
 * HardwareModule stacks the knob REC ("R") buttons in an absolute overlay that
 * can land on the *centre* of a compact selector button — so a plain click is
 * (correctly) refused as intercepted, while `force: true` would silently
 * deliver the click to the REC button instead. A real user can still hit the
 * uncovered part of the control, so we probe across the target and click there.
 *
 * Throws if the target is covered edge to edge — that is a UI hit-target bug
 * worth failing on, not something to paper over.
 */
export async function clickControl(target: Locator): Promise<void> {
  await target.waitFor({ state: 'visible', timeout: 15_000 });
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error('clickControl: target has no bounding box');

  const clearFraction = await target.evaluate(
    (el, { b, fracs }) => {
      for (const f of fracs) {
        const hit = document.elementFromPoint(b.x + b.width * f, b.y + b.height / 2);
        if (hit && (hit === el || el.contains(hit))) return f;
      }
      return null;
    },
    { b: box, fracs: [0.5, 0.2, 0.8, 0.1, 0.9] },
  );

  if (clearFraction === null) {
    throw new Error(
      'clickControl: no unobstructed point on target — an overlay covers it entirely',
    );
  }
  await target.click({ position: { x: box.width * clearFraction, y: box.height / 2 } });
}

/**
 * Select an oscillator family via OscillatorTypeSelector (replaces legacy
 * `Select 303-saw waveform` buttons).
 *
 * Uses a real click: the knob canvas used to capture the pointer and cancel
 * these clicks, which is fixed in HardwareModule (#1035). HelpTip pins are
 * dismissed first, and `clickControl` steers around the REC overlay.
 */
export async function selectOscillatorFamily(
  module: Locator,
  family: OscFamilyKey,
): Promise<void> {
  const page = module.page();
  await dismissHelpTips(page);
  const group = module.getByRole('group', { name: 'Oscillator type selection' });
  await expect(group).toBeVisible({ timeout: 15_000 });
  const badge = OSC_FAMILY_BADGE[family];
  const btn = group.getByRole('button', { name: badge, exact: true });
  await clickControl(btn);
  await expect(btn).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 });
}

/** Click a Voice303Selector option with a real user click. */
export async function select303Voice(module: Locator, voiceName: RegExp): Promise<void> {
  const page = module.page();
  await dismissHelpTips(page);
  const voiceGroup = module.getByRole('group', { name: /303 voice selection/i });
  await expect(voiceGroup).toBeVisible({ timeout: 10_000 });
  // First-use HelpTip pins when the selector mounts — dismiss again.
  await dismissHelpTips(page);
  const btn = voiceGroup.getByRole('button', { name: voiceName });
  await clickControl(btn);
  await expect(btn).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 });
}

/** EngineStatusPill group in the transport header. */
export function engineStatusIndicators(page: Page) {
  return page.getByRole('status', { name: 'Active engine indicators' });
}
