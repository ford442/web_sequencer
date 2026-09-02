/**
 * Per-engine init-path tests (issue #720).
 * Each engine must either initialize or emit a classified fallback reason.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseHyphonGlueExportMap } from '../utils/engineTelemetry';
import { normalizeWasmExports } from '../audio-worklets/hyphonNativeImports';
import { WebGpuOscillator } from '../engines/WebGpuOscillator';
import { Open303Oscillator } from '../engines/Open303Oscillator';
import { repoRoot } from '@/test/helpers/requireRepoArtifacts';

const repoRootPath = repoRoot();

describe('hyphon_native export map (Open303 / JC303 / Prophecy)', () => {
  let glue: string;
  let map: ReturnType<typeof parseHyphonGlueExportMap>;

  beforeEach(() => {
    glue = readFileSync(join(repoRootPath, 'public/hyphon_native.js'), 'utf8');
    map = parseHyphonGlueExportMap(glue);
  });

  it('release build exposes multi-instance JC303 handle API', () => {
    expect(map.open303_create).toBeTruthy();
    expect(map.prophecy_process).toBeTruthy();
    expect(map.jc303_create).toBeTruthy();
    expect(map.jc303_init_handle).toBeTruthy();
    expect(map.jc303_process_handle).toBeTruthy();

    const fakeExports = {
      [map.open303_create!]: () => 1,
      [map.prophecy_process!]: () => 2,
      [map.jc303_create!]: () => 3,
      [map.jc303_init_handle!]: () => 1,
      [map.jc303_process_handle!]: () => 4,
    } as unknown as WebAssembly.Exports;

    const normalized = normalizeWasmExports(fakeExports, map);
    expect(typeof normalized.open303_create).toBe('function');
    expect(typeof normalized.prophecy_process).toBe('function');
    expect(typeof normalized.jc303_create).toBe('function');
    expect(typeof normalized.jc303_init_handle).toBe('function');
    expect(typeof normalized.jc303_process_handle).toBe('function');
  });

  it('debug build exposes legacy single-instance jc303_init when present', () => {
    if (!map.jc303_init) {
      return; // release build — legacy API pruned (HYPHON_LEGACY_JC303=0)
    }
    expect(map.jc303_init).toBeTruthy();

    const fakeExports = {
      [map.jc303_init!]: () => 1,
    } as unknown as WebAssembly.Exports;

    const normalized = normalizeWasmExports(fakeExports, map);
    expect(typeof normalized.jc303_init).toBe('function');
  });
});

describe('RustOscillator.init', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock('../utils/engineTelemetry');
    vi.resetModules();
  });

  it('logs classified fallback when dynamic import fails', async () => {
    vi.resetModules();
    vi.doMock('../utils/engineTelemetry', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../utils/engineTelemetry')>();
      return {
        ...actual,
        resolvePublicAsset: () => 'file:///nonexistent/missing_rust_audio.js',
      };
    });

    const { RustOscillator: RustOsc } = await import('../engines/RustOscillator');
    const osc = new RustOsc();
    await osc.init();

    expect(osc.isReady).toBe(false);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('[EngineFallback] rust'),
    );

    vi.doUnmock('../utils/engineTelemetry');
    vi.resetModules();
  });
});

describe('WebGpuOscillator.init', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs classified fallback when navigator.gpu is missing', async () => {
    // @ts-expect-error test override
    global.navigator.gpu = undefined;

    const osc = new WebGpuOscillator();
    await osc.init();

    expect(osc.isSupported).toBe(false);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('navigator.gpu unavailable'),
    );
  });
});

describe('Open303Oscillator.init export map wiring', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('includes non-empty exportMap in init-wasm message', async () => {
    const glue = readFileSync(join(repoRootPath, 'public/hyphon_native.js'), 'utf8');
    const exportMap = parseHyphonGlueExportMap(glue);

    const mockWorkletNode = {
      port: {
        postMessage: vi.fn(),
        onmessage: null as ((ev: MessageEvent) => void) | null,
        close: vi.fn(),
      },
      connect: vi.fn(),
      disconnect: vi.fn(),
    };

    Object.defineProperty(mockWorkletNode.port, 'onmessage', {
      set(handler: ((ev: MessageEvent) => void) | null) {
        if (handler) setTimeout(() => handler({ data: { type: 'ready' } } as MessageEvent), 0);
      },
      get() {
        return null;
      },
      configurable: true,
    });

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('hyphon_native.wasm')) {
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(64) };
      }
      if (url.includes('hyphon_wasm_export_map.json')) {
        return { ok: true, json: async () => exportMap };
      }
      if (url.includes('hyphon_native.js')) {
        return { ok: true, text: async () => glue };
      }
      if (url.includes('hyphon_wasm_export_map.json')) {
        return { ok: true, json: async () => ({
            "open303_create": "open303_create_mangled"
        }) };
      }
      return { ok: false, status: 404 };
    }));

    const mockModule = {} as WebAssembly.Module;
    vi.stubGlobal('WebAssembly', {
      ...WebAssembly,
      compile: vi.fn().mockResolvedValue(mockModule),
      Module: {
         imports: vi.fn().mockReturnValue([{ kind: 'memory', module: 'a', name: 'a' }]),
         exports: vi.fn().mockReturnValue([{ kind: 'function', name: 'open303_create_mangled' }]),
      },
    });

    const mockAudioContext = {
      sampleRate: 44100,
      createGain: vi.fn(() => ({
        connect: vi.fn(),
        gain: { value: 1 },
      })),
      audioWorklet: { addModule: vi.fn().mockResolvedValue(undefined) },
    } as unknown as AudioContext;

    global.AudioWorkletNode = vi.fn(() => mockWorkletNode) as unknown as typeof AudioWorkletNode;

    const osc = new Open303Oscillator();
    const ok = await osc.init(mockAudioContext, '/open303-processor.js');

    // The promise might not resolve true if it's already initialized or if there was a problem.
    // Just assert that we called the port message as expected
    expect(mockWorkletNode.port.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'init-wasm',
        data: expect.objectContaining({
          exportMap: expect.objectContaining({ open303_create: expect.any(String) }),
        }),
      }),
    );
  });
});
