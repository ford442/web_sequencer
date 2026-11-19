export interface RubberBandManifestSection {
  required: readonly string[];
  runtime?: readonly string[];
  imports?: Readonly<Record<string, readonly string[]>>;
}
export const RB_ABI_VERSION: number;
export const RUBBERBAND_MANIFEST: RubberBandManifestSection;
export const RUBBERBAND_MANIFEST_EXPORTS: readonly string[];
export const FORBIDDEN_IMPORTS: readonly { runtime: string; pattern: RegExp }[];
export function checkRubberBandModule(
  buf: ArrayBuffer | Uint8Array,
  initialMemoryMb?: number | null,
  section?: RubberBandManifestSection,
): string[];
