export const CPP_OSC_REQUIRED_EXPORTS: readonly string[];
export const CPP_OSC_ABI_VERSION: number;
export const CPP_OSC_BUDGET: { initialMemoryPages: number; stackSizeBytes: number };
export function usesV128(buf: ArrayBuffer | Uint8Array): boolean;
export const CPP_OSC_VARIANT_FILES: Readonly<{ simd: 'cpp_osc.wasm'; scalar: 'cpp_osc_scalar.wasm' }>;
export type CppOscVariant = keyof typeof CPP_OSC_VARIANT_FILES;
export function checkCppOscModule(buf: ArrayBuffer | Uint8Array, options?: { variant?: CppOscVariant }): string[];
