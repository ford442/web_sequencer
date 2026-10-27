// Shared Emscripten import wiring for hyphon_native.wasm inside AudioWorklets.
// Open303, Prophecy, and the analog drumkit instantiate the same WASM module.
// emscripten/build.sh links with -lexports.js, so import/export names are not
// minified (env.memory, emscripten_resize_heap, …); the single-letter aliases
// below only matter for an old minified build still sitting in a cache.

import { nowMs } from '../shared/rt/time';

/** WebAssembly page size (64 KiB). */
const WASM_PAGE_BYTES = 65536;

/**
 * Initial memory of the threaded hyphon_native.wasm build, in 64 KiB pages.
 *
 * MUST equal `hyphonNative.initialMemoryMb` in emscripten/wasm_memory_budget.json
 * (the value emscripten/build.sh passes as -s INITIAL_MEMORY): the worklets
 * instantiate the module with an *imported* memory, and a memory whose `initial`
 * is below the module's declared minimum fails instantiation outright.
 * src/__tests__/wasmMemoryBudget.test.ts enforces the match in CI.
 *
 * 32 MB (was 128 MB, before that 512 MB) — measured: the full live voice set
 * peaks at 8.5 MB, 8 MB of it stack (wasm_memory_budget.json#hyphonNative,
 * docs/wasm/BUILD_NOTES.md#four-worlds-memory-budget). A large `shared: true`
 * allocation is a frequent SharedArrayBuffer failure on mobile Safari and low-RAM
 * Chromebooks even with correct COOP/COEP; the module grows on demand up to
 * HYPHON_NATIVE_MAX_MEMORY_PAGES.
 */
export const HYPHON_NATIVE_MIN_MEMORY_PAGES = (32 * 1024 * 1024) / WASM_PAGE_BYTES; // 512

/** Growth ceiling, matching -s MAXIMUM_MEMORY in emscripten/build.sh (1 GB). */
export const HYPHON_NATIVE_MAX_MEMORY_PAGES = (1024 * 1024 * 1024) / WASM_PAGE_BYTES; // 16384

/**
 * Initial memory of the single-threaded hyphon_native.st.wasm build, in pages.
 * MUST equal `hyphonNativeSt.initialMemoryMb` (src/__tests__/wasmMemoryBudget.test.ts).
 * Non-shared, so this is an ordinary ArrayBuffer and growth is cheap.
 */
export const HYPHON_NATIVE_ST_MIN_MEMORY_PAGES = (16 * 1024 * 1024) / WASM_PAGE_BYTES; // 256

/** Growth ceiling of the ST build, matching `hyphonNativeSt.maximumMemoryMb` (512 MB). */
export const HYPHON_NATIVE_ST_MAX_MEMORY_PAGES = (512 * 1024 * 1024) / WASM_PAGE_BYTES; // 8192

/**
 * The two hyphon_native link profiles emitted by emscripten/build.sh.
 * See docs/wasm/BUILD_NOTES.md#threading-profiles.
 */
export type HyphonNativeThreading = 'pthread' | 'st';

/**
 * Frames each voice-core voice reserves at init (#1344). The core refuses a
 * larger block rather than allocating on the audio thread, so this covers
 * `renderSizeHint: 'hardware'` quanta, not just the default 128.
 */
export const NATIVE_VOICE_MAX_BLOCK_FRAMES = 4096;

export interface HyphonNativeArtifact {
  threading: HyphonNativeThreading;
  /** File names under public/. */
  wasm: string;
  glue: string;
  exportMap: string;
  /** Imported memory is `shared: true` (pthread) or a plain ArrayBuffer (st). */
  sharedMemory: boolean;
  minMemoryPages: number;
  maxMemoryPages: number;
}

export const HYPHON_NATIVE_ARTIFACTS: Readonly<Record<HyphonNativeThreading, HyphonNativeArtifact>> = {
  pthread: {
    threading: 'pthread',
    wasm: 'hyphon_native.wasm',
    glue: 'hyphon_native.js',
    exportMap: 'hyphon_wasm_export_map.json',
    sharedMemory: true,
    minMemoryPages: HYPHON_NATIVE_MIN_MEMORY_PAGES,
    maxMemoryPages: HYPHON_NATIVE_MAX_MEMORY_PAGES,
  },
  st: {
    threading: 'st',
    wasm: 'hyphon_native.st.wasm',
    glue: 'hyphon_native.st.js',
    exportMap: 'hyphon_wasm_export_map.st.json',
    sharedMemory: false,
    minMemoryPages: HYPHON_NATIVE_ST_MIN_MEMORY_PAGES,
    maxMemoryPages: HYPHON_NATIVE_ST_MAX_MEMORY_PAGES,
  },
};

