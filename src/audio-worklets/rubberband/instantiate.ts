/**
 * Instantiate public/rubberband.wasm by hand, the way the voice worklets
 * instantiate hyphon_native (hyphonNativeImports.ts). There is no Emscripten
 * glue any more (#1596 follow-up P3): emscripten/build_rubberband.sh links with
 * -lexports.js so import and export names stay readable, and
 * tools/check_rubberband_module.mjs fails the build if the wasm imports anything
 * outside the manifest's `rubberband.imports` — the set {@link createRubberBandImports}
 * implements.
 *
 * The module owns a fixed, non-shared memory (ALLOW_MEMORY_GROWTH=0), so the
 * HEAP views built here stay valid for the life of the instance.
 *
 * Runs inside AudioWorkletGlobalScope: no fetch, no TextDecoder guarantee, no
 * performance.now guarantee. Callers pass the bytes the main thread fetched.
 */

import type { RubberBandExports } from '../../shared/rt/rubberbandExports';

/** Each manifest export as `module._name`, plus views of the fixed memory. */
export type RubberBandModule = RubberBandExports & {
  readonly memory: WebAssembly.Memory;
  readonly HEAPU8: Uint8Array;
  readonly HEAPF32: Float32Array;
  readonly HEAPF64: Float64Array;
  [exportName: string]: unknown;
};

/** Thrown where the Emscripten runtime would abort(). */
export class RubberBandAbort extends Error {
  constructor(message: string) {
    super(`[rubberband.wasm] ${message}`);
    this.name = 'RubberBandAbort';
  }
}

const WASI_ESUCCESS = 0;
const WASI_EBADF = 8;
const WASI_EINVAL = 28;
const WASI_ESPIPE = 70;

function monotonicMs(): number {
  const perf = (globalThis as { performance?: { now?: () => number } }).performance;
  return typeof perf?.now === 'function' ? perf.now() : Date.now();
}

/** Latin-1 decode of a NUL-terminated string; Rubber Band's messages are ASCII. */
function cString(heap: Uint8Array, ptr: number): string {
  if (!ptr) return '';
  let s = '';
  for (let i = ptr; i < heap.length && heap[i] !== 0 && s.length < 1024; i++) {
    s += String.fromCharCode(heap[i]);
  }
  return s;
}

/**
 * The import object for rubberband.wasm, keyed exactly like the manifest's
 * `rubberband.imports` (src/__tests__/rubberbandInstantiate.test.ts holds the two
 * equal). `getMemory` is late-bound: the memory is the module's own export.
 */
