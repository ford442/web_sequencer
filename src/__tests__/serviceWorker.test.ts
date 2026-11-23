// @vitest-environment node
/**
 * public/sw.js fetch / precache logic against a fake Cache Storage (#1659).
 *
 * The real worker source is evaluated unchanged (see src/test/swHarness.ts), so
 * these tests fail if the worker regresses, not just if a copy of it does.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadServiceWorker, makeRequest, type SwHarness } from '@/test/swHarness';

const SCOPE = 'https://hyphon.test/';

/** What the static host answers with: `Vary: Origin` (vite preview / any CORS-aware host). */
const HOST_HEADERS = { Vary: 'Origin', 'Cross-Origin-Resource-Policy': 'same-origin' };

function serveManifest(sw: SwHarness, shell: string[]): void {
  sw.network.serve(
    `${sw.scope}precache-manifest.json`,
    JSON.stringify({ version: 'v', generatedAt: 0, shell }),
    { 'Content-Type': 'application/json' },
  );
}

/** Installs a worker whose shell is the given paths, each served with the given headers. */
async function installed(
  shell: string[],
  headers: Record<string, string> = HOST_HEADERS,
  scope = SCOPE,
): Promise<SwHarness> {
  const sw = loadServiceWorker({ scope });
  for (const entry of shell) {
    sw.network.serve(new URL(entry, scope).href, `body of ${entry}`, headers);
  }
  serveManifest(sw, shell); // last: the manifest lists itself, and must not be overwritten by its own placeholder body
  await sw.install();
  return sw;
}

const BUNDLE = './assets/index-abc123.js';
const SHELL = ['./', './index.html', './manifest.webmanifest', './precache-manifest.json', BUNDLE];

describe('sw.js — precache hit', () => {
  it('serves a precached module script with the network gone, even though the host sends Vary: Origin (#1659)', async () => {
    const sw = await installed(SHELL);
    sw.network.offline = true;

    // Chromium attaches `Origin` to same-origin crossorigin module scripts and
    // stylesheets; the worker's own fetch(url) at install time did not.
    const req = makeRequest(`${SCOPE}assets/index-abc123.js`, {
      mode: 'cors',
      headers: { origin: 'https://hyphon.test' },
    });
    const { handled, response } = await sw.fetchEvent(req);

    expect(handled).toBe(true);
    expect(response?.type).not.toBe('error');
    expect(await response?.text()).toBe(`body of ${BUNDLE}`);
    expect(sw.network.requested.filter((u) => u.endsWith('index-abc123.js'))).toHaveLength(1); // install only
  });

  it('the fake cache really enforces Vary, so the regression above is meaningful', async () => {
    const sw = await installed(SHELL);
    const cache = await sw.caches.open(sw.precacheName);
    const req = makeRequest(`${SCOPE}assets/index-abc123.js`, { headers: { origin: 'https://hyphon.test' } });

    expect(await cache.match(req)).toBeUndefined(); // what the pre-fix worker did
    expect(await cache.match(req, { ignoreVary: true })).toBeDefined(); // what it does now
    expect(await cache.match(req.url)).toBeDefined(); // a bare URL string carries no headers
  });

  it('hits for a request without Origin too, and for a host that sends no Vary at all', async () => {
    const sw = await installed(SHELL, { 'Cross-Origin-Resource-Policy': 'same-origin' });
    sw.network.offline = true;
    const withAndWithoutOrigin: Record<string, string>[] = [{}, { origin: 'https://hyphon.test' }];
    for (const headers of withAndWithoutOrigin) {
      const { response } = await sw.fetchEvent(makeRequest(`${SCOPE}assets/index-abc123.js`, { headers }));
      expect(await response?.text()).toBe(`body of ${BUNDLE}`);
    }
  });

  it('does not touch the network when the precache answers', async () => {
    const sw = await installed(SHELL);
    const before = sw.network.requested.length;
    await sw.fetchEvent(makeRequest(`${SCOPE}assets/index-abc123.js`));
    expect(sw.network.requested).toHaveLength(before);
  });
});

