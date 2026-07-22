import { defineConfig } from "vite";

const apiProxy = {
  target: "http://127.0.0.1:2567",
  changeOrigin: false,
} as const;

export default defineConfig({
  server: {
    proxy: { "/api": apiProxy },
  },
  preview: {
    proxy: { "/api": apiProxy },
  },
});
