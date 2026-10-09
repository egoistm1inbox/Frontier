import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Landscape Studio is a self-contained browser tool: it owns its entry point,
// its worker and its assets, and never resolves against another package root.
export default defineConfig({
  root: new URL('.', import.meta.url).pathname,
  base: './',
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: ['.e2b.app', 'localhost'],
    hmr: { protocol: 'ws', host: undefined, clientPort: undefined },
  },
  build: { target: 'es2022', outDir: 'dist', assetsInlineLimit: 0 },
  worker: { format: 'es' },
});
