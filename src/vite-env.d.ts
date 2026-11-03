/// <reference types="vite/client" />
/// <reference types="@webgpu/types" />
/// <reference types="vitest/globals" />

declare module '*.wasm?init' {
  const initWasm: (options?: WebAssembly.Imports) => Promise<WebAssembly.Instance>;
  export default initWasm;
}

declare module '*.wasm' {
  const value: any;
  export default value;
}

declare module '*.wasm?url' {
  const url: string;
  export default url;
}

interface ImportMetaEnv {
  /**
   * Opt-in URL of a locally built openrb338.wasm (GPL-3.0-only; see
   * docs/audio-engine/openrb-lowpass.md). Unset in every published build, so
   * the patch bay's openrb low-pass mode plays the RBJ biquad.
   */
  readonly VITE_OPENRB338_WASM_URL?: string;
}
