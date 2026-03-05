declare module '*.wasm' {
  const init: (imports: WebAssembly.Imports) => Promise<WebAssembly.Instance>;
  export default init;
}

declare global {

  var hyphonPyodide: any;

  var hyphonPyodideReady: boolean;
}

export {};
