import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// The editor is a self-contained browser prototype. Everything it needs lives in this folder,
// and the dev server accepts the sandbox preview host so the live preview loads.
const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  base: './',
  plugins: [react()],
  server: { host: '0.0.0.0', port: 5173, strictPort: true, allowedHosts: ['.e2b.app'] },
  preview: { host: '0.0.0.0', port: 4173, strictPort: true, allowedHosts: ['.e2b.app'] },
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
