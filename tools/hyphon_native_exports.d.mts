export const MANIFEST_MODULES: readonly ['hyphonNative', 'rubberband', 'mixBus'];
export type ManifestModule = (typeof MANIFEST_MODULES)[number];
export interface ModuleSurface {
  required: string[];
  optional: string[];
  runtime: string[];
  debug: string[];
}
export function moduleSurface(manifest: unknown, module?: ManifestModule): ModuleSurface;
export function exportedFunctions(manifest: unknown, profile?: 'release' | 'debug', module?: ManifestModule): string[];
