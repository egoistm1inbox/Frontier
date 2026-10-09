import { defineConfig } from 'vite';
import { copyFileSync, cpSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
// Keep all browser experiments together; never resolve assets against the engine root.
export default defineConfig({
  root,
  base: './',
  // Terrain workspace is a second page; its evaluation worker is an ES module bundle.
  build: { rollupOptions: { input: { main: resolve(root, 'index.html'), terrain: resolve(root, 'terrain.html') } } },
  worker: { format: 'es' },
  server: { host: '0.0.0.0', allowedHosts: ['.e2b.app'], proxy: { '/api/construct': 'http://127.0.0.1:5191' } },
  plugins: [{
    name: 'standalone-experimental-pages',
    configureServer(server) {
      // Optional dedicated lab landing page; normal editor startup is unchanged.
      if (process.env.FRONTIER_LOD_DEMO === '1') server.middlewares.use((req, _res, next) => {
        if (req.url === '/') req.url = '/cluster-lod.html';
        next();
      });
    },
    closeBundle() {
      for (const page of ['icons.html', 'collection-icon-options.html', 'cluster-lod.html', 'cluster-lod-core.js', 'cluster-lod-demo.js']) {
        copyFileSync(resolve(root, page), resolve(root, 'dist', page));
      }
      for (const directory of ['custom-icons', 'ui-icons']) {
        cpSync(resolve(root, directory), resolve(root, 'dist', directory), { recursive: true });
      }
    },
  }],
});
