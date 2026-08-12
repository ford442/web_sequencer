import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import type { UserConfig } from 'vitest/config';

/** Shared Vite/Vitest plugins and resolve options for all test tiers. */
export const vitestSharedConfig: UserConfig = {
  base: './',
  plugins: [react(), wasm(), topLevelAwait()],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  optimizeDeps: {
    exclude: ['onnxruntime-web', 'emsdk'],
  },
  worker: {
    format: 'es',
    plugins: () => [wasm(), topLevelAwait()],
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
