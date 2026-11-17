export const RB_ABI_VERSION: number;
export const FORBIDDEN_GLUE_MARKERS: readonly { runtime: string; pattern: RegExp }[];
export function checkRubberBandModule(
  buf: ArrayBuffer | Uint8Array,
  glue: string,
  initialMemoryMb?: number | null,
  requiredExports?: readonly string[],
): string[];