describe('sw.js — key normalisation', () => {
  it('stores every manifest entry under an absolute URL inside the scope', async () => {
    const sw = await installed(SHELL);
    const keys = (await (await sw.caches.open(sw.precacheName)).keys()).map((k) => k.url).sort();
    expect(keys).toEqual(
      [
        'https://hyphon.test/',
        'https://hyphon.test/assets/index-abc123.js',
        'https://hyphon.test/index.html',
        'https://hyphon.test/manifest.webmanifest',
        'https://hyphon.test/precache-manifest.json',
      ].sort(),
    );
  });

  it('resolves keys and lookups against the scope under a subdirectory deployment', async () => {
    const scope = 'https://hyphon.test/hyphon/';
    const sw = await installed(SHELL, HOST_HEADERS, scope);
    sw.network.offline = true;

    const keys = (await (await sw.caches.open(sw.precacheName)).keys()).map((k) => k.url);
    expect(keys).toContain('https://hyphon.test/hyphon/assets/index-abc123.js');
    expect(keys).toContain('https://hyphon.test/hyphon/');

    const { response } = await sw.fetchEvent(
      makeRequest(`${scope}assets/index-abc123.js`, { headers: { origin: 'https://hyphon.test' } }),
    );
    expect(await response?.text()).toBe(`body of ${BUNDLE}`);

    const nav = await sw.fetchEvent(makeRequest(`${scope}?e2e=1&pwa=1`, { mode: 'navigate' }));
    expect(await nav.response?.text()).toBe('body of ./index.html');
  });

  it('ignores a URL fragment when matching', async () => {
    const sw = await installed(SHELL);
    sw.network.offline = true;
    const { response } = await sw.fetchEvent(makeRequest(`${SCOPE}assets/index-abc123.js#x`));
    expect(await response?.text()).toBe(`body of ${BUNDLE}`);
  });
});

