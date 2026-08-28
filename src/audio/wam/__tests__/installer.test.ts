/**
 * The allowlisted installer is a security boundary, so these tests are mostly
 * about what it *refuses*.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isSafeCommunityEntry,
  parseWam2Catalog,
  resetWam2CatalogCache,
  Wam2CatalogError,
} from '../catalogSource';
import {
  createCommunityPlugin,
  installCommunityPackage,
  isPackageEnabled,
  listEnabledPackages,
  resetInstallerState,
  setPackageEnabled,
  Wam2InstallError,
} from '../installer';

const REPO_ROOT = process.cwd();
const CATALOG_PATH = join(REPO_ROOT, 'public/wam/catalog.json');
const COMMUNITY_ID = 'hyphon.pulsar';

const catalogText = readFileSync(CATALOG_PATH, 'utf8');
const catalogJson = JSON.parse(catalogText) as Record<string, unknown>;
const packageSource = readFileSync(
  join(REPO_ROOT, 'public/wam/community/hyphon.pulsar/index.js'),
  'utf8',
);

/** Serves the real catalog and the real package file over an injected fetch. */
function makeFetch(overrides: Record<string, string> = {}): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    for (const [suffix, body] of Object.entries(overrides)) {
      if (url.endsWith(suffix)) {
        return new Response(body, { status: 200 });
      }
    }
    if (url.endsWith('wam/catalog.json')) {
      return new Response(catalogText, { status: 200 });
    }
    if (url.endsWith('wam/community/hyphon.pulsar/index.js')) {
      return new Response(packageSource, { status: 200 });
    }
    return new Response('not found', { status: 404, statusText: 'Not Found' });
  }) as unknown as typeof fetch;
}

const importReal = (): Promise<unknown> =>
  import('../../../../public/wam/community/hyphon.pulsar/index.js');

beforeEach(() => {
  resetInstallerState();
  resetWam2CatalogCache();
  globalThis.localStorage?.clear();
});

describe('community entry path validation', () => {
  // The single property the installer rests on: an entry can only ever name a
  // relative file under wam/community/.
  const hostile = [
    'https://evil.example/x.js',
    'http://evil.example/x.js',
    '//evil.example/x.js',
    '/etc/passwd',
    '/wam/community/a/b.js',
    'wam/community/../../secrets.js',
    'wam/community/a/../../../b.js',
    '..\\..\\windows\\system32.js',
    'wam/community/a/b.js?callback=evil',
    'wam/community/a/b.js#frag',
    'wam/community/a/b.js%2e%2e',
    'data:text/javascript,alert(1)',
    'javascript:alert(1)',
    'wam/community/a/b.mjs',
    'wam/community/a.js',
    'wam/plugins/a/b.js',
    '',
  ];

  it.each(hostile)('rejects %s', (entry) => {
    expect(isSafeCommunityEntry(entry)).toBe(false);
  });

  it('accepts the shipped shape', () => {
    expect(isSafeCommunityEntry('wam/community/hyphon.pulsar/index.js')).toBe(true);
  });

  it('rejects non-strings and absurd lengths', () => {
    expect(isSafeCommunityEntry(undefined)).toBe(false);
    expect(isSafeCommunityEntry(42)).toBe(false);
    expect(isSafeCommunityEntry(`wam/community/a/${'x'.repeat(300)}.js`)).toBe(false);
  });
});

describe('catalog parsing', () => {
  it('accepts the shipped catalog', () => {
    const parsed = parseWam2Catalog(catalogJson);
    expect(parsed.packages.map((p) => p.id)).toContain(COMMUNITY_ID);
  });

  it('rejects a URL-bearing field outright instead of ignoring it', () => {
    // Ignoring it would let a catalog *look* like it grants remote loading.
    const doc = structuredClone(catalogJson) as { packages: Record<string, unknown>[] };
    const community = doc.packages.find((p) => p.id === COMMUNITY_ID)!;
    community.url = 'https://evil.example/plugin.js';
    expect(() => parseWam2Catalog(doc)).toThrow(/field "url" is not supported/);
  });

  it.each(['src', 'href', 'remote', 'cdn'])('rejects a "%s" field too', (field) => {
    const doc = structuredClone(catalogJson) as { packages: Record<string, unknown>[] };
    doc.packages.find((p) => p.id === COMMUNITY_ID)![field] = 'https://evil.example/x.js';
    expect(() => parseWam2Catalog(doc)).toThrow(Wam2CatalogError);
  });

  it('rejects a community entry that is a remote URL', () => {
    const doc = structuredClone(catalogJson) as { packages: Record<string, unknown>[] };
    doc.packages.find((p) => p.id === COMMUNITY_ID)!.entry = 'https://evil.example/x.js';
    expect(() => parseWam2Catalog(doc)).toThrow(/entry must be a relative path/);
  });

  it('rejects a bundled entry that tries to carry a path', () => {
    const doc = structuredClone(catalogJson) as { packages: Record<string, unknown>[] };
    doc.packages.find((p) => p.id === 'hyphon.tone')!.entry = 'wam/community/x/y.js';
    expect(() => parseWam2Catalog(doc)).toThrow(/must not declare an entry path/);
  });

  it('rejects an unsupported schema version', () => {
    expect(() => parseWam2Catalog({ ...catalogJson, schema: 1 })).toThrow(/schema 1 is not supported/);
  });

  it('rejects duplicate ids', () => {
    const doc = structuredClone(catalogJson) as { packages: unknown[] };
    doc.packages.push(structuredClone(doc.packages[0]));
    expect(() => parseWam2Catalog(doc)).toThrow(/duplicate catalog entry/);
  });

  it('rejects non-hex integrity', () => {
    const doc = structuredClone(catalogJson) as { packages: Record<string, unknown>[] };
    doc.packages.find((p) => p.id === COMMUNITY_ID)!.integrity = { alg: 'sha256', value: 'NOTHEX' };
    expect(() => parseWam2Catalog(doc)).toThrow(/lowercase hex/);
  });
});