export type WasmExportMap = Record<string, string>;

/**
 * Map minified WASM export names to the bare API names worklets use.
 * When wasm-opt minifies exports, `hyphon_wasm_export_map.json` (built from
 * hyphon_native.js) supplies the minified key for each logical export.
 */
export function normalizeWasmExports(
  exports: WebAssembly.Exports,
  map: WasmExportMap = {},
): Record<string, unknown> {
  const raw = exports as Record<string, unknown>;
  const normalized: Record<string, unknown> = { ...raw };

  for (const [bare, minified] of Object.entries(map)) {
    const fn = raw[minified];
    if (typeof fn === 'function') {
      normalized[bare] = fn;
      normalized[`_${bare}`] = fn;
    }
  }

  for (const [key, val] of Object.entries(raw)) {
    if (key.startsWith('_') && typeof val === 'function') {
      const bare = key.slice(1);
      if (normalized[bare] === undefined) normalized[bare] = val;
    }
  }

  return normalized;
}

/** How many raw WASM export names to include in mismatch errors. */
const WASM_EXPORT_NAME_PREVIEW = 48;

/**
 * Describe a missing-API failure with the actual (often minified) export names
 * present on the instantiated module, so a stale export map is obvious in logs.
 */
export function formatMissingWasmExports(
  rawExports: WebAssembly.Exports,
  requiredBareNames: readonly string[],
): string {
  const names = Object.keys(rawExports).sort();
  const preview = names.slice(0, WASM_EXPORT_NAME_PREVIEW).join(', ');
  const extra =
    names.length > WASM_EXPORT_NAME_PREVIEW
      ? ` … (+${names.length - WASM_EXPORT_NAME_PREVIEW} more)`
      : '';
  return (
    `missing ${requiredBareNames.join(', ')}. ` +
    `WASM exports (${names.length}): ${preview}${extra}`
  );
}

/**
 * Bare export names the Open303 worklet must resolve via the export map: the
 * custom open303 voice on the voice core's event API (#1344). The authentic
 * jc303 voice is optional — the worklet ignores a switch to it without them.
 */
export const OPEN303_REQUIRED_WASM_EXPORTS = [
  'open303_create',
  'open303_init',
  'open303_push_event',
  'open303_render',
  'open303_cancel_notes',
  'open303_flush',
] as const;

/** Exports that enable the authentic jc303 voice in the Open303 worklet. */
export const JC303_WASM_EXPORTS = [
  'jc303_create',
  'jc303_init',
  'jc303_push_event',
  'jc303_render',
  'jc303_cancel_notes',
  'jc303_flush',
] as const;

/** Bare export names the Prophecy worklet must resolve via the export map. */
export const PROPHECY_REQUIRED_WASM_EXPORTS = [
  'prophecy_create',
  'prophecy_init',
  'prophecy_push_event',
  'prophecy_render',
  'prophecy_cancel_notes',
  'prophecy_all_notes_off',
] as const;

/** Bare export names the macro (Plaits) worklet must resolve via the export map. */
export const MACRO_REQUIRED_WASM_EXPORTS = [
  'macro_create',
  'macro_init',
  'macro_push_event',
  'macro_render',
  'macro_cancel_notes',
  'macro_all_notes_off',
  'macro_set_param_now',
  'macro_engine_count',
  'macro_stride',
] as const;

/** Bare export names the drumkit worklet must resolve via the export map. */
export const DRUMKIT_REQUIRED_WASM_EXPORTS = [
  'drumkit_create',
  'drumkit_init',
  'drumkit_push_event',
  'drumkit_render',
] as const;

/**
 * Name-only snapshot of a compiled module's exports (for main-thread diagnostics).
 *
 * Values are inert placeholder *functions*, not `null`: the sufficiency
 * predicates below run `normalizeWasmExports` over this snapshot and ask
 * `typeof … === 'function'`. With `null` values every predicate answered
 * "insufficient" unconditionally, so a perfectly good binary was reported as
 * `export map did not resolve …` — pointing debugging at the artifact instead of
 * at the import table. A snapshot can only answer "is this name present", and
 * the placeholder is what lets it answer that honestly.
 */
export function wasmExportNameSnapshot(module: WebAssembly.Module): WebAssembly.Exports {
  const out: Record<string, unknown> = {};
  for (const entry of WebAssembly.Module.exports(module)) {
    out[entry.name] = () => undefined;
  }
  return out as WebAssembly.Exports;
}

