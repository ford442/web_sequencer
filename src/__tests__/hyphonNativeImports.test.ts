import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  normalizeWasmExports,
  formatMissingWasmExports,
  hasProphecyApi,
  createEmscriptenEnv,
  createWASIImports,
  buildHyphonWasmImports,
  open303ExportMapInsufficient,
  prophecyExportMapInsufficient,
  OPEN303_REQUIRED_WASM_EXPORTS,
  PROPHECY_REQUIRED_WASM_EXPORTS,
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

/**
 * Regression guards for the worklet-side instantiation of hyphon_native.wasm.
 *
 * `emscripten/main.cpp` (the Pyodide bootstrap orchestrator) is linked into the
 * same module as the Open303/JC303/Prophecy DSP wrappers, so the binary imports
 * symbols that only `main()` needs. The main thread gets those free from the
 * Emscripten glue (`hyphon_native.js`); the AudioWorklets cannot use the glue and
 * hand-roll their import object here. Any import the wrapper misses makes
 * `WebAssembly.instantiate()` throw with "function import requires a callable",
 * which degrades every 303 voice to FallbackBassSynth — audible, so the app
 * *looks* fine while the native engine is silently gone.
 */
const stubImportContext = () => ({
  getWasmInstance: () => null,
  getImportedMemory: () => null,
  setImportedMemory: () => {},
  onHeapUpdate: () => {},
});

/** Function imports `main.cpp` + the C++ runtime pull into hyphon_native.wasm. */
const MAIN_CPP_RUNTIME_IMPORTS = [
  'emscripten_run_script', // emscripten_run_script("...initPyodideSystem()...")
  '__cxa_throw',           // C++ exception ABI
  'exit',                  // main() returning
] as const;

describe('createEmscriptenEnv (worklet import table)', () => {
  it('supplies the main.cpp/runtime imports the DSP wrappers are linked against', () => {
    const env = createEmscriptenEnv(stubImportContext()) as Record<string, unknown>;
    const missing = MAIN_CPP_RUNTIME_IMPORTS.filter((name) => typeof env[name] !== 'function');
    expect(missing).toEqual([]);
  });

  it('leaves no function import of the real binary unsatisfied', async () => {
    const wasmPath = resolve(__dirname, '../../public/hyphon_native.wasm');
    if (!existsSync(wasmPath)) {
      // Generated artifact (gitignored). The hermetic case above still guards
      // the regression; this one adds artifact-truth wherever it is built.
      return;
    }
    const module = await WebAssembly.compile(readFileSync(wasmPath));
    const env = createEmscriptenEnv(stubImportContext()) as Record<string, unknown>;
    const wasi = createWASIImports() as Record<string, unknown>;

    const missing = WebAssembly.Module.imports(module)
      .filter((i) => i.kind === 'function')
      .filter((i) => {
        const bag = i.module.startsWith('wasi_') ? wasi : env;
        return typeof bag[i.name] !== 'function';
      })
      .map((i) => `${i.module}.${i.name}`);

    expect(missing).toEqual([]);
  });
});

describe('export-map sufficiency predicates', () => {
  /**
   * `wasmExportNameSnapshot` yields a name-only map (values are placeholders, not
   * real functions). The predicates must judge *presence*, or they report
   * "export map did not resolve" against a perfectly good binary and send
   * debugging at the artifact instead of the import table.
   */
  it('accepts a name-only snapshot that does contain the required exports', async () => {
    const wasmPath = resolve(__dirname, '../../public/hyphon_native.wasm');
    if (!existsSync(wasmPath)) return;
    const module = await WebAssembly.compile(readFileSync(wasmPath));
    const identity = (names: readonly string[]) =>
      Object.fromEntries(names.map((n) => [n, n]));

    expect(
      prophecyExportMapInsufficient(module, identity(PROPHECY_REQUIRED_WASM_EXPORTS)),
    ).toBe(false);
    expect(
      open303ExportMapInsufficient(module, identity(['open303_create', 'open303_init'])),
    ).toBe(false);
  });
});

describe('OPEN303_REQUIRED_WASM_EXPORTS', () => {
  it('names exports the binary actually has (jc303 uses the *_handle ABI)', async () => {
    const wasmPath = resolve(__dirname, '../../public/hyphon_native.wasm');
    if (!existsSync(wasmPath)) return;
    const module = await WebAssembly.compile(readFileSync(wasmPath));
    const exported = new Set(WebAssembly.Module.exports(module).map((e) => e.name));
    const bogus = OPEN303_REQUIRED_WASM_EXPORTS.filter((n) => !exported.has(n));
    expect(bogus).toEqual([]);
  });
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
  it('instantiates, runs ctors, and creates + initialises a native 303 voice', async () => {
    const wasmPath = resolve(__dirname, '../../public/hyphon_native.wasm');
    if (!existsSync(wasmPath)) return;

    const module = await WebAssembly.compile(readFileSync(wasmPath));

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
  });
});
