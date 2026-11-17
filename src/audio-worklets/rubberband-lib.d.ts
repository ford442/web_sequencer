// Types for the Emscripten glue that emscripten/build_rubberband.sh generates
// next to this file. The stretcher is the rb_* C ABI (wrapped by
// rubberband/stretcher.ts, which declares and checks those exports); the rb_fx_*
// exports are probed at runtime (rubberband/nativeVocalFx.ts). There is no embind
// class any more (#1596 follow-up P2).

export interface RubberBandModule {
  readonly HEAPF32: Float32Array;
  readonly HEAPF64: Float64Array;
  _malloc(bytes: number): number;
  _free(ptr: number): void;
  [exportName: string]: unknown;
}

export interface RubberBandModuleOptions {
  wasmBinary?: ArrayBuffer | Uint8Array;
  locateFile?: (path: string) => string;
}

declare function createRubberBandModule(options?: RubberBandModuleOptions): Promise<RubberBandModule>;
export default createRubberBandModule;
