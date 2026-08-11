import { defineConfig } from "vite";

const apiProxy = {
  target: "http://127.0.0.1:2567",
  changeOrigin: false,
} as const;

// WebSocket proxy used when the client is served over HTTPS (e.g. Cloudflare
// tunnel or a reverse proxy). The browser will upgrade to wss:// automatically;
// this proxy strips the path prefix and forwards to the local Colyseus port.
const wsProxy = {
  target: "ws://127.0.0.1:2567",
  ws: true,
  changeOrigin: false,
  rewrite: (path: string) => path.replace(/^\/colyseus-ws/, ""),
} as const;

export default defineConfig({
  server: {
    // Listen on all interfaces so LAN devices can reach the dev server.
    // allowedHosts is intentionally left at its default (localhost + 127.0.0.1)
    // to prevent DNS-rebinding attacks. If you need to reach the server by a
    // custom hostname (e.g. a Cloudflare tunnel or a LAN IP alias), add that
    // hostname to the array below instead of using "all":
    //   allowedHosts: ["localhost", "my-tunnel.example.com"],
    host: true,
    proxy: {
      "/api": apiProxy,
      "/colyseus-ws": wsProxy,
    },
  },
  preview: {
    proxy: {
      "/api": apiProxy,
      "/colyseus-ws": wsProxy,
    },
  },
});
