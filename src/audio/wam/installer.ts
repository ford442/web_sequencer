/**
 * Allowlisted community package installer.
 *
 * Load path, in order, with no step skippable:
 *
 *   catalog entry (allowlist)          — the id must be in public/wam/catalog.json
 *     → user has enabled it            — installing is never implicit
 *     → same-origin URL from a relative entry path   — see catalogSource.ts
 *     → fetch the real bytes
 *     → SHA-256 those bytes, compare with the catalog  — mismatch aborts here
 *     → dynamic import of that same URL
 *     → module exports the expected factory
 *
 * The hash is taken over the bytes the browser will execute, not over a
 * descriptor. That is the difference between this and the bundled fixtures,
 * whose "integrity" is a fingerprint of a compiled-in descriptor and therefore
 * proves nothing about file contents.
 *
 * No `eval`, no `new Function`, no remote origin: the import is a plain
 * same-origin dynamic import, which is legal under the ADR 0001 CSP.
 */
import { resolvePublicAsset } from '../../utils/engineTelemetry';
import { loadWam2Catalog, Wam2CatalogError } from './catalogSource';
import { hashBytes, integrityMatches } from './integrity';
import type {
  Wam2CatalogEntry,
  Wam2PackageDescriptor,
  Wam2Plugin,
} from './types';
import { WAM2_DEFAULT_PERMISSIONS } from './types';

/** Contract a community package module must satisfy. */
export interface Wam2CommunityModule {
  /** Host ABI version the package was written against. */
  wam2ApiVersion: 1;
  createWam2Plugin(descriptor: Wam2PackageDescriptor): Wam2Plugin;
}

export type Wam2InstallFailure =
  | 'not-in-catalog'
  | 'not-enabled'
  | 'fetch-failed'
  | 'integrity-mismatch'
  | 'import-failed'
  | 'bad-module';

export class Wam2InstallError extends Error {
  readonly reason: Wam2InstallFailure;
  readonly packageId: string;

  constructor(reason: Wam2InstallFailure, packageId: string, message: string) {
    super(message);
    this.name = 'Wam2InstallError';
    this.reason = reason;
    this.packageId = packageId;
  }
}

export function descriptorFromCatalogEntry(entry: Wam2CatalogEntry): Wam2PackageDescriptor {
  return {
    id: entry.id,
    version: entry.version,
    kind: entry.kind,
    title: entry.title,
    vendor: entry.vendor,
    license: entry.license,
    origin: entry.origin,
    params: entry.params,
    integrity:
      entry.origin === 'community'
        ? entry.integrity
        : { alg: 'sha256', value: '' },
    // Per ADR 0001: only first-party fixtures using plain Web Audio nodes can be
    // replayed in an OfflineAudioContext. A community package is unsupported for
    // freeze unless it declares — and we can honour — offline-native.
    offline: entry.capabilities.includes('offline-native') && entry.origin === 'bundled'
      ? 'native'
      : 'unsupported',
    isolation: 'audio-graph-slot',
    permissions: WAM2_DEFAULT_PERMISSIONS,
    capabilities: entry.capabilities,
  };
}

export interface InstalledCommunityPackage {
  descriptor: Wam2PackageDescriptor;
  module: Wam2CommunityModule;
  /** SHA-256 actually computed over the fetched bytes. */
  verified: { alg: string; value: string };
  bytes: number;
}

const installed = new Map<string, Promise<InstalledCommunityPackage>>();

export interface InstallOptions {
  fetchImpl?: typeof fetch;
  /** Injected in tests; production uses a same-origin dynamic import. */
  importImpl?: (url: string) => Promise<unknown>;
  /** Bypasses the enabled-set check — used by the installer UI's own preview. */
  isEnabled?: (packageId: string) => boolean;
}

function defaultImport(url: string): Promise<unknown> {
  // @vite-ignore is correct here and NOT the Phase A mistake: this really is a
  // runtime, same-origin URL for a file in public/, so Vite must not try to
  // resolve or rewrite it at build time.
  return import(/* @vite-ignore */ url);
}

function assertModule(mod: unknown, packageId: string): Wam2CommunityModule {
  const m = mod as Partial<Wam2CommunityModule> | null;
  if (!m || typeof m !== 'object') {
    throw new Wam2InstallError('bad-module', packageId, `${packageId}: module did not export an object`);
  }
  if (m.wam2ApiVersion !== 1) {
    throw new Wam2InstallError(
      'bad-module',
      packageId,
      `${packageId}: wam2ApiVersion ${String(m.wam2ApiVersion)} is not supported (expected 1)`,
    );
  }
  if (typeof m.createWam2Plugin !== 'function') {
    throw new Wam2InstallError(
      'bad-module',
      packageId,
      `${packageId}: module does not export createWam2Plugin()`,
    );
  }
  return m as Wam2CommunityModule;
}

/**
 * Fetch, verify and import one allowlisted community package.
 * Memoized per id — a package is fetched and hashed once per session.
 */
