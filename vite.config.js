import { defineConfig } from "vite";

const hermesTarget = process.env.HERMES_URL || "http://127.0.0.1:8642";

export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 4177,
    proxy: {
      "/hermes-proxy": {
        target: hermesTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/hermes-proxy/, "") || "/",
      },
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 4177,
  },
});