describe('sw.js — runtime cache', () => {
  const WASM = `${SCOPE}hyphon_native.wasm`;

  it('caches a runtime asset on first controlled fetch and serves it offline', async () => {
    const sw = await installed(SHELL);
    sw.network.serve(WASM, 'wasm-bytes', HOST_HEADERS);

    const first = await sw.fetchEvent(makeRequest(WASM, { headers: { origin: 'https://hyphon.test' } }));
    expect(await first.response?.text()).toBe('wasm-bytes');
    await first.settle(); // event.waitUntil(cache.put(...))

    sw.network.offline = true;
    // The second request arrives without the Origin header the first had.
    const second = await sw.fetchEvent(makeRequest(WASM));
    expect(await second.response?.text()).toBe('wasm-bytes');
  });

  it('stamps Cross-Origin-Resource-Policy on a stored response that lacks it', async () => {
    const sw = await installed(SHELL);
    sw.network.serve(WASM, 'wasm-bytes', { 'Content-Type': 'application/wasm' });
    const first = await sw.fetchEvent(makeRequest(WASM));
    await first.settle();
    sw.network.offline = true;
    const { response } = await sw.fetchEvent(makeRequest(WASM));
    expect(response?.headers.get('Cross-Origin-Resource-Policy')).toBe('cross-origin');
    expect(response?.headers.get('Content-Type')).toBe('application/wasm');
    expect(await response?.text()).toBe('wasm-bytes');
  });

  it('keeps a CORP header the host already sent', async () => {
    const sw = await installed(SHELL);
    sw.network.serve(WASM, 'wasm-bytes', { 'Cross-Origin-Resource-Policy': 'same-origin' });
    await (await sw.fetchEvent(makeRequest(WASM))).settle();
    sw.network.offline = true;
    const { response } = await sw.fetchEvent(makeRequest(WASM));
    expect(response?.headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin');
  });

  it('does not cache an error response', async () => {
    const sw = await installed(SHELL);
    sw.network.serve(WASM, 'nope', {}, 500);
    await (await sw.fetchEvent(makeRequest(WASM))).settle();
    sw.network.offline = true;
    const { response } = await sw.fetchEvent(makeRequest(WASM));
    expect(response?.type).toBe('error');
  });

  it('matches runtime directory prefixes against the scope (subdirectory deployment)', async () => {
    const scope = 'https://hyphon.test/hyphon/';
    const sw = await installed(SHELL, HOST_HEADERS, scope);
    const url = `${scope}pyodide/pyodide.asm.data`;
    sw.network.serve(url, 'py', HOST_HEADERS);
    await (await sw.fetchEvent(makeRequest(url))).settle();
    sw.network.offline = true;
    const { response } = await sw.fetchEvent(makeRequest(url));
    expect(await response?.text()).toBe('py');
  });
});

describe('sw.js — offline miss', () => {
  it('answers an uncached runtime asset with an explicit network error, not a rejected promise', async () => {
    const sw = await installed(SHELL);
    sw.network.offline = true;
    const { handled, response } = await sw.fetchEvent(makeRequest(`${SCOPE}saw.wav`));
    expect(handled).toBe(true);
    expect(response?.type).toBe('error');
  });

  it('answers an uncached ordinary asset with an explicit network error', async () => {
    const sw = await installed(SHELL);
    sw.network.offline = true;
    const { response } = await sw.fetchEvent(makeRequest(`${SCOPE}api/whatever.json`));
    expect(response?.type).toBe('error');
  });

  it('falls back to the runtime cache for a non-runtime-pattern URL that was cached', async () => {
    const sw = await installed(SHELL);
    const runtime = await sw.caches.open(sw.runtimeName);
    await runtime.put(`${SCOPE}extra.json`, new Response('cached-extra', { headers: HOST_HEADERS }));
    sw.network.offline = true;
    const { response } = await sw.fetchEvent(makeRequest(`${SCOPE}extra.json`, { headers: { origin: 'x' } }));
    expect(await response?.text()).toBe('cached-extra');
  });

  it('passes a network response through when online and uncached', async () => {
    const sw = await installed(SHELL);
    sw.network.serve(`${SCOPE}live.json`, 'live');
    const { response } = await sw.fetchEvent(makeRequest(`${SCOPE}live.json`));
    expect(await response?.text()).toBe('live');
  });
});

describe('sw.js — navigation', () => {
  const nav = (url = `${SCOPE}?e2e=1&pwa=1`) => makeRequest(url, { mode: 'navigate', headers: {} });

  it('prefers the network when online', async () => {
    const sw = await installed(SHELL);
    sw.network.serve(`${SCOPE}?e2e=1&pwa=1`, 'fresh html');
    const { response } = await sw.fetchEvent(nav());
    expect(await response?.text()).toBe('fresh html');
  });

  it('falls back to the precached index.html when offline', async () => {
    const sw = await installed(SHELL);
    sw.network.offline = true;
    const { response } = await sw.fetchEvent(nav());
    expect(await response?.text()).toBe('body of ./index.html');
  });

  describe('when the network never settles', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('falls back to index.html after the 4 s network timeout', async () => {
      const sw = await installed(SHELL);
      sw.network.hang = true;
      const pending = sw.fetchEvent(nav());
      await vi.advanceTimersByTimeAsync(4000);
      const { response } = await pending;
      expect(await response?.text()).toBe('body of ./index.html');
    });

    it('answers an uncached asset with a network error after the timeout', async () => {
      const sw = await installed(SHELL);
      sw.network.hang = true;
      const pending = sw.fetchEvent(makeRequest(`${SCOPE}live.json`));
      await vi.advanceTimersByTimeAsync(4000);
      expect((await pending).response?.type).toBe('error');
    });
  });

  it('answers with a network error when offline and nothing was ever precached', async () => {
    const sw = loadServiceWorker();
    sw.network.offline = true;
    const { response } = await sw.fetchEvent(nav());
    expect(response?.type).toBe('error');
  });
});

