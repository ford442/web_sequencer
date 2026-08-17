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

export function isAllowlistedPackageId(packageId: string): boolean {
  return packageId === TONE_PARTIAL.id || packageId === GAIN_FX_PARTIAL.id;
}

export const HYPHON_TONE_PACKAGE_ID = TONE_PARTIAL.id;
export const HYPHON_GAIN_PACKAGE_ID = GAIN_FX_PARTIAL.id;
