import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import path from 'path';

export default defineConfig({
  base: './',
  plugins: [
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/onnxruntime-web/dist/*.wasm',
          dest: 'assets'
        },
        {
          src: ['../assets/*', '!../assets/.git'],
          dest: 'assets/onnx'
        }
      ]
    }),
    wasm(),
    topLevelAwait()
  ],
  server: {
    port: 3000,
    open: true,
    fs: {
      allow: ['..'] // Allow serving files from adjacent directories
    }
  },
  build: {
    target: 'esnext'
  },
  optimizeDeps: {
    exclude: ['onnxruntime-web']
  },
  ssr: {
    noExternal: ['onnxruntime-web']
  }
});
