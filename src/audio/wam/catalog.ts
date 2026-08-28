import { loadWam2Catalog } from './catalogSource';
import { descriptorFromCatalogEntry } from './installer';
import { hashCanonicalJson } from './integrity';
import type { Wam2PackageDescriptor, Wam2ParamDesc } from './types';
import { WAM2_DEFAULT_PERMISSIONS } from './types';

const GAIN_PARAM: Wam2ParamDesc = {
  id: 'gain',
  label: 'Gain',
  min: 0,
  max: 1,
  defaultValue: 0.8,
};

function fingerprint(partial: {
  id: string;
  version: string;
  kind: Wam2PackageDescriptor['kind'];
  title: string;
  vendor: string;
  license: string;
  params: Wam2ParamDesc[];
}): unknown {
  return {
    id: partial.id,
    kind: partial.kind,
    license: partial.license,
    params: partial.params.map((p) => p.id),
    title: partial.title,
    vendor: partial.vendor,
    version: partial.version,
  };
}

const TONE_PARTIAL = {
  id: 'hyphon.tone',
  version: '1.0.0',
  kind: 'instrument' as const,
  title: 'Hyphon Tone',
  vendor: 'Hyphon',
  license: 'MIT',
  params: [GAIN_PARAM],
};

const GAIN_FX_PARTIAL = {
  id: 'hyphon.gain',
  version: '1.0.0',
  kind: 'effect' as const,
  title: 'Hyphon Gain',
  vendor: 'Hyphon',
  license: 'MIT',
  params: [GAIN_PARAM],
};

/**
 * Bundled allowlist. v1 loads only these ids — no remote JavaScript URL field.
 * Integrity values are filled by {@link finalizeBundledCatalog}.
 */
export const BUNDLED_WAM2_FINGERPRINTS = {
  tone: fingerprint(TONE_PARTIAL),
  gain: fingerprint(GAIN_FX_PARTIAL),
} as const;

let catalogCache: readonly Wam2PackageDescriptor[] | null = null;

export async function finalizeBundledCatalog(): Promise<readonly Wam2PackageDescriptor[]> {
  if (catalogCache) return catalogCache;
  const toneHash = await hashCanonicalJson(BUNDLED_WAM2_FINGERPRINTS.tone);
  const gainHash = await hashCanonicalJson(BUNDLED_WAM2_FINGERPRINTS.gain);
  catalogCache = [
    {
      ...TONE_PARTIAL,
      origin: 'bundled',
      integrity: toneHash,
      offline: 'native',
      isolation: 'audio-graph-slot',
      permissions: WAM2_DEFAULT_PERMISSIONS,
    },
    {
      ...GAIN_FX_PARTIAL,
      origin: 'bundled',
      integrity: gainHash,
      offline: 'native',
      isolation: 'audio-graph-slot',
      permissions: WAM2_DEFAULT_PERMISSIONS,
    },
  ];
  return catalogCache;
}

export async function getBundledPackage(packageId: string): Promise<Wam2PackageDescriptor | undefined> {
  const catalog = await finalizeBundledCatalog();
  return catalog.find((pkg) => pkg.id === packageId);
}

export function isBundledPackageId(packageId: string): boolean {
  return packageId === TONE_PARTIAL.id || packageId === GAIN_FX_PARTIAL.id;
}

/** @deprecated Bundled-only check; prefer {@link isAllowlistedPackageId}. */
export const isBundledPackage = isBundledPackageId;

/**
 * Is this id on the allowlist at all — bundled fixture *or* community package?
 *
 * Community membership needs the catalog, which is fetched. When the catalog
 * cannot be read (offline, a test with no fetch, a broken deploy) this reports
 * bundled-only rather than throwing: an unreachable allowlist must fail closed
 * to "not allowed", never open.
 */
export async function isAllowlistedPackageId(
  packageId: string,
  fetchImpl?: typeof fetch,
): Promise<boolean> {
  if (isBundledPackageId(packageId)) return true;
  return (await resolveAllowlistedPackage(packageId, fetchImpl)) !== undefined;
}

/**
 * Descriptor for any allowlisted package, from whichever source owns it.
 *
 * Bundled descriptors carry a fingerprint hash of their compiled-in metadata;
 * community descriptors carry the SHA-256 of the package file's bytes, which is
 * what {@link installCommunityPackage} verifies before importing.
 */
export async function resolveAllowlistedPackage(
  packageId: string,
  fetchImpl?: typeof fetch,
): Promise<Wam2PackageDescriptor | undefined> {
  const bundled = await getBundledPackage(packageId);
  if (bundled) return bundled;
  try {
    const catalog = await loadWam2Catalog(fetchImpl ?? fetch);
    const entry = catalog.packages.find((p) => p.id === packageId && p.origin === 'community');
    return entry ? descriptorFromCatalogEntry(entry) : undefined;
  } catch {
    return undefined;
  }
}

export const HYPHON_TONE_PACKAGE_ID = TONE_PARTIAL.id;
export const HYPHON_GAIN_PACKAGE_ID = GAIN_FX_PARTIAL.id;
