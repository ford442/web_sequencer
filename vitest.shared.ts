import react from '@vitejs/plugin-react';
import type { UserConfig } from 'vite';

/** Shared Vite/Vitest plugins and resolve options for all test tiers. */
export const vitestSharedConfig: UserConfig = {
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  optimizeDeps: {
    exclude: ['onnxruntime-web', 'emsdk'],
  },
  // Workers and AudioWorklets (`?worker&url`) are emitted as ES modules.
  // vite-plugin-wasm / vite-plugin-top-level-await are gone since Vite 8: every
  // .wasm the app loads goes through Vite's native `?init` / `?url` handling or
  // a runtime fetch, and Vite 8's default build target
  // ('baseline-widely-available') supports top-level await natively.
  worker: {
    format: 'es',
  },
};

export const vitestCommonExclude = [
  '**/node_modules/**',
  '**/dist/**',
  '**/cypress/**',
  '**/.{idea,git,cache,output,temp}/**',
  '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*',
  'tests/**',
  'emsdk/**',
];
