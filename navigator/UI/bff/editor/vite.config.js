import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import dotenv from "dotenv";
import path from "path";
import https from "https";          // ← aggiunto

dotenv.config({
  path: path.resolve(__dirname, "../../../server/openAPI/.env"),
});

const API_CONNECT_HOST = process.env.API_CONNECT_HOST || "127.0.0.1";
const API_PORT         = process.env.API_PORT         || 3000;
const API_KEY          = process.env.API_KEY          || "";

export default defineConfig(({ mode }) => ({
  base: "/editor/",
  plugins: [react()],
  define: {
    __API_KEY__: JSON.stringify(API_KEY),   // ← inietta la chiave nel bundle
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 8081,
    proxy: mode === "development" ? {
      "/api": {
        target: `https://${API_CONNECT_HOST}:${API_PORT}`,
        changeOrigin: true,
        secure: false,
        rewrite: (p) => p.replace(/^\/api/, ""),
        agent: new https.Agent({ rejectUnauthorized: false }),  // ← aggiunto
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq, req) => {
            proxyReq.setHeader("X-API-Key", API_KEY);
            // fix critico: rimuove il content-length pre-calcolato
            // che diventa sbagliato dopo che http-proxy riscrive gli header
            if (req.headers["content-type"]?.includes("multipart/form-data")) {
              proxyReq.removeHeader("content-length");
            }
          });
        },
      },
    } : {},
  },
}));