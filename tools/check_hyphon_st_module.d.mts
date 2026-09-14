export interface WasmImportEntry {
  module: string;
  name: string;
  kind: 'function' | 'table' | 'memory' | 'global' | 'tag';
  shared?: boolean;
  initial?: number;
  maximum?: number;
}
export function parseWasmImports(buf: ArrayBuffer | Uint8Array): WasmImportEntry[];
export function checkSingleThreadedModule(buf: ArrayBuffer | Uint8Array): string[];
