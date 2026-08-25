/**
 * The on-disk allowlist: `public/wam/catalog.json`.
 *
 * The security property this file exists to hold is **there is no arbitrary URL
 * field**. A catalog entry names a package by id and, for community packages, a
 * *relative path underneath `wam/community/`* — never an absolute URL, never a
 * scheme, never a path that can climb out. Everything is fetched same-origin and
 * verified against a SHA-256 of its real bytes before it is imported.
 *
 * See docs/adr/0001-wam2-host.md (Phase B addendum).
 */
import { resolvePublicAsset } from '../../utils/engineTelemetry';
import type {
  Wam2Capability,
  Wam2CatalogEntry,
  Wam2Catalog,
  Wam2PackageKind,
  Wam2ParamDesc,
} from './types';

export const WAM2_CATALOG_SCHEMA = 2 as const;
export const WAM2_CATALOG_PATH = 'wam/catalog.json';

/**
 * The only shape a community `entry` may take.
 *
 * Anchored at both ends, one directory segment for the package and one file
 * name, both restricted to a conservative character set. This rejects
 * `https://evil/x.js`, `//evil/x.js`, `/etc/passwd`, `../../secrets.js`,
 * backslash tricks, and query/fragment smuggling — all by construction rather
 * than by blocklist.
 */
const COMMUNITY_ENTRY_RE = /^wam\/community\/[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*\.js$/;

const KNOWN_CAPABILITIES: readonly Wam2Capability[] = [
  'audio',
  'midi',
  'automation',
  'offline-native',
  'custom-ui',
];

export class Wam2CatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Wam2CatalogError';
  }
}

/**
 * Validate a community entry path.
 *
 * Exported because this is the check the whole installer rests on, and it is
 * tested directly against a corpus of hostile inputs.
 */
export function isSafeCommunityEntry(entry: unknown): entry is string {
  if (typeof entry !== 'string' || entry.length === 0 || entry.length > 200) return false;
  // Reject anything that could be read as an absolute or scheme-relative URL, or
  // that contains traversal / encoding tricks, before the shape check.
  if (entry.includes('..')) return false;
  if (entry.includes('\\')) return false;
  if (entry.includes('%')) return false;
  if (entry.includes(':')) return false;
  if (entry.includes('?') || entry.includes('#')) return false;
  if (entry.startsWith('/')) return false;
  return COMMUNITY_ENTRY_RE.test(entry);
}

function asString(value: unknown, field: string, id: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Wam2CatalogError(`catalog entry "${id}": ${field} must be a non-empty string`);
  }
  return value;
}

function parseParams(value: unknown, id: string): Wam2ParamDesc[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Wam2CatalogError(`catalog entry "${id}": params must be an array`);
  }
  return value.map((raw, i) => {
    const p = raw as Record<string, unknown>;
    const paramId = asString(p.id, `params[${i}].id`, id);
    const min = typeof p.min === 'number' ? p.min : 0;
    const max = typeof p.max === 'number' ? p.max : 1;
    if (!(max > min)) {
      throw new Wam2CatalogError(`catalog entry "${id}": params[${i}] max must exceed min`);
    }
    const defaultValue = typeof p.defaultValue === 'number' ? p.defaultValue : min;
    return {
      id: paramId,
      label: typeof p.label === 'string' ? p.label : paramId,
      min,
      max,
      defaultValue: Math.min(max, Math.max(min, defaultValue)),
    };
  });
}

function parseCapabilities(value: unknown, id: string): Wam2Capability[] {
  if (value === undefined) return ['audio'];
  if (!Array.isArray(value)) {
    throw new Wam2CatalogError(`catalog entry "${id}": capabilities must be an array`);
  }
  const out: Wam2Capability[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string') continue;
    const cap = raw as Wam2Capability;
    if (!KNOWN_CAPABILITIES.includes(cap)) {
      throw new Wam2CatalogError(`catalog entry "${id}": unknown capability "${raw}"`);
    }
    if (!out.includes(cap)) out.push(cap);
  }
  return out.length ? out : ['audio'];
}

