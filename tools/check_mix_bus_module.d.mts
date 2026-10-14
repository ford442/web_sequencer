export interface WasmMemoryEntry {
  shared: boolean;
  initial: number;
  maximum: number | null;
}
export const MIX_BUS_REQUIRED_EXPORTS: readonly string[];
export const MIX_BUS_ABI_VERSION: number;
export function parseWasmMemories(buf: ArrayBuffer | Uint8Array): WasmMemoryEntry[];
export function checkMixBusModule(buf: ArrayBuffer | Uint8Array): string[];
