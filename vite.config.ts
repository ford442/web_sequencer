/// <reference types="vitest" />
import { defineConfig, mergeConfig } from 'vitest/config';
import unitTestConfig from './vitest.unit.config';
import { vitestSharedConfig } from './vitest.shared';

export default mergeConfig(
  vitestSharedConfig,
  defineConfig({
    server: {
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Cross-Origin-Resource-Policy': 'same-origin',
      },
      watch: {
        ignored: ['**/emsdk/**'],
      },
    },
    preview: {
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Cross-Origin-Resource-Policy': 'same-origin',
      },
    },
    build: {
      rollupOptions: {
        external: ['loader.mjs'],
      },
      sourcemap:
        process.env.HYPHON_SOURCEMAP === 'hidden'
          ? 'hidden'
          : process.env.HYPHON_SOURCEMAP === '1',
      outDir: 'dist',
    },
    test: unitTestConfig.test,
  }),
);
