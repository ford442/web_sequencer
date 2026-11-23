export const RUST_OSC_REQUIRED_EXPORTS: readonly string[];
export const RUST_OSC_ABI_VERSION: number;
export const RUST_OSC_BUDGET: { initialMemoryPages: number; stackSizeBytes: number };
export function checkRustOscModule(buf: ArrayBuffer | Uint8Array): string[];
