/**
 * Strict fetch guard for unit tests — throws on any unmocked HTTP request.
 * Integration tests use vitest.setup.integration.ts instead.
 */

import './vitest.setup.ts';
import { afterEach, beforeEach, vi } from 'vitest';

type FetchMatcher = string | RegExp;

const suiteMatchers: FetchMatcher[] = [];
let originalFetch: typeof globalThis.fetch | undefined;

function resolveFetchUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function isAllowed(url: string): boolean {
  if (url.endsWith('.wasm?init') || url.includes('.wasm')) return true;

  return suiteMatchers.some((matcher) =>
    typeof matcher === 'string' ? url.includes(matcher) : matcher.test(url),
  );
}

/** Opt-in allowlist for a suite that must perform real fetch (rare in unit tier). */
export function allowFetch(...matchers: FetchMatcher[]): void {
  suiteMatchers.push(...matchers);
}

async function guardedFetchImpl(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const url = resolveFetchUrl(input);
  if (!isAllowed(url)) {
    throw new Error(
      `[test:unit] Unmocked fetch blocked: ${url}\n` +
        'Mock fetch in the test (vi.mocked(global.fetch).mockImplementation) or use allowFetch().',
    );
  }
  if (!originalFetch) {
    throw new Error(`[test:unit] fetch allowed for ${url} but no underlying fetch implementation`);
  }
  return originalFetch(input, init);
}

function ensureFetchMock(): ReturnType<typeof vi.fn> {
  if (originalFetch === undefined && typeof globalThis.fetch === 'function') {
    originalFetch = globalThis.fetch.bind(globalThis);
  }
  if (!vi.isMockFunction(globalThis.fetch)) {
    vi.stubGlobal('fetch', vi.fn(guardedFetchImpl));
  }
  return globalThis.fetch as ReturnType<typeof vi.fn>;
}

beforeEach(() => {
  suiteMatchers.length = 0;
  const fetchMock = ensureFetchMock();
  fetchMock.mockReset();
  fetchMock.mockImplementation(guardedFetchImpl);
});

afterEach(() => {
  suiteMatchers.length = 0;
});

ensureFetchMock();
