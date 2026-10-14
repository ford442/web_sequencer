declare module '*.wasm' {
  const init: (imports: WebAssembly.Imports) => Promise<WebAssembly.Instance>;
  export default init;
}

declare global {

  var hyphonPyodide: any;

  var hyphonPyodideReady: boolean;

  /** Set by src/engines/hyphonNativeProbe.ts once the voice wasm is reachable. */
  var hyphonNativeReady: boolean | undefined;
}

export {};
