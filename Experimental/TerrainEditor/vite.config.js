// Dev-only browser build for the terrain editor. The preview host is a
// sandbox proxy, so the dev and preview servers accept any Host header.
import { defineConfig } from "vite";

export default defineConfig({
  server: { host: "0.0.0.0", port: 5173, allowedHosts: true },
  preview: { host: "0.0.0.0", port: 4173, allowedHosts: true },
  worker: { format: "es" },
  build: { target: "es2020", chunkSizeWarningLimit: 1200 },
});
