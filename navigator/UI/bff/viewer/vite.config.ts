import { defineConfig, ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";
import dotenv from "dotenv";
import path from "path";

dotenv.config({
  path: path.resolve(__dirname, "../../../server/openAPI/.env"),
});

const API_CONNECT_HOST = process.env.API_CONNECT_HOST || "127.0.0.1";
const API_PORT         = process.env.API_PORT         || 3000;
const API_KEY          = process.env.API_KEY          || "";

const devProxy: Record<string, ProxyOptions> = {
  "/api": {
    target: `https://${API_CONNECT_HOST}:${API_PORT}`,
    changeOrigin: true,
    secure: false,
    rewrite: (p) => p.replace(/^\/api/, ""),
    configure: (proxy) => {
      proxy.on("proxyReq", (proxyReq) => {
        proxyReq.setHeader("X-API-Key", API_KEY);
      });
    },
  },
  "/svg": {
    target: `https://${API_CONNECT_HOST}:${API_PORT}`,
    changeOrigin: true,
    secure: false,
    rewrite: (p) => p.replace(/^\/svg/, "/svg"),
    configure: (proxy) => {
      proxy.on("proxyReq", (proxyReq) => {
        proxyReq.setHeader("X-API-Key", API_KEY);
      });
    },
  },
};

export default defineConfig(({ mode }) => ({
  base: "/",
  plugins: [react()],
  build: {
    rollupOptions: {},
    outDir: "dist",
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      rollup: "@rollup/wasm-node",
    },
  },
  server: {
    port: 8080,
    proxy: mode === "development" ? devProxy : undefined,
  },
}));