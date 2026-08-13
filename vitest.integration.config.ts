/// <reference types="vitest" />
import { defineConfig, mergeConfig } from 'vitest/config';
import { vitestCommonExclude, vitestSharedConfig } from './vitest.shared';
import { INTEGRATION_TEST_GLOBS } from './vitest.integration.files';

export default mergeConfig(
  vitestSharedConfig,
  defineConfig({
    test: {
      name: 'integration',
      environment: 'happy-dom',
      setupFiles: ['./vitest.setup.integration.ts'],
      globals: true,
      include: [...INTEGRATION_TEST_GLOBS],
      exclude: vitestCommonExclude,
      pool: 'forks',
      testTimeout: 180_000,
      hookTimeout: 180_000,
    },
  }),
);
