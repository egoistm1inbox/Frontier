/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    sourcemap: false,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 60000,
  },
});
