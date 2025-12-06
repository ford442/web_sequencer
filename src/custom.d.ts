declare module '*.wasm' {
  const init: (imports: WebAssembly.Imports) => Promise<WebAssembly.Instance>;
  export default init;
}
