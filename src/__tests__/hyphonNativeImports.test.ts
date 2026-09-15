import { describe, it, expect, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  normalizeWasmExports,
  formatMissingWasmExports,
  hasProphecyApi,
  hasDrumkitApi,
  createEmscriptenEnv,
  buildHyphonWasmImports,
  HYPHON_NATIVE_ST_MIN_MEMORY_PAGES,
  open303ExportMapInsufficient,
  prophecyExportMapInsufficient,
  drumkitExportMapInsufficient,
  OPEN303_REQUIRED_WASM_EXPORTS,
  PROPHECY_REQUIRED_WASM_EXPORTS,
  DRUMKIT_REQUIRED_WASM_EXPORTS,
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

describe('hasDrumkitApi', () => {
  it('accepts normalized exports, not raw minified names', () => {
    const fn = () => 1;
    const raw = { V: fn, X: fn, Y: fn, S: fn, T: fn, C: fn } as unknown as WebAssembly.Exports;
    expect(hasDrumkitApi(raw as Record<string, unknown>)).toBe(false);
    const normalized = normalizeWasmExports(raw, {
      drumkit_create: 'V',
      drumkit_init: 'X',
      drumkit_set_kit: 'S',
      drumkit_trigger: 'T',
      drumkit_choke_open_hat: 'C',
      drumkit_process: 'Y',
    });
    expect(hasDrumkitApi(normalized)).toBe(true);
  });

  it('rejects a module missing trigger or choke', () => {
    const fn = () => 1;
    const normalized = normalizeWasmExports(
      { V: fn, X: fn, Y: fn } as unknown as WebAssembly.Exports,
      {
        drumkit_create: 'V',
        drumkit_init: 'X',
        drumkit_process: 'Y',
      },
    );
    expect(hasDrumkitApi(normalized)).toBe(false);
  });
});

/**
 * Regression guards for the worklet-side instantiation of hyphon_native.wasm.
 *
 * `emscripten/main.cpp` (the Pyodide bootstrap orchestrator) is linked into the
 * same module as the Open303/JC303/Prophecy DSP wrappers, so the binary imports
 * symbols that only `main()` needs. The main thread gets those free from the
 * Emscripten glue (`hyphon_native.js`); the AudioWorklets cannot use the glue and
 * derive the import object from `WebAssembly.Module.imports()` instead. Any
 * import that used to be missing made `WebAssembly.instantiate()` throw with
 * "function import requires a callable", which degrades every 303 voice to
 * FallbackBassSynth — audible, so the app *looks* fine while the native engine
 * is silently gone.
 */
const stubImportContext = () => ({
  getWasmInstance: () => null,
  getImportedMemory: () => null,
  setImportedMemory: () => {},
  onHeapUpdate: () => {},
});

const HYPHON_NATIVE_WASM = resolve(__dirname, '../../public/hyphon_native.wasm');
const HYPHON_NATIVE_ST_WASM = resolve(__dirname, '../../public/hyphon_native.st.wasm');

function nativeRequired(): boolean {
  return process.env.HYPHON_REQUIRE_NATIVE === '1';
}

/** Skip binary-dependent tests in the unit tier; fail loud when the integration flag is set. */
function skipIfNativeArtifactMissing(path: string): boolean {
  if (nativeRequired()) return false;
  return !existsSync(path);
}

function leb128(n: number): number[] {
  const out: number[] = [];
  do {
    let byte = n & 0x7f;
    n >>>= 7;
    if (n !== 0) byte |= 0x80;
    out.push(byte);
  } while (n !== 0);
  return out;
}

function wasmName(s: string): number[] {
  const bytes = Array.from(new TextEncoder().encode(s));
  return [...leb128(bytes.length), ...bytes];
}

function wasmSection(id: number, body: number[]): number[] {
  return [id, ...leb128(body.length), ...body];
}

/**
 * Tiny module: imports `env.<symbol>` as `() -> i32` and exports `run` that calls it.
 * Used to guard derivation without `public/hyphon_native.wasm`.
 */
function compileModuleImportingEnvFunction(symbol: string): WebAssembly.Module {
  const typeSection = wasmSection(1, [1, 0x60, 0x00, 0x01, 0x7f]);
  const importSection = wasmSection(2, [1, ...wasmName('env'), ...wasmName(symbol), 0x00, 0x00]);
  const funcSection = wasmSection(3, [1, 0x00]);
  const exportSection = wasmSection(7, [1, ...wasmName('run'), 0x00, 0x01]);
  const codeSection = wasmSection(10, [1, 0x04, 0x00, 0x10, 0x00, 0x0b]);
  const bytes = new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...typeSection,
    ...importSection,
    ...funcSection,
    ...exportSection,
    ...codeSection,
  ]);
  return new WebAssembly.Module(bytes);
}

