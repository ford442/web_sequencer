import { describe, it, expect } from 'vitest';
import {
  normalizeWasmExports,
  formatMissingWasmExports,
  hasProphecyApi,
} from '../audio-worklets/hyphonNativeImports';

describe('normalizeWasmExports', () => {
  it('maps minified export keys via the build-time export map', () => {
    const qa = () => 42;
    const exports = { qa } as unknown as WebAssembly.Exports;
    const normalized = normalizeWasmExports(exports, { open303_create: 'qa' });
    expect(normalized.open303_create).toBe(qa);
    expect(normalized._open303_create).toBe(qa);
  });
});

describe('formatMissingWasmExports', () => {
  it('includes sorted raw export names so minified binaries are diagnosable', () => {
    const raw = { da: () => 1, V: () => 2, memory: {} } as unknown as WebAssembly.Exports;
    const message = formatMissingWasmExports(raw, ['open303_create', 'open303_init']);
    expect(message).toContain('missing open303_create, open303_init');
    expect(message).toContain('WASM exports (3):');
    expect(message).toContain('V, da, memory');
  });

  it('truncates long export lists with a remainder count', () => {
    const raw = Object.fromEntries(
      Array.from({ length: 50 }, (_, i) => [`e${String(i).padStart(2, '0')}`, () => i]),
    ) as unknown as WebAssembly.Exports;
    const message = formatMissingWasmExports(raw, ['prophecy_create']);
    expect(message).toContain('WASM exports (50):');
    expect(message).toContain('… (+2 more)');
  });
});

describe('hasProphecyApi', () => {
  it('accepts normalized exports, not raw minified names', () => {
    const create = () => 1;
    const init = () => 1;
    const raw = { V: create, X: init } as unknown as WebAssembly.Exports;
    expect(hasProphecyApi(raw as Record<string, unknown>)).toBe(false);
    const normalized = normalizeWasmExports(raw, {
      prophecy_create: 'V',
      prophecy_init: 'X',
    });
    expect(hasProphecyApi(normalized)).toBe(true);
  });
});
