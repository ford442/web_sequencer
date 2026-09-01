// Shared Emscripten import wiring for hyphon_native.wasm inside AudioWorklets.
// Open303 and Prophecy both instantiate the same threaded WASM module; memory
// imports use the minified namespace "a" / name "a", not env.memory.

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
 * 128 MB rather than the previous 512 MB — see
 * docs/wasm/BUILD_NOTES.md#four-worlds-memory-budget. A 512 MB `shared: true`
 * allocation is a frequent SharedArrayBuffer failure on mobile Safari and low-RAM
 * Chromebooks even with correct COOP/COEP; the module grows on demand up to
 * HYPHON_NATIVE_MAX_MEMORY_PAGES.
 */
export const HYPHON_NATIVE_MIN_MEMORY_PAGES = (128 * 1024 * 1024) / WASM_PAGE_BYTES; // 2048

/** Growth ceiling, matching -s MAXIMUM_MEMORY in emscripten/build.sh (1 GB). */
export const HYPHON_NATIVE_MAX_MEMORY_PAGES = (1024 * 1024 * 1024) / WASM_PAGE_BYTES; // 16384

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

/** Bare export names the Open303 worklet must resolve via the export map. */
export const OPEN303_REQUIRED_WASM_EXPORTS = [
  'open303_create',
  'open303_init',
  'jc303_init',
  'jc303_process',
] as const;

/** Bare export names the Prophecy worklet must resolve via the export map. */
export const PROPHECY_REQUIRED_WASM_EXPORTS = [
  'prophecy_create',
  'prophecy_init',
  'prophecy_process',
] as const;

/** Name-only snapshot of a compiled module's exports (for main-thread diagnostics). */
export function wasmExportNameSnapshot(module: WebAssembly.Module): WebAssembly.Exports {
  const out: Record<string, unknown> = {};
  for (const entry of WebAssembly.Module.exports(module)) {
    out[entry.name] = null;
  }
  return out as WebAssembly.Exports;
}

/**
 * True when the export map fails to surface either the native open303_* API or
 * the legacy jc303_* API against the compiled module's raw export table.
 */
export function open303ExportMapInsufficient(
  module: WebAssembly.Module,
  exportMap: WasmExportMap,
): boolean {
  const normalized = normalizeWasmExports(wasmExportNameSnapshot(module), exportMap);
  const hasNative =
    typeof normalized.open303_create === 'function' &&
    typeof normalized.open303_init === 'function';
  const hasLegacy =
    typeof normalized.jc303_init === 'function' &&
    typeof normalized.jc303_process === 'function';
  return !hasNative && !hasLegacy;
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
  return (
    typeof exports.prophecy_create === 'function' &&
    typeof exports.prophecy_init === 'function'
  );
}

export interface HyphonNativeImportContext {
  getWasmInstance: () => WebAssembly.Instance | null;
  getImportedMemory: () => WebAssembly.Memory | null;
  setImportedMemory: (memory: WebAssembly.Memory) => void;
  onHeapUpdate: () => void;
  logPrefix?: string;
}

function getTime(): number {
  if (typeof performance !== 'undefined' && performance.now) {
    return performance.now();
  }
  return Date.now();
}

export function createHyphonMemory(
  pages: number | undefined,
  shared: boolean,
  logPrefix = '[HyphonNative]',
): WebAssembly.Memory {
  const memoryImportPages = Math.max(pages ?? 0, HYPHON_NATIVE_MIN_MEMORY_PAGES);
  const maxMemoryPages = HYPHON_NATIVE_MAX_MEMORY_PAGES;

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
    _embind_register_function: () => {},
    _embind_register_void: () => {},
    _embind_register_bool: () => {},
    _embind_register_std_string: () => {},
    _embind_register_std_wstring: () => {},
    _embind_register_emval: () => {},
    _embind_register_integer: () => {},
    _embind_register_bigint: () => {},
    _embind_register_float: () => {},
    _embind_register_memory_view: () => {},
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

  return { imports: importsObject as WebAssembly.Imports, memory };
}
