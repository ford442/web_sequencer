/** Heavy integration suites — WASM artifacts, baselines, or Python metrics required. */
export const INTEGRATION_TEST_GLOBS = [
  'src/__tests__/engineInitPaths.integration.test.ts',
  'src/__tests__/TB303SpectrogramQuality.integration.test.ts',
  'src/__tests__/TB303AuthenticityBaselines.integration.test.ts',
  'src/__tests__/TB303LevelAlignment.integration.test.ts',
  'src/__tests__/Offline303Stress.integration.test.ts',
  'src/__tests__/HighFid303Offline.integration.test.ts',
  'src/__tests__/Offline303Renderer.integration.test.ts',
  'src/__tests__/WebGpu303Engine.integration.test.ts',
  'src/__tests__/tb303AuthenticityMetrics.integration.test.ts',
  'src/__tests__/trackFreezer.integration.test.ts',
  'src/__tests__/nativeVocalFx.integration.test.ts',
  'src/__tests__/phonemeElasticity.integration.test.ts',
  // V2: the vocal chain at the live rate vs the export rate, real rubberband.wasm.
  'src/__tests__/vocalFreezeParity.integration.test.ts',
  'src/__tests__/mixBus.integration.test.ts',
  // rubberband.wasm on the C ABI with a fixed heap: golden vs embind, live worklets, long-sample fallback.
  'src/__tests__/rubberbandFixedHeap.integration.test.ts',
  // #1344: the worklets on the real hyphon_native.st.wasm — needs the native build.
  'src/audio-worklets/__tests__/voiceTiming.realWasm.test.ts',
  // Fixed (non-growing) voice memory: import limits + every voice slot fits.
  'src/__tests__/hyphonNativeFixedMemory.integration.test.ts',
  // The macro (Plaits) voice on the real wasm: worklet stereo + offline == live.
  'src/audio-worklets/__tests__/macroVoice.realWasm.test.ts',
  // The rust-* oscillator (#1664) on the real rust_osc.wasm: SIMD == scalar, band-limited, processor gate timing.
  'src/audio-worklets/__tests__/rustOscVoice.realWasm.test.ts',
] as const;
