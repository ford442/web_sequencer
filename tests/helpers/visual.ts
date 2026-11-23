import { expect, type Page } from '@playwright/test';

/**
 * Shared helpers for the visual-regression matrix in tests/visual-showcase.spec.ts (Release 3/5).
 */

export interface Viewport {
  name: string;
  width: number;
  height: number;
  /** Tablets / phones: emulate a touch device so `(pointer: coarse)` and the compact layout kick in. */
  touch: boolean;
}

/** The supported size matrix. 390x844 is a phone: the app shows an explicit "best on a tablet or desktop" notice. */
export const VIEWPORTS: readonly Viewport[] = [
  { name: '1920x1080', width: 1920, height: 1080, touch: false },
  { name: '1440x900', width: 1440, height: 900, touch: false },
  { name: '1280x720', width: 1280, height: 720, touch: false },
  { name: '1024x768', width: 1024, height: 768, touch: true },
  { name: '768x1024', width: 768, height: 1024, touch: true },
  { name: '390x844', width: 390, height: 844, touch: true },
];

/** Smallest touch target (CSS px) for controls on a coarse pointer. */
export const MIN_TOUCH_PX = 32;

export interface LayoutAudit {
  viewport: { width: number; height: number };
  dpr: number;
  coarse: boolean;
  compact: boolean;
  /** document scrollWidth beyond the window: any value > 0 is a horizontal page scroll. */
  pageOverflowX: number;
  /** Visible header controls that extend past the window edge (clipped). */
  headerClipped: string[];
  /** Visible bottom-bar controls that extend past the window edge (unreachable: the bar does not scroll). */
  bottomBarClipped: string[];
  /** The header and the scrolling main region must not overlap. */
  headerOverlapsMain: boolean;
  /** Visible, interactive controls under MIN_TOUCH_PX in either axis (only reported on a coarse pointer). */
  smallTargets: string[];
  /** Smallest step cell, CSS px (0 when the grid is not mounted). */
  minStepPx: number;
}

/** Measured in the page: everything here is a fact about the rendered layout, not a pixel diff. */
export async function auditLayout(page: Page): Promise<LayoutAudit> {
  return page.evaluate((minTouch) => {
    const vw = window.innerWidth;
    const rectOf = (el: Element) => el.getBoundingClientRect();
    const visible = (el: Element) => {
      const r = rectOf(el);
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    };
    const label = (el: Element) =>
      `${el.tagName.toLowerCase()}[${el.getAttribute('aria-label') || (el.textContent ?? '').trim().slice(0, 18) || el.className.toString().slice(0, 24)}]`;

    const header = document.querySelector('.transport-toolbar');
    const main = document.getElementById('main-content');
    const headerClipped: string[] = [];
    header?.querySelectorAll('button, select, input').forEach((el) => {
      if (!visible(el)) return;
      const r = rectOf(el);
      if (r.right > vw + 1 || r.left < -1) headerClipped.push(`${label(el)} ${Math.round(r.left)}..${Math.round(r.right)}`);
    });

    const bar = document.querySelector('.hyphon-toolbar-bottom');
    const bottomBarClipped: string[] = [];
    // A bar that scrolls sideways keeps every control reachable (phone width): only a bar that
    // overflows WITHOUT scrolling hides controls.
    const barScrolls = !!bar && getComputedStyle(bar).overflowX !== 'visible' && bar.scrollWidth > bar.clientWidth;
    bar?.querySelectorAll('button, select, input').forEach((el) => {
      if (!visible(el) || barScrolls) return;
      const r = rectOf(el);
      if (r.right > vw + 1 || r.left < -1) bottomBarClipped.push(`${label(el)} ${Math.round(r.left)}..${Math.round(r.right)}`);
    });

    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const small: string[] = [];
    if (coarse) {
      const scope = document.querySelectorAll('.transport-toolbar button, [data-testid^="step-"]');
      scope.forEach((el) => {
        if (!visible(el)) return;
        const r = rectOf(el);
        if (r.width < minTouch || r.height < minTouch) small.push(`${label(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
      });
    }

    const steps = [...document.querySelectorAll('[data-testid^="step-"]')].filter(visible);
    const minStepPx = steps.length
      ? Math.min(...steps.map((el) => Math.min(rectOf(el).width, rectOf(el).height)))
      : 0;

    return {
      viewport: { width: vw, height: window.innerHeight },
      dpr: window.devicePixelRatio,
      coarse,
      compact: !!document.querySelector('.hyphon-compact'),
      pageOverflowX: Math.max(0, document.documentElement.scrollWidth - vw),
      headerClipped,
      bottomBarClipped,
      headerOverlapsMain: !!header && !!main && rectOf(header).bottom > rectOf(main).top + 1,
      smallTargets: small,
      minStepPx: Math.round(minStepPx),
    };
  }, MIN_TOUCH_PX);
}

/** Canvases whose backing store is smaller than their CSS box times devicePixelRatio (blurry when scaled up). */
export async function blurryCanvases(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('canvas')]
      .map((c) => {
        const r = c.getBoundingClientRect();
        return { c, r, dpr: window.devicePixelRatio };
      })
      .filter(({ r }) => r.width > 0 && r.height > 0)
      .filter(({ c, r, dpr }) => c.width < Math.floor(r.width * dpr) - 1 || c.height < Math.floor(r.height * dpr) - 1)
      .map(({ c, r, dpr }) => `${c.className.toString().slice(0, 30)} backing ${c.width}x${c.height} < css ${r.width.toFixed(1)}x${r.height.toFixed(1)} @${dpr}x`),
  );
}

/** Wait for web fonts and let transient toasts expire so a screenshot is not mid-animation. */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  const closeToast = page.getByRole('button', { name: 'Close notification' });
  for (let i = 0; i < 6 && (await closeToast.count()) > 0; i++) {
    await closeToast.first().click({ force: true }).catch(() => undefined);
  }
  await expect(closeToast).toHaveCount(0);
}

/** Cumulative layout shift observed since the page started (Chromium only; others return null). */
export async function installClsObserver(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __cls: number }).__cls = 0;
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
          if (!e.hadRecentInput) (window as unknown as { __cls: number }).__cls += e.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
    } catch {
      (window as unknown as { __cls: number | null }).__cls = null as never;
    }
  });
}

export async function readCls(page: Page): Promise<number | null> {
  return page.evaluate(() => (window as unknown as { __cls: number | null }).__cls);
}
