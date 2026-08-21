/// <reference types="vitest" />
import { defineConfig, mergeConfig } from 'vitest/config';
import { vitestCommonExclude, vitestSharedConfig } from './vitest.shared';
import { INTEGRATION_TEST_GLOBS } from './vitest.integration.files';

export default mergeConfig(
  vitestSharedConfig,
  defineConfig({
    plugins: [
      {
        name: 'wasm-stub-resolve',
        enforce: 'pre',
        resolveId(id) {
          if (id.endsWith('.wasm?init') || id.endsWith('.wasm')) {
            return this.resolve('/src/test/wasmInitStub.ts');
          }
        },
      },
    ],
    test: {
      name: 'unit',
      environment: 'happy-dom',
      setupFiles: ['./vitest.setup.unit.ts'],
      globals: true,
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
      exclude: [...vitestCommonExclude, ...INTEGRATION_TEST_GLOBS, '**/*.{bench,perf}.test.*'],
      pool: 'forks',
    },
  }),
);
