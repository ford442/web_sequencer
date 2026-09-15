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
        output: {
          // react/react-dom change far less often than app code, so pin them to
          // their own chunk for long-term browser caching across deploys.
          // Everything else (three.js, onnxruntime-web, the RBS importer/exporter,
          // XM export) is already reachable only via dynamic import() — Studio3D,
          // the TTS/alignment services, and the route-split modals in App.tsx —
          // so Rollup's default code-splitting already isolates them without
          // help here; naming them explicitly would risk merging an async-only
          // dep back into the eager graph.
          manualChunks(id) {
            if (/[/\\]node_modules[/\\](react|react-dom|scheduler)[/\\]/.test(id)) {
              return 'vendor-react';
            }
          },
        },
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
