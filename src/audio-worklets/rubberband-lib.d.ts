// Types for the Emscripten glue that emscripten/build_rubberband.sh generates
// next to this file. Only the surface the worklets call is declared; the
// rb_fx_* exports are probed at runtime (see rubberband/nativeVocalFx.ts).

export interface RubberBandStretcher {
  module: RubberBandModule;
  reset(): void;
  setPitchScale(scale: number): void;
  setTimeRatio(ratio: number): void;
  getPitchScale(): number;
  getTimeRatio(): number;
  getSamplesRequired(): number;
  available(): number;
  process(inputPtr: number, frames: number, final: boolean): void;
  retrieve(outputPtr: number, frames: number): number;
}

export interface RubberBandModule {
  readonly HEAPF32: Float32Array;
  readonly HEAPF64: Float64Array;
  _malloc(bytes: number): number;
  _free(ptr: number): void;
  RubberBandStretcher: new (
    sampleRate: number,
    channels: number,
    options: number,
    timeRatio: number,
    pitchScale: number,
  ) => RubberBandStretcher;
  [exportName: string]: unknown;
}

export interface RubberBandModuleOptions {
  wasmBinary?: ArrayBuffer | Uint8Array;
  locateFile?: (path: string) => string;
}

declare function createRubberBandModule(options?: RubberBandModuleOptions): Promise<RubberBandModule>;
export default createRubberBandModule;
