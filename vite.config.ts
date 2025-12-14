/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  optimizeDeps: {
    exclude: ['onnxruntime-web'],
  },
  build: {
    sourcemap: true,
    outDir: 'dist',
  },
  worker: {
    format: 'es',
  },
  test: {
    environment: 'happy-dom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
  },
})