/** True when the export map fails to surface the open303 voice API against the compiled module. */
export function open303ExportMapInsufficient(
  module: WebAssembly.Module,
  exportMap: WasmExportMap,
): boolean {
  const normalized = normalizeWasmExports(wasmExportNameSnapshot(module), exportMap);
  return !hasOpen303Api(normalized);
}

export function hasOpen303Api(exports: Record<string, unknown>): boolean {
  return OPEN303_REQUIRED_WASM_EXPORTS.every((name) => typeof exports[name] === 'function');
}

export function hasJc303Api(exports: Record<string, unknown>): boolean {
  return JC303_WASM_EXPORTS.every((name) => typeof exports[name] === 'function');
}

/** True when prophecy_create/init cannot be resolved from the export map. */
export function prophecyExportMapInsufficient(
  module: WebAssembly.Module,
  exportMap: WasmExportMap,
): boolean {
  const normalized = normalizeWasmExports(wasmExportNameSnapshot(module), exportMap);
  return !hasProphecyApi(normalized);
}

export function hasProphecyApi(exports: Record<string, unknown>): boolean {
  return PROPHECY_REQUIRED_WASM_EXPORTS.every((name) => typeof exports[name] === 'function');
}

/**
 * True when the macro voice API cannot be resolved from the export map — a
 * hyphon_native built before the macro-* family, or a broken map.
 */
export function macroExportMapInsufficient(
  module: WebAssembly.Module,
  exportMap: WasmExportMap,
): boolean {
  const normalized = normalizeWasmExports(wasmExportNameSnapshot(module), exportMap);
  return !hasMacroApi(normalized);
}

export function hasMacroApi(exports: Record<string, unknown>): boolean {
  return MACRO_REQUIRED_WASM_EXPORTS.every((name) => typeof exports[name] === 'function');
}

/** True when the drumkit voice API cannot be resolved from the export map. */
export function drumkitExportMapInsufficient(
  module: WebAssembly.Module,
  exportMap: WasmExportMap,
): boolean {
  const normalized = normalizeWasmExports(wasmExportNameSnapshot(module), exportMap);
  return !hasDrumkitApi(normalized);
}

export function hasDrumkitApi(exports: Record<string, unknown>): boolean {
  return DRUMKIT_REQUIRED_WASM_EXPORTS.every(
    (name) => typeof exports[name] === 'function',
  );
}

export interface HyphonNativeImportContext {
  getWasmInstance: () => WebAssembly.Instance | null;
  getImportedMemory: () => WebAssembly.Memory | null;
  setImportedMemory: (memory: WebAssembly.Memory) => void;
  onHeapUpdate: () => void;
  logPrefix?: string;
}

const getTime = nowMs;

