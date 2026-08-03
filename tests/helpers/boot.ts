import { expect, type Page } from '@playwright/test';

/**
 * Shared Hyphon E2E boot helper (#1036).
 *
 * - Navigates with ?e2e=1 so window.__HYPHON_E2E__ introspection is registered.
 * - Dismisses StartOverlay via data-testid with a real click (AudioContext unlock).
 * - Waits for transport controls before returning.
 * - Optionally asserts no AudioContext / WebGPU console errors during boot.
 *
 * Rack modules: use {@link rackModule} — HardwareModule roots use
 * `.hyphon-rack-surface`, not legacy `rounded-*` classes.
 */

const CONSOLE_FAIL_RE = /AudioContext|WebGPU/i;
const CONSOLE_IGNORE_RE =
  /Download the React DevTools|\[devtools\]|Supertonic TTS failed|rust-wasm|rust_audio/i;

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

  await expect(
    page.getByRole('button', { name: 'Start Playback', exact: true }),
  ).toBeVisible({ timeout: 60_000 });

  if (!options.allowConsoleNoise && errors.length > 0) {
    throw new Error(
      `Boot console/page errors (AudioContext/WebGPU):\n${errors.join('\n')}`,
    );
  }
}

/**
 * Sequencer row labels → rack modules. The Rack mounts ONLY `modules[selectedTrack]`,
 * so tests must select the track before querying a HardwareModule.
 */
export const RACK_TRACK_SELECT = {
  'SYNTH A': /Select Lead track/i,
  'SYNTH B': /Select Bass track(?!,)/i,
  'BASS 2': /Select Bass2 track/i,
  Lead: /Select Lead track/i,
  Bass: /Select Bass track(?!,)/i,
  Bass2: /Select Bass2 track/i,
} as const;

export type RackTrackKey = keyof typeof RACK_TRACK_SELECT;

/** Click the sequencer rowheader so the matching HardwareModule mounts in the rack. */
export async function selectRackTrack(page: Page, track: RackTrackKey): Promise<void> {
  const pattern = RACK_TRACK_SELECT[track];
  // Prefer exact Bass2 / Lead labels; "Bass track" must not match "Bass2".
  const row = page.getByRole('rowheader', { name: pattern });
  await expect(row).toBeVisible({ timeout: 30_000 });
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
  return mod;
}
