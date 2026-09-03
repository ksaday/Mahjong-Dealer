import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The server has no bootable process yet (no `.listen()` call exists in
// packages/server — see docs/27_Deployment_Architecture.md §4), so this
// proxy target is a placeholder for when one exists, not a verified
// integration. `VITE_API_PROXY_TARGET` overrides it once a dev server is
// running somewhere other than :3000.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: process.env["VITE_API_PROXY_TARGET"] ?? "http://localhost:3000",
        changeOrigin: false,
      },
      // The socket gateway's default upgrade path (server/src/gateway/{ws-server,multi-table-router}.ts).
      "/ws": {
        target: process.env["VITE_API_PROXY_TARGET"] ?? "http://localhost:3000",
        ws: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
