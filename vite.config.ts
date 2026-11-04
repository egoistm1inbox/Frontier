import { defineConfig } from 'vite';

// Dev server is exposed on 0.0.0.0 so the Arena live preview proxy can reach it.
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
});
