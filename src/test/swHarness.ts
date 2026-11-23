/**
 * Test harness for public/sw.js (a classic script: no imports, no exports).
 *
 * The real file is evaluated in a `vm` sandbox against a fake Cache Storage that
 * implements the parts of the Cache API the worker relies on — in particular
 * `Vary` matching and `ignoreVary`, which is what #1659 turned on — plus a
 * scripted network and a way to dispatch install / activate / fetch events.
 *
 * Node's global Response / Headers are used for bodies, so run the importing
 * test under `// @vitest-environment node`.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

export const SW_SOURCE_PATH = path.resolve(import.meta.dirname, '../../public/sw.js');

/** What the worker reads from a Request (a plain object: Request forbids the `Origin` header). */
export interface FakeRequest {
  url: string;
  method: string;
  mode: string;
  headers: Headers;
}

export function makeRequest(
  url: string,
  init: { method?: string; mode?: string; headers?: Record<string, string> } = {},
): FakeRequest {
  return {
    url,
    method: init.method ?? 'GET',
    mode: init.mode ?? 'cors',
    headers: new Headers(init.headers ?? {}),
  };
}

interface CacheEntry {
  url: string;
  requestHeaders: Headers;
  /** Stored like a real Cache: bytes + status + headers, re-materialised on every match. */
  body: ArrayBuffer;
  status: number;
  statusText: string;
  responseHeaders: Headers;
}

type MatchOptions = { ignoreVary?: boolean };

export class FakeCache {
  readonly entries: CacheEntry[] = [];

  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private normalise(input: string | FakeRequest): { url: string; headers: Headers } {
    if (typeof input === 'string') {
      // A string key is resolved against the worker script's URL (per the Cache
      // API, against the global's base URL) and carries no request headers.
      const u = new URL(input, this.baseUrl);
      u.hash = '';
      return { url: u.href, headers: new Headers() };
    }
    const u = new URL(input.url, this.baseUrl);
    u.hash = '';
    return { url: u.href, headers: input.headers };
  }

  private varyMatches(entry: CacheEntry, requestHeaders: Headers): boolean {
    const vary = entry.responseHeaders.get('vary');
    if (!vary) return true;
    for (const raw of vary.split(',')) {
      const name = raw.trim().toLowerCase();
      if (name === '*') return false;
      if (name && entry.requestHeaders.get(name) !== requestHeaders.get(name)) return false;
    }
    return true;
  }

  async put(input: string | FakeRequest, response: Response): Promise<void> {
    const { url, headers } = this.normalise(input);
    const stored: CacheEntry = {
      url,
      requestHeaders: headers,
      body: await response.arrayBuffer(),
      status: response.status,
      statusText: response.statusText,
      responseHeaders: new Headers(response.headers),
    };
    const at = this.entries.findIndex((e) => e.url === url && this.varyMatches(e, headers));
    if (at >= 0) this.entries[at] = stored;
    else this.entries.push(stored);
  }

  match(input: string | FakeRequest, options: MatchOptions = {}): Promise<Response | undefined> {
    const { url, headers } = this.normalise(input);
    const hit = this.entries.find(
      (e) => e.url === url && (options.ignoreVary === true || this.varyMatches(e, headers)),
    );
    return Promise.resolve(
      hit
        ? new Response(hit.body.slice(0), {
            status: hit.status,
            statusText: hit.statusText,
            headers: hit.responseHeaders,
          })
        : undefined,
    );
  }

  keys(): Promise<{ url: string }[]> {
    return Promise.resolve(this.entries.map((e) => ({ url: e.url })));
  }
}

export class FakeCacheStorage {
  readonly stores = new Map<string, FakeCache>();
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  open(name: string): Promise<FakeCache> {
    let cache = this.stores.get(name);
    if (!cache) {
      cache = new FakeCache(this.baseUrl);
      this.stores.set(name, cache);
    }
    return Promise.resolve(cache);
  }

  keys(): Promise<string[]> {
    return Promise.resolve([...this.stores.keys()]);
  }

  delete(name: string): Promise<boolean> {
    return Promise.resolve(this.stores.delete(name));
  }
}

