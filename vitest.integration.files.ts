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
  // The cpp-* oscillator (#1665) on the real cpp_osc.wasm: band-limited, offline == live, processor gate timing.
  'src/audio-worklets/__tests__/cppOscVoice.realWasm.test.ts',
  // The dwgs-* oscillator (#1666) on the real dwgs_osc.wasm: harmonics only, distinct waves, offline == live, processor gate timing.
  'src/audio-worklets/__tests__/dwgsOscVoice.realWasm.test.ts',
  // The wam-* AssemblyScript oscillator on the real oscillators.wasm: band-limited, seamless loop tables, hostile arguments, import/export contract.
  'src/engines/__tests__/WasmOscillator.realWasm.test.ts',
  // The same kernel's SIMD loop (#1663): f32x4 / f64x2 in the shipped bytes, Safari 16.4 feature set, == a double-precision port of the scalar kernel it replaced.
  'src/engines/__tests__/WasmOscillator.simd.realWasm.test.ts',
  // The "WASM OSC filter" (#1663) on the real wamFilter.wasm: LP/BP/HP vs the RBJ transfer functions, == the kernel's baked filter, processor block handling.
  'src/audio-worklets/__tests__/wamFilter.realWasm.test.ts',
  // The "Rust filter" (#1672) on the real rust_osc.wasm: LP/BP/HP vs the RBJ transfer functions, == the WASM OSC filter, filters any oscillator, processor block handling.
  'src/audio-worklets/__tests__/rustFilter.realWasm.test.ts',
  // The "C++ filter" (#1673) on the real cpp_osc.wasm: LP/BP/HP vs the RBJ transfer functions, == the WASM OSC and Rust filters, filters any oscillator, smooth sweeps, processor block handling.
  'src/audio-worklets/__tests__/cppFilter.realWasm.test.ts',
  // The "DWGS filter" (#1674) on the real dwgs_osc.wasm: LP/BP/HP vs the analytic 4-pole ladder, NOT the RBJ response of the other kernels, saturation, filters any oscillator, processor block handling.
  'src/audio-worklets/__tests__/dwgsFilter.realWasm.test.ts',
] as const;
