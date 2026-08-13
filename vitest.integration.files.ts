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
  'src/utils/__tests__/tb303AuthenticityMetrics.integration.test.ts',
  'src/__tests__/trackFreezer.integration.test.ts',
] as const;
