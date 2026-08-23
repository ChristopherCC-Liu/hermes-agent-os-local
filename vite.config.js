import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  resolve: {
    alias: {
      "@/lib/hermes-gateway": path.resolve(root, "src/gateway.js"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 4177,
  },
  preview: {
    host: "127.0.0.1",
    port: 4177,
  },
});