/** Function imports `main.cpp` + the C++ runtime pull into hyphon_native.wasm. */
const MAIN_CPP_RUNTIME_IMPORTS = [
  'emscripten_run_script', // emscripten_run_script("...initPyodideSystem()...")
  '__cxa_throw',           // C++ exception ABI
  'exit',                  // main() returning
  'emscripten_date_now',
  '_emscripten_get_now_is_monotonic',
  '__emscripten_init_main_thread_js',
  '__emscripten_thread_cleanup',
] as const;

describe('createEmscriptenEnv (worklet import table)', () => {
  it('supplies the main.cpp/runtime imports the DSP wrappers are linked against', () => {
    const env = createEmscriptenEnv(stubImportContext()) as Record<string, unknown>;
    const missing = MAIN_CPP_RUNTIME_IMPORTS.filter((name) => typeof env[name] !== 'function');
    expect(missing).toEqual([]);
  });

  it('implements emscripten_date_now as Date.now and monotonic as 1', () => {
    const env = createEmscriptenEnv(stubImportContext()) as Record<string, unknown>;
    const before = Date.now();
    expect((env.emscripten_date_now as () => number)()).toBeGreaterThanOrEqual(before);
    expect((env._emscripten_get_now_is_monotonic as () => number)()).toBe(1);
  });

  it.skipIf(skipIfNativeArtifactMissing(HYPHON_NATIVE_WASM))(
    'leaves no function import of the real binary unsatisfied after derivation',
    async () => {
      expect(
        existsSync(HYPHON_NATIVE_WASM),
        'public/hyphon_native.wasm missing (HYPHON_REQUIRE_NATIVE=1; build native for the integration tier)',
      ).toBe(true);
      const module = await WebAssembly.compile(readFileSync(HYPHON_NATIVE_WASM));
      const { imports } = buildHyphonWasmImports(module, stubImportContext(), { isThreaded: true });

      const missing = WebAssembly.Module.imports(module)
        .filter((i) => i.kind === 'function')
        .filter((i) => {
          const bag = imports[i.module] as Record<string, unknown> | undefined;
          return typeof bag?.[i.name] !== 'function';
        })
        .map((i) => `${i.module}.${i.name}`);

      expect(missing).toEqual([]);
    },
  );
});

