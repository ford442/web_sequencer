/// <reference types="vitest" />
import { defineConfig, mergeConfig } from 'vitest/config';
import { vitestCommonExclude, vitestSharedConfig } from './vitest.shared.ts';

export default mergeConfig(
  vitestSharedConfig,
  defineConfig({
    test: {
      name: 'perf',
      environment: 'happy-dom',
      setupFiles: ['./vitest.setup.perf.ts'],
      globals: true,
      include: ['src/**/*.{bench,perf}.test.{ts,tsx}'],
      exclude: vitestCommonExclude,
      pool: 'forks',
      // Vitest 4 removed poolOptions.forks.singleFork. One worker, one file at
      // a time keeps timings free of cross-file CPU contention; each file still
      // gets a fresh fork (isolate defaults to true).
      maxWorkers: 1,
      fileParallelism: false,
      testTimeout: 300_000,
      hookTimeout: 300_000,
    },
  }),
);