describe('install gating', () => {
  it('refuses a package the user has not enabled', async () => {
    await expect(
      installCommunityPackage(COMMUNITY_ID, { fetchImpl: makeFetch(), importImpl: importReal }),
    ).rejects.toMatchObject({ reason: 'not-enabled' });
  });

  it('refuses an id that is not in the catalog even when enabled', async () => {
    await expect(
      installCommunityPackage('evil.package', {
        fetchImpl: makeFetch(),
        importImpl: importReal,
        isEnabled: () => true,
      }),
    ).rejects.toMatchObject({ reason: 'not-in-catalog' });
  });

  it('refuses to install a bundled package through the community path', async () => {
    await expect(
      installCommunityPackage('hyphon.tone', {
        fetchImpl: makeFetch(),
        importImpl: importReal,
        isEnabled: () => true,
      }),
    ).rejects.toMatchObject({ reason: 'not-in-catalog' });
  });

  it('will not enable an id that is not in the allowlist', async () => {
    await expect(setPackageEnabled('evil.package', true, makeFetch())).rejects.toThrow(
      /not in the allowlist/,
    );
    expect(isPackageEnabled('evil.package')).toBe(false);
  });

  it('persists the enabled set', async () => {
    await setPackageEnabled(COMMUNITY_ID, true, makeFetch());
    expect(listEnabledPackages()).toEqual([COMMUNITY_ID]);
    await setPackageEnabled(COMMUNITY_ID, false, makeFetch());
    expect(listEnabledPackages()).toEqual([]);
  });
});

describe('integrity enforcement', () => {
  it('installs when the bytes match the catalog', async () => {
    const installed = await installCommunityPackage(COMMUNITY_ID, {
      fetchImpl: makeFetch(),
      importImpl: importReal,
      isEnabled: () => true,
    });
    expect(installed.descriptor.id).toBe(COMMUNITY_ID);
    expect(installed.verified.alg).toBe('sha256');
    expect(installed.bytes).toBeGreaterThan(0);
    expect(installed.module.wam2ApiVersion).toBe(1);
  });

  it('refuses — and does NOT import — when the bytes do not match', async () => {
    const importImpl = vi.fn(importReal);
    await expect(
      installCommunityPackage(COMMUNITY_ID, {
        // One byte of difference is enough.
        fetchImpl: makeFetch({ 'index.js': `${packageSource}\n// tampered` }),
        importImpl,
        isEnabled: () => true,
      }),
    ).rejects.toMatchObject({ reason: 'integrity-mismatch' });
    // The whole point: nothing was executed.
    expect(importImpl).not.toHaveBeenCalled();
  });

  it('does not memoize a failure, so a fixed package installs on retry', async () => {
    const options = { importImpl: importReal, isEnabled: () => true };
    await expect(
      installCommunityPackage(COMMUNITY_ID, {
        ...options,
        fetchImpl: makeFetch({ 'index.js': 'export const wam2ApiVersion = 1;' }),
      }),
    ).rejects.toBeInstanceOf(Wam2InstallError);
    const ok = await installCommunityPackage(COMMUNITY_ID, { ...options, fetchImpl: makeFetch() });
    expect(ok.descriptor.id).toBe(COMMUNITY_ID);
  });

  it('reports a fetch failure distinctly from a hash failure', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('wam/catalog.json')) return new Response(catalogText, { status: 200 });
      return new Response('nope', { status: 500, statusText: 'Server Error' });
    }) as unknown as typeof fetch;
    await expect(
      installCommunityPackage(COMMUNITY_ID, { fetchImpl, importImpl: importReal, isEnabled: () => true }),
    ).rejects.toMatchObject({ reason: 'fetch-failed' });
  });
});

describe('module ABI', () => {
  it('rejects a module without the host ABI marker', async () => {
    await expect(
      installCommunityPackage(COMMUNITY_ID, {
        fetchImpl: makeFetch(),
        importImpl: async () => ({ createWam2Plugin: () => ({}) }),
        isEnabled: () => true,
      }),
    ).rejects.toMatchObject({ reason: 'bad-module' });
  });

  it('rejects a module with no factory', async () => {
    await expect(
      installCommunityPackage(COMMUNITY_ID, {
        fetchImpl: makeFetch(),
        importImpl: async () => ({ wam2ApiVersion: 1 }),
        isEnabled: () => true,
      }),
    ).rejects.toMatchObject({ reason: 'bad-module' });
  });

  it('builds a plugin whose descriptor comes from the catalog', async () => {
    const plugin = await createCommunityPlugin(COMMUNITY_ID, {
      fetchImpl: makeFetch(),
      importImpl: importReal,
      isEnabled: () => true,
    });
    expect(plugin.descriptor.params.map((p) => p.id)).toEqual(['cutoff', 'detune', 'gain']);
    // ADR 0001: community code cannot be replayed in an OfflineAudioContext.
    expect(plugin.descriptor.offline).toBe('unsupported');
    expect(plugin.descriptor.origin).toBe('community');
  });
});
