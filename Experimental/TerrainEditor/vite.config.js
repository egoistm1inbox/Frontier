import { defineConfig } from 'vite';

// Same hosting posture as the Frontier Editor prototype: bind to all
// interfaces and allow the sandboxed preview host.
export default defineConfig({
  base: './',
  server: { host: '0.0.0.0', allowedHosts: ['.e2b.app'] },
});
