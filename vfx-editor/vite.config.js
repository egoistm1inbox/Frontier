import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    // allow Arena preview proxy hosts
    allowedHosts: true,
    cors: true,
    headers: {
      // allow iframe embedding in preview
      'X-Frame-Options': 'ALLOWALL',
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
  },
});