function parseEntry(raw: unknown): Wam2CatalogEntry {
  if (!raw || typeof raw !== 'object') {
    throw new Wam2CatalogError('catalog entry must be an object');
  }
  const e = raw as Record<string, unknown>;
  const id = asString(e.id, 'id', String(e.id ?? '<unknown>'));
  const origin = e.origin;
  if (origin !== 'bundled' && origin !== 'community') {
    throw new Wam2CatalogError(`catalog entry "${id}": origin must be "bundled" or "community"`);
  }
  const kind = e.kind;
  if (kind !== 'instrument' && kind !== 'effect') {
    throw new Wam2CatalogError(`catalog entry "${id}": kind must be "instrument" or "effect"`);
  }

  const base = {
    id,
    version: asString(e.version, 'version', id),
    kind: kind as Wam2PackageKind,
    title: typeof e.title === 'string' ? e.title : id,
    vendor: typeof e.vendor === 'string' ? e.vendor : 'unknown',
    license: asString(e.license, 'license', id),
    capabilities: parseCapabilities(e.capabilities, id),
    params: parseParams(e.params, id),
  };

  if (origin === 'bundled') {
    // Bundled fixtures are compiled in; they carry no entry path and their
    // integrity is a descriptor fingerprint computed at runtime, not a file hash.
    if (e.entry !== undefined) {
      throw new Wam2CatalogError(`catalog entry "${id}": bundled packages must not declare an entry path`);
    }
    return { ...base, origin: 'bundled' };
  }

  // Any field that could carry a URL is rejected outright rather than ignored:
  // silently dropping it would let a catalog *look* like it grants remote loading.
  for (const forbidden of ['url', 'src', 'href', 'remote', 'cdn']) {
    if (e[forbidden] !== undefined) {
      throw new Wam2CatalogError(
        `catalog entry "${id}": field "${forbidden}" is not supported — community packages are ` +
          'addressed by a relative path under wam/community/ only',
      );
    }
  }
  if (!isSafeCommunityEntry(e.entry)) {
    throw new Wam2CatalogError(
      `catalog entry "${id}": entry must be a relative path matching ` +
        `${COMMUNITY_ENTRY_RE.source} (got ${JSON.stringify(e.entry)})`,
    );
  }
  const integrity = e.integrity as { alg?: unknown; value?: unknown } | undefined;
  if (!integrity || (integrity.alg !== 'sha256' && integrity.alg !== 'fnv1a32')) {
    throw new Wam2CatalogError(`catalog entry "${id}": integrity.alg must be "sha256" or "fnv1a32"`);
  }
  if (typeof integrity.value !== 'string' || !/^[0-9a-f]+$/.test(integrity.value)) {
    throw new Wam2CatalogError(`catalog entry "${id}": integrity.value must be lowercase hex`);
  }

  return {
    ...base,
    origin: 'community',
    entry: e.entry,
    integrity: { alg: integrity.alg, value: integrity.value },
  };
}

export function parseWam2Catalog(raw: unknown): Wam2Catalog {
  if (!raw || typeof raw !== 'object') {
    throw new Wam2CatalogError('catalog must be a JSON object');
  }
  const doc = raw as Record<string, unknown>;
  const schema = doc.schema;
  if (schema !== WAM2_CATALOG_SCHEMA) {
    throw new Wam2CatalogError(
      `catalog schema ${String(schema)} is not supported (expected ${WAM2_CATALOG_SCHEMA})`,
    );
  }
  if (!Array.isArray(doc.packages)) {
    throw new Wam2CatalogError('catalog.packages must be an array');
  }
  const packages = doc.packages.map(parseEntry);
  const seen = new Set<string>();
  for (const pkg of packages) {
    if (seen.has(pkg.id)) {
      throw new Wam2CatalogError(`duplicate catalog entry id "${pkg.id}"`);
    }
    seen.add(pkg.id);
  }
  return { schema: WAM2_CATALOG_SCHEMA, packages };
}

let catalogPromise: Promise<Wam2Catalog> | null = null;

/** Fetch and validate the allowlist. Memoized; the catalog never changes at runtime. */
export function loadWam2Catalog(fetchImpl: typeof fetch = fetch): Promise<Wam2Catalog> {
  if (!catalogPromise) {
    catalogPromise = (async () => {
      const url = resolvePublicAsset(WAM2_CATALOG_PATH);
      const res = await fetchImpl(url);
      if (!res.ok) {
        throw new Wam2CatalogError(`catalog fetch failed: ${res.status} ${res.statusText}`);
      }
      return parseWam2Catalog(await res.json());
    })().catch((err) => {
      catalogPromise = null;
      throw err;
    });
  }
  return catalogPromise;
}

/** Test seam. */
export function resetWam2CatalogCache(): void {
  catalogPromise = null;
}
