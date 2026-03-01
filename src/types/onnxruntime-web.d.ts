// Type declarations for onnxruntime-web
// This module is loaded dynamically from CDN

declare module 'onnxruntime-web' {
  export interface Tensor {
    data: Float32Array | Int32Array | BigInt64Array;
    dims: number[];
  }

  export interface InferenceSession {
    run(feeds: Record<string, Tensor>): Promise<Record<string, Tensor>>;
  }

  export namespace InferenceSession {
    function create(modelPath: string): Promise<InferenceSession>;
  }

  export const Tensor: {
    new (type: string, data: Float32Array | Int32Array | BigInt64Array, dims: number[]): Tensor;
  };

  export const env: {
    wasm: {
      numThreads: number;
      simd: boolean;
      wasmPaths: string;
    };
  };
}
