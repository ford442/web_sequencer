export const CPP_OSC_REQUIRED_EXPORTS: readonly string[];
export const CPP_OSC_ABI_VERSION: number;
export const CPP_OSC_BUDGET: { initialMemoryPages: number; stackSizeBytes: number };
export function usesV128(buf: ArrayBuffer | Uint8Array): boolean;
export function checkCppOscModule(buf: ArrayBuffer | Uint8Array): string[];