export function installCommunityPackage(
  packageId: string,
  options: InstallOptions = {},
): Promise<InstalledCommunityPackage> {
  const existing = installed.get(packageId);
  if (existing) return existing;

  const run = (async (): Promise<InstalledCommunityPackage> => {
    const fetchImpl = options.fetchImpl ?? fetch;
    const importImpl = options.importImpl ?? defaultImport;

    const catalog = await loadWam2Catalog(fetchImpl);
    const entry = catalog.packages.find((p) => p.id === packageId);
    if (!entry) {
      throw new Wam2InstallError('not-in-catalog', packageId, `${packageId} is not in the allowlist`);
    }
    if (entry.origin !== 'community') {
      throw new Wam2InstallError(
        'not-in-catalog',
        packageId,
        `${packageId} is a bundled package; use createBundledPlugin()`,
      );
    }
    const isEnabled = options.isEnabled ?? ((id: string) => isPackageEnabled(id));
    if (!isEnabled(packageId)) {
      throw new Wam2InstallError('not-enabled', packageId, `${packageId} has not been enabled by the user`);
    }

    const url = resolvePublicAsset(entry.entry);
    let bytes: Uint8Array;
    try {
      const res = await fetchImpl(url);
      if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText}`);
      }
      bytes = new Uint8Array(await res.arrayBuffer());
    } catch (err) {
      throw new Wam2InstallError(
        'fetch-failed',
        packageId,
        `${packageId}: could not fetch ${entry.entry} — ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const verified = await hashBytes(bytes);
    if (!integrityMatches(entry.integrity, verified)) {
      // Deliberately does not import anything. A hash mismatch means the bytes on
      // disk are not the bytes the allowlist vouches for; the caller shows a
      // bypass placeholder rather than running them.
      throw new Wam2InstallError(
        'integrity-mismatch',
        packageId,
        `${packageId}: integrity mismatch — catalog says ${entry.integrity.alg}:${entry.integrity.value}, ` +
          `file is ${verified.alg}:${verified.value}`,
      );
    }

    let mod: unknown;
    try {
      mod = await importImpl(url);
    } catch (err) {
      throw new Wam2InstallError(
        'import-failed',
        packageId,
        `${packageId}: import failed — ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return {
      descriptor: descriptorFromCatalogEntry(entry),
      module: assertModule(mod, packageId),
      verified,
      bytes: bytes.byteLength,
    };
  })().catch((err) => {
    // Do not memoize failures: a fetch blip should be retryable, and a mismatch
    // that is fixed by a rebuild should not need a page reload.
    installed.delete(packageId);
    throw err;
  });

  installed.set(packageId, run);
  return run;
}

/** Construct a plugin instance from an already-installed community package. */
export async function createCommunityPlugin(
  packageId: string,
  options: InstallOptions = {},
): Promise<Wam2Plugin> {
  const pkg = await installCommunityPackage(packageId, options);
  return pkg.module.createWam2Plugin(pkg.descriptor);
}

/* ------------------------------------------------------------------ *
 * Enabled set — which allowlisted packages the user has switched on.
 * ------------------------------------------------------------------ */

const ENABLED_STORAGE_KEY = 'hyphon.wam2.enabledPackages';
let enabledCache: Set<string> | null = null;

function readEnabled(): Set<string> {
  if (enabledCache) return enabledCache;
  enabledCache = new Set<string>();
  try {
    const raw = globalThis.localStorage?.getItem(ENABLED_STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const id of parsed) if (typeof id === 'string') enabledCache.add(id);
      }
    }
  } catch {
    /* private mode / disabled storage — an empty set is the safe default */
  }
  return enabledCache;
}

function writeEnabled(set: Set<string>): void {
  enabledCache = set;
  try {
    globalThis.localStorage?.setItem(ENABLED_STORAGE_KEY, JSON.stringify([...set].sort()));
  } catch {
    /* non-persistent is acceptable; the in-memory set still applies this session */
  }
}

export function isPackageEnabled(packageId: string): boolean {
  return readEnabled().has(packageId);
}

export function listEnabledPackages(): string[] {
  return [...readEnabled()].sort();
}

/**
 * Enable an allowlisted community package. Rejects ids that are not in the
 * catalog, so the enabled set can never name something the allowlist does not.
 */
export async function setPackageEnabled(
  packageId: string,
  enabled: boolean,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (enabled) {
    const catalog = await loadWam2Catalog(fetchImpl);
    const entry = catalog.packages.find((p) => p.id === packageId);
    if (!entry) {
      throw new Wam2CatalogError(`cannot enable "${packageId}": not in the allowlist`);
    }
  }
  const set = new Set(readEnabled());
  if (enabled) set.add(packageId);
  else set.delete(packageId);
  writeEnabled(set);
  if (!enabled) installed.delete(packageId);
}

/** Test seam: drop memoized installs and the cached enabled set. */
export function resetInstallerState(): void {
  installed.clear();
  enabledCache = null;
}
