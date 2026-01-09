declare module '*.wasm' {
  const init: (imports: WebAssembly.Imports) => Promise<WebAssembly.Instance>;
  export default init;
}

declare global {
  // eslint-disable-next-line no-var
  var hyphonPyodide: any;
  // eslint-disable-next-line no-var
  var hyphonPyodideReady: boolean;
}

export {};