/** Scripted network: a URL -> response map; anything else (or `offline`) rejects like a dead network. */
export class FakeNetwork {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  offline = false;
  /** Never settles — a captive portal / silently dropped connection. */
  hang = false;
  readonly responses = new Map<string, () => Response>();
  readonly requested: string[] = [];

  serve(url: string, body: string, headers: Record<string, string> = {}, status = 200): void {
    this.responses.set(url, () => new Response(body, { status, headers }));
  }

  fetch = (input: string | FakeRequest): Promise<Response> => {
    // A relative string (`./precache-manifest.json`) resolves against the worker script URL.
    const url = new URL(typeof input === 'string' ? input : input.url, this.baseUrl).href;
    this.requested.push(url);
    if (this.hang) return new Promise<Response>(() => undefined);
    if (this.offline) return Promise.reject(new TypeError('Failed to fetch'));
    const make = this.responses.get(url);
    return make ? Promise.resolve(make()) : Promise.resolve(new Response('not found', { status: 404 }));
  };
}

export interface FakeFetchEvent {
  request: FakeRequest;
  respondWith: (p: Promise<Response> | Response) => void;
  waitUntil: (p: Promise<unknown>) => void;
}

export interface SwHarness {
  scope: string;
  origin: string;
  caches: FakeCacheStorage;
  network: FakeNetwork;
  buildId: string;
  precacheName: string;
  runtimeName: string;
  claimed: () => boolean;
  /** Runs the `install` handler and waits for its waitUntil() promise. */
  install: () => Promise<void>;
  activate: () => Promise<void>;
  /**
   * Dispatches a fetch event. `handled` is false when the worker did not call
   * respondWith() (the request goes to the network untouched).
   */
  fetchEvent: (
    request: FakeRequest,
  ) => Promise<{ handled: boolean; response?: Response; settle: () => Promise<void> }>;
}

export function loadServiceWorker(
  options: { scope?: string; buildId?: string; source?: string } = {},
): SwHarness {
  const scope = options.scope ?? 'https://hyphon.test/';
  const buildId = options.buildId ?? 'test-build';
  const origin = new URL(scope).origin;
  const source = (options.source ?? fs.readFileSync(SW_SOURCE_PATH, 'utf8')).replace(
    '__HYPHON_BUILD_ID__',
    buildId,
  );

  const cacheStorage = new FakeCacheStorage(new URL('sw.js', scope).href);
  const network = new FakeNetwork(new URL('sw.js', scope).href);
  const listeners = new Map<string, ((event: unknown) => void)[]>();
  let claimedFlag = false;

  const self = {
    registration: { scope },
    location: { origin, href: new URL('sw.js', scope).href },
    clients: {
      claim: () => {
        claimedFlag = true;
        return Promise.resolve();
      },
    },
    skipWaiting: () => Promise.resolve(),
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    },
  };

  const sandbox = {
    self,
    caches: cacheStorage,
    fetch: network.fetch,
    Response,
    Headers,
    URL,
    setTimeout,
    clearTimeout,
    console: { warn: () => undefined, error: () => undefined, log: () => undefined },
  };
  vm.runInNewContext(source, sandbox, { filename: 'public/sw.js' });

  const dispatchExtendable = async (type: 'install' | 'activate'): Promise<void> => {
    const pending: Promise<unknown>[] = [];
    for (const fn of listeners.get(type) ?? []) {
      fn({ waitUntil: (p: Promise<unknown>) => pending.push(p) });
    }
    await Promise.all(pending);
  };

  return {
    scope,
    origin,
    caches: cacheStorage,
    network,
    buildId,
    precacheName: `hyphon-precache-${buildId}`,
    runtimeName: `hyphon-runtime-${buildId}`,
    claimed: () => claimedFlag,
    install: () => dispatchExtendable('install'),
    activate: () => dispatchExtendable('activate'),
    fetchEvent: async (request) => {
      let responded: Promise<Response> | Response | undefined;
      const background: Promise<unknown>[] = [];
      const event: FakeFetchEvent = {
        request,
        respondWith: (p) => {
          responded = p;
        },
        waitUntil: (p) => background.push(p),
      };
      for (const fn of listeners.get('fetch') ?? []) fn(event);
      const settle = async () => {
        await Promise.all(background);
      };
      if (responded === undefined) return { handled: false, settle };
      return { handled: true, response: await responded, settle };
    },
  };
}