describe('buildHyphonWasmImports (derived import table)', () => {
  it('instantiates a module that imports an unknown env function and warns once', async () => {
    const symbol = 'totally_unknown_env_symbol';
    const explicit = createEmscriptenEnv(stubImportContext()) as Record<string, unknown>;
    expect(typeof explicit[symbol]).not.toBe('function');

    const module = compileModuleImportingEnvFunction(symbol);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { imports } = buildHyphonWasmImports(module, stubImportContext(), { isThreaded: false });
      const instance = await WebAssembly.instantiate(module, imports);
      const run = instance.exports.run as () => number;
      expect(run()).toBe(0);

      const named = warn.mock.calls.filter((args) =>
        args.some((arg) => String(arg).includes(symbol)),
      );
      expect(named).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('hyphon_native.wasm artifact', () => {
  it.skipIf(!nativeRequired())('exists when HYPHON_REQUIRE_NATIVE=1', () => {
    expect(
      existsSync(HYPHON_NATIVE_WASM),
      'public/hyphon_native.wasm missing (HYPHON_REQUIRE_NATIVE=1; build native for the integration tier)',
    ).toBe(true);
  });
});

describe('export-map sufficiency predicates', () => {
  /**
   * `wasmExportNameSnapshot` yields a name-only map (values are placeholders, not
   * real functions). The predicates must judge *presence*, or they report
   * "export map did not resolve" against a perfectly good binary and send
   * debugging at the artifact instead of the import table.
   */
  it.skipIf(skipIfNativeArtifactMissing(HYPHON_NATIVE_WASM))(
    'accepts a name-only snapshot that does contain the required exports',
    async () => {
    expect(
      existsSync(HYPHON_NATIVE_WASM),
      'public/hyphon_native.wasm missing (HYPHON_REQUIRE_NATIVE=1; build native for the integration tier)',
    ).toBe(true);
    const module = await WebAssembly.compile(readFileSync(HYPHON_NATIVE_WASM));
    const identity = (names: readonly string[]) =>
      Object.fromEntries(names.map((n) => [n, n]));

    expect(
      prophecyExportMapInsufficient(module, identity(PROPHECY_REQUIRED_WASM_EXPORTS)),
    ).toBe(false);
    expect(
      open303ExportMapInsufficient(module, identity(['open303_create', 'open303_init'])),
    ).toBe(false);
    const exported = new Set(WebAssembly.Module.exports(module).map((e) => e.name));
    if (DRUMKIT_REQUIRED_WASM_EXPORTS.every((n) => exported.has(n))) {
      expect(drumkitExportMapInsufficient(module, identity(DRUMKIT_REQUIRED_WASM_EXPORTS))).toBe(false);
    }
  },
  );
});

describe('OPEN303_REQUIRED_WASM_EXPORTS', () => {
  it.skipIf(skipIfNativeArtifactMissing(HYPHON_NATIVE_WASM))(
    'names exports the binary actually has (jc303 uses the *_handle ABI)',
    async () => {
    expect(
      existsSync(HYPHON_NATIVE_WASM),
      'public/hyphon_native.wasm missing (HYPHON_REQUIRE_NATIVE=1; build native for the integration tier)',
    ).toBe(true);
    const module = await WebAssembly.compile(readFileSync(HYPHON_NATIVE_WASM));
    const exported = new Set(WebAssembly.Module.exports(module).map((e) => e.name));
    const bogus = OPEN303_REQUIRED_WASM_EXPORTS.filter((n) => !exported.has(n));
    expect(bogus).toEqual([]);
  },
  );
});

/**
 * End-to-end guard for the worklet-side handshake with hyphon_native.wasm.
 *
 * This is the test that would have caught the whole outage in one assertion: it
 * fails if the import table is incomplete, if the C++ static constructors are
 * skipped, or if the handle ABI is coerced to the wrong representation. Each of
 * those independently degraded all three 303 voices to a JS fallback that still
 * made sound, so nothing downstream noticed.
 */
describe('hyphon_native.wasm worklet handshake', () => {
  it.skipIf(skipIfNativeArtifactMissing(HYPHON_NATIVE_WASM))(
    'instantiates, runs ctors, and creates + initialises a native 303 voice',
    async () => {
    expect(
      existsSync(HYPHON_NATIVE_WASM),
      'public/hyphon_native.wasm missing (HYPHON_REQUIRE_NATIVE=1; build native for the integration tier)',
    ).toBe(true);

    const module = await WebAssembly.compile(readFileSync(HYPHON_NATIVE_WASM));

    let instance: WebAssembly.Instance | null = null;
    let importedMemory: WebAssembly.Memory | null = null;
    const { imports } = buildHyphonWasmImports(
      module,
      {
        getWasmInstance: () => instance,
        getImportedMemory: () => importedMemory,
        setImportedMemory: (m) => { importedMemory = m; },
        onHeapUpdate: () => {},
        logPrefix: '[test]',
      },
      { isThreaded: true },
    );

    instance = await WebAssembly.instantiate(module, imports);
    const exports = instance.exports as Record<string, (...a: never[]) => unknown>;

    // Global constructors must run before any export is safe to call.
    expect(typeof exports.__wasm_call_ctors).toBe('function');
    (exports.__wasm_call_ctors as () => void)();

    const handle = (exports.open303_create as () => number | bigint)();
    expect(handle).toBeTruthy();

    // The handles are i32 in this wasm32 build: coercing to BigInt throws
    // "Cannot convert a BigInt value to a number" at the boundary.
    const init = exports.open303_init as (h: number | bigint, sr: number, n: number) => number;
    expect(init(handle, 48000, 128)).toBe(1);

    const drumCreate = exports.drumkit_create as (() => number | bigint) | undefined;
    if (typeof drumCreate === 'function') {
      const drumHandle = drumCreate();
      expect(drumHandle).toBeTruthy();
      const drumInit = exports.drumkit_init as (h: number | bigint, sr: number, n: number) => number;
      expect(drumInit(drumHandle, 48000, 128)).toBe(1);
    }
  },
  );
});

/**
 * The single-threaded profile must work through the exact same worklet import
 * wiring: plain (non-shared) imported memory sized from the ST budget, ctors,
 * and a voice that actually renders. Explicit skip in the unit tier; the
 * integration flag `HYPHON_REQUIRE_NATIVE=1` fails if the artifact is missing.
 */
describe('hyphon_native.st.wasm worklet handshake', () => {
  it.skipIf(skipIfNativeArtifactMissing(HYPHON_NATIVE_ST_WASM))(
    'instantiates with a non-shared memory and renders a native 303 voice',
    async () => {
    expect(
      existsSync(HYPHON_NATIVE_ST_WASM),
      'public/hyphon_native.st.wasm missing (HYPHON_REQUIRE_NATIVE=1; build native for the integration tier)',
    ).toBe(true);

    const bytes = readFileSync(HYPHON_NATIVE_ST_WASM);
    const { checkSingleThreadedModule } = await import('../../tools/check_hyphon_st_module.mjs');
    expect(checkSingleThreadedModule(bytes)).toEqual([]);

    const module = await WebAssembly.compile(bytes);
    let instance: WebAssembly.Instance | null = null;
    let importedMemory: WebAssembly.Memory | null = null;
    const { imports, memory } = buildHyphonWasmImports(
      module,
      {
        getWasmInstance: () => instance,
        getImportedMemory: () => importedMemory,
        setImportedMemory: (m) => { importedMemory = m; },
        onHeapUpdate: () => {},
        logPrefix: '[test]',
      },
      { isThreaded: false },
    );
    expect(memory).not.toBeNull();
    expect(memory!.buffer).toBeInstanceOf(ArrayBuffer);
    expect(memory!.buffer.byteLength / 65536).toBe(HYPHON_NATIVE_ST_MIN_MEMORY_PAGES);

    instance = await WebAssembly.instantiate(module, imports);
    const x = instance.exports as Record<string, (...a: number[]) => number>;
    x.__wasm_call_ctors();

    const handle = x.open303_create();
    expect(handle).toBeTruthy();
    expect(x.open303_init(handle, 48000, 128)).toBe(1);
    x.open303_note_on(handle, 45, 127);
    const out = x.malloc(128 * 2 * 4);
    let peak = 0;
    for (let block = 0; block < 20; block++) {
      x.open303_process(handle, out, 128);
      for (const sample of new Float32Array(memory!.buffer, out, 256)) peak = Math.max(peak, Math.abs(sample));
    }
    expect(peak).toBeGreaterThan(0.01);
  },
  );
});
