export const DWGS_OSC_REQUIRED_EXPORTS: readonly string[];
export const DWGS_OSC_ABI_VERSION: number;
export const DWGS_OSC_WAVE_COUNT: number;
export const DWGS_OSC_BUDGET: { initialMemoryPages: number; stackSizeBytes: number };
export function checkDwgsOscModule(buf: ArrayBuffer | Uint8Array): string[];
