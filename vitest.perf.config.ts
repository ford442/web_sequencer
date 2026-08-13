/// <reference types="vitest" />
import { defineConfig, mergeConfig } from 'vitest/config';
import { vitestCommonExclude, vitestSharedConfig } from './vitest.shared';

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
      poolOptions: {
        forks: {
          singleFork: true,
        },
      },
      fileParallelism: false,
      testTimeout: 300_000,
      hookTimeout: 300_000,
    },
  }),
);