describe('sw.js — what it leaves alone', () => {
  it('does not intercept cross-origin requests', async () => {
    const sw = await installed(SHELL);
    const { handled } = await sw.fetchEvent(makeRequest('https://fonts.gstatic.com/x.woff2'));
    expect(handled).toBe(false);
  });

  it('does not intercept non-GET requests', async () => {
    const sw = await installed(SHELL);
    const { handled } = await sw.fetchEvent(makeRequest(`${SCOPE}api`, { method: 'POST' }));
    expect(handled).toBe(false);
  });
});

describe('sw.js — install', () => {
  it('precaches the manifest entries, with CORP stamped on responses that lack it', async () => {
    const sw = await installed(SHELL, { 'Content-Type': 'text/javascript' });
    const cache = await sw.caches.open(sw.precacheName);
    const hit = await cache.match(`${SCOPE}assets/index-abc123.js`);
    expect(hit?.headers.get('Cross-Origin-Resource-Policy')).toBe('cross-origin');
    expect(await hit?.text()).toBe(`body of ${BUNDLE}`);
  });

  it('falls back to the static shell list when the manifest has no shell array', async () => {
    const sw = loadServiceWorker();
    sw.network.serve(`${SCOPE}precache-manifest.json`, JSON.stringify({ version: 'v' }));
    for (const entry of ['./', './index.html', './manifest.webmanifest']) {
      sw.network.serve(new URL(entry, SCOPE).href, entry);
    }
    await sw.install();
    const keys = (await (await sw.caches.open(sw.precacheName)).keys()).map((k) => k.url).sort();
    expect(keys).toEqual(
      [
        `${SCOPE}`,
        `${SCOPE}index.html`,
        `${SCOPE}manifest.webmanifest`,
        `${SCOPE}precache-manifest.json`,
      ].sort(),
    );
  });

  it('aborts the whole install when any required entry fails, leaving no worker with a holey shell', async () => {
    const sw = loadServiceWorker();
    for (const entry of SHELL.filter((e) => e !== BUNDLE)) sw.network.serve(new URL(entry, SCOPE).href, entry);
    serveManifest(sw, SHELL); // BUNDLE itself is not served -> 404
    await expect(sw.install()).rejects.toThrow(/could not precache.*index-abc123\.js/);
  });
});

describe('sw.js — activate', () => {
  it('claims clients and deletes stale hyphon caches only', async () => {
    const sw = await installed(SHELL);
    await sw.caches.open('hyphon-precache-old');
    await sw.caches.open('hyphon-runtime-old');
    await sw.caches.open(sw.runtimeName);
    await sw.caches.open('someone-elses-cache');

    await sw.activate();

    expect(await sw.caches.keys()).toEqual(
      expect.arrayContaining([sw.precacheName, sw.runtimeName, 'someone-elses-cache']),
    );
    expect(await sw.caches.keys()).not.toContain('hyphon-precache-old');
    expect(await sw.caches.keys()).not.toContain('hyphon-runtime-old');
    expect(sw.claimed()).toBe(true);
  });

  it('never deletes the cache of its own build id, however many times it restarts', async () => {
    // A terminated and restarted worker re-evaluates the same stamped script:
    // same BUILD_ID -> same cache names -> its own cache survives activate.
    const first = await installed(SHELL);
    const restarted = loadServiceWorker({ buildId: first.buildId });
    for (const [name, cache] of first.caches.stores) (await restarted.caches.open(name)).entries.push(...cache.entries);
    await restarted.activate();
    expect(await restarted.caches.keys()).toContain(restarted.precacheName);
    restarted.network.offline = true;
    const { response } = await restarted.fetchEvent(
      makeRequest(`${SCOPE}assets/index-abc123.js`, { headers: { origin: 'https://hyphon.test' } }),
    );
    expect(await response?.text()).toBe(`body of ${BUNDLE}`);
  });
});
