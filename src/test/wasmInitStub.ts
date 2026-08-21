/**
 * Hermetic stub for WebAssembly imports (`*.wasm?init`) during unit tests.
 * This ensures unit tests can run without building actual WASM binaries.
 * It attempts to call `WebAssembly.instantiate` so tests that spy on it can
 * inject their mocks (e.g., WasmOscillator.test.ts).
 */
export default async function initWasmStub(): Promise<WebAssembly.Instance> {
  const dummyBuffer = new Uint8Array(8);
  try {
    const result = await WebAssembly.instantiate(dummyBuffer);
    return result.instance;
  } catch (e) {
    return {
      exports: {
        memory: new WebAssembly.Memory({ initial: 1 })
      },
    } as unknown as WebAssembly.Instance;
  }
}
