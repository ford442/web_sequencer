/// <reference types="vite/client" />

declare module '*.wasm?init' {
  const initWasm: (options?: WebAssembly.Imports) => Promise<WebAssembly.Instance>;
  export default initWasm;
}

declare module '*.wasm' {
  const value: any;
  export default value;
}