export function createHyphonMemory(
  pages: number | undefined,
  shared: boolean,
  logPrefix = '[HyphonNative]',
): WebAssembly.Memory {
  const artifact = HYPHON_NATIVE_ARTIFACTS[shared ? 'pthread' : 'st'];
  const memoryImportPages = Math.max(pages ?? 0, artifact.minMemoryPages);
  const maxMemoryPages = artifact.maxMemoryPages;

  if (shared) {
    try {
      return new WebAssembly.Memory({
        initial: memoryImportPages,
        maximum: maxMemoryPages,
        shared: true,
      });
    } catch (err) {
      // Distinguish "no SAB at all" (COOP/COEP) from "SAB exists but this
      // reservation is too large for the device" — the latter is the common
      // mobile failure and is worth reporting with the actual sizes.
      const sizesMb = `initial=${(memoryImportPages * WASM_PAGE_BYTES) / 1048576}MB, ` +
        `maximum=${(maxMemoryPages * WASM_PAGE_BYTES) / 1048576}MB`;
      if (typeof SharedArrayBuffer === 'undefined') {
        throw new Error(
          `${logPrefix} SharedArrayBuffer not available. Ensure COOP/COEP headers are configured.`,
        );
      }
      throw new Error(
        `${logPrefix} shared WebAssembly.Memory allocation failed (${sizesMb}): ` +
        `${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return new WebAssembly.Memory({
    initial: memoryImportPages,
    maximum: maxMemoryPages,
  });
}

function tableInvoke(
  ctx: HyphonNativeImportContext,
  index: number,
  args: number[],
): number {
  const exports = ctx.getWasmInstance()?.exports as Record<string, unknown> | undefined;
  const tbl = (exports?.wasmTable ?? exports?.table) as WebAssembly.Table | undefined;
  if (!tbl) return 0;
  const fn = tbl.get(index) as ((...a: number[]) => number) | null;
  if (!fn) return 0;
  try {
    return fn(...args) ?? 0;
  } catch {
    return 0;
  }
}

export function createEmscriptenEnv(ctx: HyphonNativeImportContext): Record<string, unknown> {
  const logPrefix = ctx.logPrefix ?? '[HyphonNative]';

  const resizeHeap = (size: number): number => {
    const memory =
      (ctx.getWasmInstance()?.exports as { memory?: WebAssembly.Memory } | undefined)?.memory ??
      ctx.getImportedMemory();
    if (!memory) {
      console.warn(`${logPrefix} emscripten_resize_heap called but no memory available yet`);
      return 0;
    }
    const currentPages = memory.buffer.byteLength / (64 * 1024);
    const targetPages = Math.ceil(size / (64 * 1024));
    const deltaPages = targetPages - currentPages;
    if (deltaPages > 0) {
      try {
        memory.grow(deltaPages);
        ctx.onHeapUpdate();
        return 1;
      } catch (e) {
        console.error(`${logPrefix} Failed to grow heap:`, e);
        return 0;
      }
    }
    return 1;
  };

  const handleStackOverflow = (): void => {
    throw new Error(`${logPrefix} Stack overflow detected in WASM`);
  };

  const env: Record<string, unknown> = {
    _abort_js: () => console.error('WASM Abort'),
    abort: () => console.error('WASM Abort'),
    __handle_stack_overflow: handleStackOverflow,
    segfault: () => {
      console.error(`${logPrefix} Segmentation fault`);
      return 0;
    },
    alignfault: () => {
      console.error(`${logPrefix} Alignment fault`);
      return 0;
    },
    emscripten_resize_heap: resizeHeap,
    _emscripten_resize_heap: resizeHeap,
    emscripten_notify_memory_growth: () => ctx.onHeapUpdate(),
    exp: Math.exp,
    pow: Math.pow,
    sin: Math.sin,
    cos: Math.cos,
    fmod: (x: number, y: number) => x % y,
    invoke_ii: (index: number, a1: number) => tableInvoke(ctx, index, [a1]),
    invoke_vi: (index: number, a1: number) => {
      tableInvoke(ctx, index, [a1]);
    },
    invoke_vii: (index: number, a1: number, a2: number) => {
      tableInvoke(ctx, index, [a1, a2]);
    },
    invoke_vid: (index: number, a1: number, a2: number) => {
      tableInvoke(ctx, index, [a1, a2]);
    },
    invoke_dddddd: (
      index: number,
      a1: number,
      a2: number,
      a3: number,
      a4: number,
      a5: number,
    ) => tableInvoke(ctx, index, [a1, a2, a3, a4, a5]),
    _emscripten_thread_set_strongref: () => {},
    emscripten_exit_with_live_runtime: () => {},
    _emscripten_notify_mailbox_postmessage: () => {},
    emscripten_check_blocking_allowed: () => {},
    _emscripten_receive_on_main_thread_js: () => {},
    _emscripten_init_main_thread_js: () => {},
    _emscripten_thread_mailbox_await: () => {},
    _emscripten_thread_cleanup: () => {},
    _setitimer_js: () => {},
    _emscripten_runtime_keepalive_clear: () => {},
    clock_time_get: () => Date.now() * 1_000_000,
    emscripten_get_now: () => getTime(),
    // Wall clock vs monotonic: Emscripten's glue maps these exactly this way.
    // Unknown env symbols are derived in buildHyphonWasmImports(); these two
    // stay explicit so the worklets do not run on a silent no-op stub.
    emscripten_date_now: () => Date.now(),
    _emscripten_get_now_is_monotonic: () => 1,
    __emscripten_init_main_thread_js: () => {},
    __emscripten_thread_cleanup: () => {},
    // hyphon_native has no main(), no embind and no emscripten_run_script any more
    // (the Pyodide bootstrap left with emscripten/main.cpp). What remains below
    // is the runtime the pthread profile still imports. Explicit implementations
    // are overrides on top of the derived import table; a *new* Emscripten symbol
    // no longer requires a source edit (see installDerivedFunctionStubs).
    exit: () => {},
    // The voice TUs build with -fno-exceptions, so a current binary never imports
    // this; a stale cached one must still fail loudly rather than run on a no-op.
    __cxa_throw: (ptr: number, type: number, destructor: number) => {
      throw new Error(
        `${logPrefix} C++ exception thrown in WASM ` +
        `(ptr=${ptr}, type=${type}, destructor=${destructor})`,
      );
    },
  };

  const lowercaseAliases: Record<string, unknown> = {
    a: () => console.error('WASM Abort'),
    b: () => console.error('WASM Abort'),
    c: resizeHeap,
    d: resizeHeap,
    e: () => ctx.onHeapUpdate(),
    f: Math.exp,
    g: Math.pow,
    h: Math.sin,
    i: Math.cos,
    j: (x: number, y: number) => x % y,
  };

  for (let i = 0; i < 26; i++) {
    const key = String.fromCharCode(97 + i);
    if (env[key] === undefined) {
      env[key] = lowercaseAliases[key] ?? (() => {});
    }
  }

  // Emscripten minified invoke stubs (uppercase A–Z) — required by hyphon_native.wasm.
  const genericInvoke = (...args: number[]) => tableInvoke(ctx, args[0], args.slice(1));
  for (let i = 0; i < 26; i++) {
    const key = String.fromCharCode(65 + i);
    if (env[key] === undefined) {
      env[key] = genericInvoke;
    }
  }

  return env;
}

/**
 * Walk the compiled module's import section and install a typed no-op stub
 * (`() => 0`) for every `kind: 'function'` import that is not already a
 * callable. Explicit `createEmscriptenEnv` / `createWASIImports` entries win.
 *
 * This is the safety net for the #1176/#1177 class: an incomplete allowlist
 * used to make `WebAssembly.instantiate()` throw `function import requires a
 * callable`, after which every 303/Prophecy voice degraded to a JS fallback
 * that still made sound. A stub cannot fail instantiation; it warns once so
 * the missing symbol is visible in the worklet log.
 */
function installDerivedFunctionStubs(
  module: WebAssembly.Module,
  importsObject: Record<string, Record<string, unknown>>,
  logPrefix: string,
): void {
  for (const imp of WebAssembly.Module.imports(module)) {
    if (imp.kind !== 'function') continue;
    let bag = importsObject[imp.module];
    if (!bag) {
      bag = {};
      importsObject[imp.module] = bag;
    }
    if (typeof bag[imp.name] === 'function') continue;
    console.warn(
      `${logPrefix} unsatisfied WASM import ${imp.module}.${imp.name}; installing no-op stub (returns 0)`,
    );
    bag[imp.name] = (..._args: number[]): number => 0;
  }
}

export function createWASIImports(): Record<string, unknown> {
  return {
    proc_exit: () => {},
    fd_close: () => 0,
    fd_write: () => 0,
    fd_seek: () => 0,
    fd_read: () => 0,
    path_open: () => 0,
    path_filestat_get: () => 0,
    path_unlink_file: () => 0,
    path_create_directory: () => 0,
    path_remove_directory: () => 0,
    path_rename: () => 0,
    path_symlink: () => 0,
    path_readlink: () => 0,
    path_link: () => 0,
    path_filestat_set_times: () => 0,
    fd_fdstat_get: () => 0,
    fd_prestat_get: () => 0,
    fd_prestat_dir_name: () => 0,
    environ_sizes_get: () => 0,
    environ_get: () => 0,
    args_sizes_get: () => 0,
    args_get: () => 0,
    clock_res_get: () => 0,
    clock_time_get: () => 0,
    random_get: () => 0,
    sched_yield: () => 0,
    poll_oneoff: () => 0,
  };
}

export function buildHyphonWasmImports(
  module: WebAssembly.Module,
  ctx: HyphonNativeImportContext,
  options: { memoryPages?: number; isThreaded: boolean },
): { imports: WebAssembly.Imports; memory: WebAssembly.Memory | null } {
  const env = createEmscriptenEnv(ctx);
  const wasiImports = createWASIImports();

  const importsObject: Record<string, Record<string, unknown>> = {
    env: env as Record<string, unknown>,
    a: env as Record<string, unknown>,
    wasi_snapshot_preview1: wasiImports as Record<string, unknown>,
    wasi_unstable: wasiImports as Record<string, unknown>,
    '': env as Record<string, unknown>,
  };

  const requiredImports = WebAssembly.Module.imports(module);
  for (const mod of new Set(requiredImports.map((i) => i.module))) {
    if (!importsObject[mod]) {
      importsObject[mod] = env as Record<string, unknown>;
    }
  }

  let memory: WebAssembly.Memory | null = null;
  const memoryImport = requiredImports.find((i) => i.kind === 'memory');
  if (memoryImport) {
    memory = createHyphonMemory(options.memoryPages, options.isThreaded, ctx.logPrefix);
    ctx.setImportedMemory(memory);
    if (!importsObject[memoryImport.module]) {
      importsObject[memoryImport.module] = {};
    }
    importsObject[memoryImport.module][memoryImport.name] = memory;
  }

  installDerivedFunctionStubs(module, importsObject, ctx.logPrefix ?? '[HyphonNative]');

  return { imports: importsObject as WebAssembly.Imports, memory };
}
