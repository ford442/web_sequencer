import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  EngineTelemetry,
  logEngineFallback,
  parseHyphonGlueExportMap,
  emitUserEngineFallbackWarning,
  getActiveEngineFallbacks,
  clearEngineFallbackWarning,
  resolvePublicAsset,
  engineTelemetry,
} from '../utils/engineTelemetry';

describe('resolvePublicAsset', () => {
  it('returns absolute URLs rooted at BASE_URL', () => {
    const wasmUrl = resolvePublicAsset('hyphon_native.wasm');
    const rustUrl = resolvePublicAsset('/rust-wasm/rust_audio.js');

    expect(wasmUrl).toMatch(/^https?:\/\//);
    expect(wasmUrl).toMatch(/hyphon_native\.wasm$/);
    expect(rustUrl).toMatch(/^https?:\/\//);
    expect(new URL(rustUrl).pathname).toMatch(/rust-wasm\/rust_audio\.js$/);
  });

  it('returns an absolute URL when window.location is available', () => {
    const original = window.location.href;
    const originalBase = import.meta.env.BASE_URL;
    import.meta.env.BASE_URL = './';
    Object.defineProperty(window, 'location', {
      value: { href: 'https://test.1ink.us/hyphon/index.html' },
      configurable: true,
    });
    const url = resolvePublicAsset('rust-wasm/rust_audio.js');
    expect(url).toBe('https://test.1ink.us/hyphon/rust-wasm/rust_audio.js');
    import.meta.env.BASE_URL = originalBase;
    Object.defineProperty(window, 'location', {
      value: { href: original },
      configurable: true,
    });
  });
});

describe('parseHyphonGlueExportMap', () => {
  it('extracts bare export names from Emscripten glue', () => {
    const glue =
      'Module["_open303_create"]=wasmExports["da"];' +
      '_open303_init=Module["_open303_init"]=wasmExports["fa"];';
    const map = parseHyphonGlueExportMap(glue);
    expect(map.open303_create).toBe('da');
    expect(map.open303_init).toBe('fa');
  });
});

describe('emitUserEngineFallbackWarning', () => {
  beforeEach(() => {
    clearEngineFallbackWarning('webgpu');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records active fallback and warns once per throttle window', () => {
    emitUserEngineFallbackWarning('webgpu', 'webgpu', 'navigator.gpu unavailable');
    emitUserEngineFallbackWarning('webgpu', 'webgpu', 'navigator.gpu unavailable');
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(getActiveEngineFallbacks().get('webgpu')?.reason).toContain('navigator.gpu unavailable');
  });
});

describe('logEngineFallback', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs a concrete reason to console.error', () => {
    logEngineFallback('webgpu', 'webgpu', 'navigator.gpu unavailable');
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('[EngineFallback] webgpu'),
    );
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('navigator.gpu unavailable'),
    );
  });

  it('records resolution + error in telemetry', () => {
    const tel = new EngineTelemetry();
    const register = vi.spyOn(tel, 'registerResolution');
    const record = vi.spyOn(tel, 'recordError');

    // Patch module singleton methods for this assertion via direct call pattern
    logEngineFallback('rust', 'wasm', 'import failed', new Error('404'));
    expect(console.error).toHaveBeenCalled();

    // Global singleton should also have been updated
    const snap = engineTelemetry.snapshot();
    expect(snap.rust?.resolution?.backend).toBe('fallback');
    expect(snap.rust?.resolution?.reason).toContain('import failed');
    expect(snap.rust?.errors.count).toBeGreaterThan(0);

    register.mockRestore();
    record.mockRestore();
  });
});