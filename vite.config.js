import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));
const hermesTarget = process.env.HERMES_URL || "http://127.0.0.1:8642";

export default defineConfig({
  resolve: {
    alias: {
      "@/lib/hermes-gateway": path.resolve(root, "src/gateway.js"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 4177,
    proxy: {
      "/hermes-proxy": {
        target: hermesTarget,
        changeOrigin: true,
        rewrite: (urlPath) => urlPath.replace(/^\/hermes-proxy/, "") || "/",
      },
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 4177,
  },
});