export function createRubberBandImports(
  getMemory: () => WebAssembly.Memory | null,
  log: { out: (line: string) => void; err: (line: string) => void } = {
    out: (line) => console.warn(line),
    err: (line) => console.error(line),
  },
): { env: Record<string, (...args: never[]) => unknown>; wasi_snapshot_preview1: Record<string, (...args: never[]) => unknown> } {
  const bytes = (): Uint8Array => {
    const memory = getMemory();
    if (!memory) throw new RubberBandAbort('memory used before instantiation');
    return new Uint8Array(memory.buffer);
  };
  const view = (): DataView => new DataView(bytes().buffer);

  // stdout / stderr, line-buffered (Rubber Band's own diagnostics go to cerr).
  // Both default to console.warn/error: the worklets allow no console.log (no-console).
  const pending: Record<number, string> = { 1: '', 2: '' };
  const emit = (fd: number, chunk: string): void => {
    let buf = pending[fd] + chunk;
    let nl = buf.indexOf('\n');
    while (nl >= 0) {
      (fd === 2 ? log.err : log.out)(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
      nl = buf.indexOf('\n');
    }
    pending[fd] = buf.length > 4096 ? '' : buf;
  };

  return {
    env: {
      __assert_fail: (condition: number, file: number, line: number, func: number): never => {
        const heap = bytes();
        throw new RubberBandAbort(
          `Assertion failed: ${cString(heap, condition)}, at ${cString(heap, file)}:${line} ${cString(heap, func)}`,
        );
      },
      _abort_js: (): never => {
        throw new RubberBandAbort('abort()');
      },
      // Fixed memory: sbrk asks only once the heap is exhausted, and the answer is
      // no — malloc returns NULL (ABORTING_MALLOC=0) and the caller falls back.
      emscripten_resize_heap: (): number => 0,
      emscripten_date_now: (): number => Date.now(),
      _emscripten_runtime_keepalive_clear: (): void => {},
      // setitimer/alarm: no timers on the audio thread.
      _setitimer_js: (): number => 0,
    },
    wasi_snapshot_preview1: {
      proc_exit: (code: number): never => {
        throw new RubberBandAbort(`exit(${code})`);
      },
      fd_write: (fd: number, iov: number, iovcnt: number, pnum: number): number => {
        if (fd !== 1 && fd !== 2) return WASI_EBADF;
        const dv = view();
        const heap = bytes();
        let written = 0;
        let text = '';
        for (let i = 0; i < iovcnt; i++) {
          const ptr = dv.getUint32(iov + i * 8, true);
          const len = dv.getUint32(iov + i * 8 + 4, true);
          for (let j = 0; j < len; j++) text += String.fromCharCode(heap[ptr + j]);
          written += len;
        }
        emit(fd, text);
        dv.setUint32(pnum, written, true);
        return WASI_ESUCCESS;
      },
      fd_read: (_fd: number, _iov: number, _iovcnt: number, pnum: number): number => {
        view().setUint32(pnum, 0, true);
        return WASI_ESUCCESS;
      },
      fd_seek: (): number => WASI_ESPIPE,
      fd_close: (): number => WASI_ESUCCESS,
      environ_sizes_get: (pcount: number, psize: number): number => {
        const dv = view();
        dv.setUint32(pcount, 0, true);
        dv.setUint32(psize, 0, true);
        return WASI_ESUCCESS;
      },
      environ_get: (): number => WASI_ESUCCESS,
      clock_time_get: (clockId: number, _precision: bigint, ptime: number): number => {
        let ms: number;
        if (clockId === 0) ms = Date.now();
        else if (clockId === 1) ms = monotonicMs();
        else return WASI_EINVAL;
        view().setBigUint64(ptime, BigInt(Math.round(ms * 1e6)), true);
        return WASI_ESUCCESS;
      },
    },
  };
}

/** Compile (when given bytes), instantiate, run static constructors, and wrap. */
export async function instantiateRubberBand(
  wasm: BufferSource | WebAssembly.Module,
): Promise<RubberBandModule> {
  const compiled = wasm instanceof WebAssembly.Module ? wasm : await WebAssembly.compile(wasm);
  let memory: WebAssembly.Memory | null = null;
  const imports = createRubberBandImports(() => memory);
  const instance = await WebAssembly.instantiate(compiled, imports as unknown as WebAssembly.Imports);
  const raw = instance.exports as Record<string, unknown>;

  if (!(raw.memory instanceof WebAssembly.Memory)) {
    throw new RubberBandAbort(
      'no exported memory — stale build with minified names; run pnpm run build:wasm:rubberband',
    );
  }
  memory = raw.memory;
  const ctors = raw.__wasm_call_ctors;
  if (typeof ctors !== 'function') {
    throw new RubberBandAbort('no __wasm_call_ctors export; run pnpm run build:wasm:rubberband');
  }
  (ctors as () => void)();

  const module: Record<string, unknown> = {
    memory,
    HEAPU8: new Uint8Array(memory.buffer),
    HEAPF32: new Float32Array(memory.buffer),
    HEAPF64: new Float64Array(memory.buffer),
  };
  for (const [name, value] of Object.entries(raw)) {
    if (typeof value === 'function') module[`_${name}`] = value;
  }
  return module as RubberBandModule;
}
