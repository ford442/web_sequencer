import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  EngineTelemetry,
  logEngineFallback,
  parseHyphonGlueExportMap,
  countExportMapDrift,
  loadHyphonWasmExportMap,
  resetHyphonWasmExportMapCache,
  emitUserEngineFallbackWarning,
  getActiveEngineFallbacks,
  clearEngineFallbackWarning,
  resolvePublicAsset,
  engineTelemetry,
} from '../utils/engineTelemetry';
import { engineDegradationStore } from '../stores/engineDegradationStore';

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

describe('countExportMapDrift', () => {
  it('counts keys whose values disagree, including absent vs present', () => {
    expect(countExportMapDrift(
      { open303_create: 'open303_create' },
      { open303_create: 'da' },
    )).toBe(1);
    expect(countExportMapDrift(
      { open303_create: 'da', prophecy_create: 'V' },
      { open303_create: 'da', prophecy_create: 'V' },
    )).toBe(0);
    expect(countExportMapDrift(
      { open303_create: 'da' },
      { open303_create: 'da', prophecy_create: 'V' },
    )).toBe(1);
  });
});

describe('loadHyphonWasmExportMap', () => {
  const MINIFIED_GLUE =
    'Module["_open303_create"]=wasmExports["da"];' +
    'Module["_open303_init"]=wasmExports["fa"];' +
    'Module["_prophecy_create"]=wasmExports["V"];';
  const IDENTITY_JSON = {
    open303_create: 'open303_create',
    open303_init: 'open303_init',
    prophecy_create: 'prophecy_create',
  };
  const MINIFIED_JSON = {
    open303_create: 'da',
    open303_init: 'fa',
    prophecy_create: 'V',
  };

  function mockExportMapFetch(opts: {
    json?: Record<string, string> | null;
    jsonOk?: boolean;
    glue?: string | null;
    glueOk?: boolean;
  }): void {
    vi.mocked(global.fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (href.includes('hyphon_wasm_export_map.json')) {
        if (opts.jsonOk === false) {
          return { ok: false, status: 404 } as Response;
        }
        return { ok: true, json: async () => opts.json ?? {} } as Response;
      }
      if (href.includes('hyphon_native.js')) {
        if (opts.glueOk === false) {
          return { ok: false, status: 404 } as Response;
        }
        return { ok: true, text: async () => opts.glue ?? '' } as Response;
      }
      return { ok: false, status: 404 } as Response;
    });
  }

  beforeEach(() => {
    resetHyphonWasmExportMapCache();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    resetHyphonWasmExportMapCache();
    vi.restoreAllMocks();
  });

  it('prefers glue when JSON is an identity map and glue is minified', async () => {
    mockExportMapFetch({ json: IDENTITY_JSON, glue: MINIFIED_GLUE });
    const map = await loadHyphonWasmExportMap();
    expect(map.open303_create).toBe('da');
    expect(map.open303_init).toBe('fa');
    expect(map.prophecy_create).toBe('V');
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('disagrees with hyphon_native.js glue'),
    );
  });

  it('keeps JSON when it agrees with glue', async () => {
    mockExportMapFetch({ json: MINIFIED_JSON, glue: MINIFIED_GLUE });
    const map = await loadHyphonWasmExportMap();
    expect(map).toEqual(MINIFIED_JSON);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('recovers from glue when JSON is empty', async () => {
    mockExportMapFetch({ json: {}, glue: MINIFIED_GLUE });
    const map = await loadHyphonWasmExportMap();
    expect(map.open303_create).toBe('da');
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('empty or missing'),
    );
  });

  it('returns JSON when glue is empty', async () => {
    mockExportMapFetch({ json: MINIFIED_JSON, glue: '' });
    const map = await loadHyphonWasmExportMap();
    expect(map).toEqual(MINIFIED_JSON);
  });

  it('memoizes the in-flight fetch across callers', async () => {
    mockExportMapFetch({ json: MINIFIED_JSON, glue: MINIFIED_GLUE });
    const [a, b] = await Promise.all([loadHyphonWasmExportMap(), loadHyphonWasmExportMap()]);
    expect(a).toBe(b);
    const jsonFetches = vi.mocked(global.fetch).mock.calls.filter(([url]) =>
      String(url).includes('hyphon_wasm_export_map.json'),
    );
    expect(jsonFetches).toHaveLength(1);
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

  it('records degradation in engineDegradationStore', () => {
    engineDegradationStore.clear('webgpu-test');
    logEngineFallback('webgpu-test', 'webgpu', 'navigator.gpu unavailable');
    expect(engineDegradationStore.getIssue('webgpu-test')?.activeBackend).toBe('js-fallback');
  });
});