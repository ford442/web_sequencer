import type { BrowserContext, ConsoleMessage, Request, Response } from '@playwright/test';

/**
 * Strict "nothing is wrong" guard for tests/release-smoke.spec.ts (#1653).
 *
 * Attached at CONTEXT level, so it also sees dedicated workers, the
 * AudioWorklet fetches and the service worker — not just the page's own
 * traffic. Nothing here is tolerant by default: every `console.error`, every
 * uncaught page error, every response with status >= 400 and every
 * `requestfailed` is recorded as a finding. The ONLY exceptions are the
 * entries in the allowlists below, and each one needs a reason that a reviewer
 * can challenge. Prefer fixing the app over adding a line here.
 */

export interface Allow {
  /** Matched against the message / URL. */
  pattern: RegExp;
  /** Why this is expected and harmless — required, reviewed like code. */
  reason: string;
}

/**
 * console.error / pageerror text that is allowed. Keep this list short: the production build
 * must boot, play and export without console errors. Add an entry only with a reason and, for
 * anything that is not environmental, a link to the issue tracking its removal.
 */
export const CONSOLE_ERROR_ALLOWLIST: readonly Allow[] = [
  {
    // Logged at error level by logEngineFallback when the host has no GPU adapter (headless CI,
    // VMs, some Linux drivers). The app degrades to WASM oscillators / 2D knobs by design; the
    // spec reports it under engineHealth. Narrow on purpose: only the "no adapter" case, only
    // for webgpu — a device-lost or validation error still fails.
    pattern: /^\[EngineFallback\] webgpu: .*requestAdapter\(\) returned null/,
    reason: 'WebGPU adapter absent on this host; documented WASM/2D fallback',
  },
];

/**
 * Requests that may fail or return >= 400.
 *
 * `net::ERR_ABORTED` on a request the page itself cancelled is NOT a failure
 * of the app (navigation away / `AbortController` after the response is no
 * longer needed); it is filtered in `isBenignAbort`, not here, so that a real
 * network failure with any other error text is never hidden.
 */
export const REQUEST_ALLOWLIST: readonly Allow[] = [];

/**
 * Static-asset URLs that may be answered with an HTML page (SPA fallback) instead of the file.
 *
 * The TTS ONNX models are gitignored and deployed separately (download_models.sh). The app probes
 * them at boot and treats "not there" as a supported state (TTS off, one info log), so a host
 * without them legitimately answers these URLs with index.html. The spec's TTS test still checks
 * whether the models are present before exercising TTS. Anything else answering HTML is a miss.
 */
export const HTML_ASSET_ALLOWLIST: readonly Allow[] = [
  { pattern: /\/assets\/onnx\//, reason: 'TTS models are optional and deployed separately' },
];

export interface Finding {
  kind: 'console.error' | 'pageerror' | 'http>=400' | 'html-for-asset' | 'requestfailed';
  detail: string;
  url?: string;
  at: number;
}

export interface GuardReport {
  consoleLog: string[];
  findings: Finding[];
  failedRequests: string[];
}

/** Paths that are files, never routes: an HTML body for one of these is a miss, not a page. */
const STATIC_ASSET_RE = /\.(wasm|wav|mp3|ogg|js|mjs|json|onnx|zip|png|jpe?g|svg|webp|css|woff2?|bin|data)$/i;

const allowed = (list: readonly Allow[], text: string) => list.some((a) => a.pattern.test(text));

/**
 * A request the page aborted on purpose (reload mid-flight, AbortController
 * after a timeout race). Playwright reports these as `net::ERR_ABORTED`
 * (Chromium). Only counted benign when `reloading` is set by the spec around
 * an intentional `page.reload()` — otherwise an abort is a finding.
 */
export class ReleaseGuard {
  readonly findings: Finding[] = [];
  readonly consoleLog: string[] = [];
  readonly requests: { url: string; status: number }[] = [];
  /** Set true by the spec only around an intentional reload / navigation. */
  reloading = false;
  private readonly start = Date.now();

  attach(context: BrowserContext): void {
    context.on('console', (msg: ConsoleMessage) => {
      const text = msg.text();
      this.consoleLog.push(`[${msg.type()}] ${text}`);
      if (msg.type() !== 'error') return;
      if (allowed(CONSOLE_ERROR_ALLOWLIST, text)) return;
      this.findings.push({
        kind: 'console.error',
        detail: text,
        url: msg.location().url || undefined,
        at: Date.now() - this.start,
      });
    });
    context.on('weberror', (err) => {
      const text = err.error().stack ?? String(err.error());
      this.consoleLog.push(`[pageerror] ${text}`);
      if (allowed(CONSOLE_ERROR_ALLOWLIST, text)) return;
      this.findings.push({ kind: 'pageerror', detail: text, at: Date.now() - this.start });
    });
    context.on('response', (res: Response) => {
      const url = res.url();
      this.requests.push({ url, status: res.status() });
      if (allowed(REQUEST_ALLOWLIST, url)) return;
      // SPA hosts answer a MISSING static file with 200 + index.html, which a status check never
      // sees (the app then fails later with "magic word" / JSON parse errors).
      if (res.status() < 400) {
        const type = res.headers()['content-type'] ?? '';
        if (STATIC_ASSET_RE.test(new URL(url).pathname) && /text\/html/i.test(type) && !allowed(HTML_ASSET_ALLOWLIST, url)) {
          this.findings.push({
            kind: 'html-for-asset',
            detail: `${res.status()} ${res.request().method()} ${url} answered with ${type} (missing file behind an SPA fallback?)`,
            url,
            at: Date.now() - this.start,
          });
        }
        return;
      }
      this.findings.push({
        kind: 'http>=400',
        detail: `${res.status()} ${res.request().method()} ${url}`,
        url,
        at: Date.now() - this.start,
      });
    });
    context.on('requestfailed', (req: Request) => {
      const url = req.url();
      const failure = req.failure()?.errorText ?? 'unknown';
      if (allowed(REQUEST_ALLOWLIST, url)) return;
      if (this.reloading && /ERR_ABORTED/.test(failure)) return;
      this.findings.push({
        kind: 'requestfailed',
        detail: `${failure} ${req.method()} ${url}`,
        url,
        at: Date.now() - this.start,
      });
    });
  }

  /** Findings recorded since the last call; the report keeps the full history. */
  private reported = 0;
  drain(): Finding[] {
    const fresh = this.findings.slice(this.reported);
    this.reported = this.findings.length;
    return fresh;
  }

  report(): GuardReport {
    return {
      consoleLog: this.consoleLog,
      findings: this.findings,
      failedRequests: this.findings
        .filter((f) => f.kind === 'http>=400' || f.kind === 'html-for-asset' || f.kind === 'requestfailed')
        .map((f) => f.detail),
    };
  }
}

/** Human-readable failure message for a non-empty drain. */
export function formatFindings(findings: readonly Finding[]): string {
  return findings.map((f) => `  ${f.kind}: ${f.detail}`).join('\n');
}
