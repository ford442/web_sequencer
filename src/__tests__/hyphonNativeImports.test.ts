import { describe, it, expect } from 'vitest';
import { normalizeWasmExports } from '../audio-worklets/hyphonNativeImports';

describe('normalizeWasmExports', () => {
  it('maps minified export keys via the build-time export map', () => {
    const qa = () => 42;
    const exports = { qa } as unknown as WebAssembly.Exports;
    const normalized = normalizeWasmExports(exports, { open303_create: 'qa' });
    expect(normalized.open303_create).toBe(qa);
    expect(normalized._open303_create).toBe(qa);
  });
});
