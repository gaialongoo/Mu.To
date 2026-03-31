import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import dotenv from "dotenv";
import path from "path";
import https from "https";

dotenv.config({
  path: path.resolve(__dirname, "../../../server/openAPI/.env"),
});

const API_CONNECT_HOST = process.env.API_CONNECT_HOST || "127.0.0.1";
const API_PORT         = process.env.API_PORT         || 3000;
const API_KEY          = process.env.API_KEY          || "";

export default defineConfig(({ mode }) => ({
  base: "/marketplace/",
  plugins: [react()],
  define: {
    __API_KEY__: JSON.stringify(API_KEY),
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 8082,
    proxy: mode === "development" ? {
      "/api": {
        target: `https://${API_CONNECT_HOST}:${API_PORT}`,
        changeOrigin: true,
        secure: false,
        rewrite: (p) => p.replace(/^\/api/, ""),
        agent: new https.Agent({ rejectUnauthorized: false }),
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq, req) => {
            proxyReq.setHeader("X-API-Key", API_KEY);
            if (req.headers["content-type"]?.includes("multipart/form-data")) {
              proxyReq.removeHeader("content-length");
            }
          });
        },
      },
    } : {},
  },
}));