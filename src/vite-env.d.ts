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
