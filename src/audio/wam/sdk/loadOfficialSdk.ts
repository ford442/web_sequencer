import {
  OFFICIAL_WAM_SDK_LICENSE,
  OFFICIAL_WAM_SDK_PACKAGE,
  OFFICIAL_WAM_SDK_VERSION,
} from '../types';

export interface OfficialWamSdkLoad {
  packageName: typeof OFFICIAL_WAM_SDK_PACKAGE;
  version: typeof OFFICIAL_WAM_SDK_VERSION;
  license: typeof OFFICIAL_WAM_SDK_LICENSE;
  /** Present only when the optional npm package is installed and imported. */
  module: unknown | null;
  unavailableReason?: string;
}

/**
 * Lazy-load `@webaudiomodules/sdk@0.0.12`. Must never be imported from
 * `main.tsx` or other eager entry modules — Phase A fixtures do not need it.
 */
export async function loadOfficialWamSdk(): Promise<OfficialWamSdkLoad> {
  try {
    const specifier: string = OFFICIAL_WAM_SDK_PACKAGE;
    const mod: unknown = await import(/* @vite-ignore */ specifier);
    return {
      packageName: OFFICIAL_WAM_SDK_PACKAGE,
      version: OFFICIAL_WAM_SDK_VERSION,
      license: OFFICIAL_WAM_SDK_LICENSE,
      module: mod,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      packageName: OFFICIAL_WAM_SDK_PACKAGE,
      version: OFFICIAL_WAM_SDK_VERSION,
      license: OFFICIAL_WAM_SDK_LICENSE,
      module: null,
      unavailableReason: message,
    };
  }
}
